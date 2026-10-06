import crypto from "node:crypto";
import QRCode from "qrcode";
import { GATE_PASS_WARNING_MINUTES } from "../config/constants.js";
import { env } from "../config/env.js";
import { GatePass } from "../models/GatePass.js";
import { User } from "../models/User.js";
import { ApiError } from "../utils/ApiError.js";
import { notify, notifyParent, notifyStaff } from "./notificationService.js";
import { emitEvent } from "./xo/eventService.js"; // EXCEPTION-ONLY HOOK

/**
 * Gate pass mechanics: the QR token, the clock, and the sweep that moves a pass
 * to OVERDUE. Every one of these decisions is taken against server time and
 * against the stored schedule — the browser is only ever shown the result.
 */

const TOKEN_BYTES = 24;

const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

/**
 * Mints a new pass token. The caller gets the plaintext exactly once, to put
 * inside the QR; only the digest is persisted.
 *
 * GATE-PASS QR FIX (see CHANGES-GATEPASS-QR-FIX.md): the token is now derived
 * from a random nonce with an HMAC keyed by the server secret, and the nonce is
 * stored (select: false). GET /qr can then show the *same* QR again instead of
 * minting a new one on every view — which used to retire the code on the
 * student's phone as soon as any other screen opened the pass. A database read
 * alone still cannot forge a pass: the server secret is needed as well.
 */
export function issueToken(gatePass) {
  const nonce = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
  const token = deriveToken(gatePass.reference, nonce);
  gatePass.pass = {
    ...(gatePass.pass?.toObject?.() || gatePass.pass || {}),
    tokenHash: sha256(token),
    nonce,
    issuedAt: new Date(),
    scanCount: gatePass.pass?.scanCount || 0
  };
  return buildPayload(gatePass.reference, token);
}

// GATE-PASS QR FIX — derivation, re-display and the typeable pass code.
const passSecret = () => env.jwtSecret || "campus-gate-pass-development-secret";
const hmac = (label, value) => crypto.createHmac("sha256", passSecret()).update(`${label}:${value}`).digest();

/** The QR token for a reference and nonce (deterministic given the server secret). */
export function deriveToken(reference, nonce) {
  return hmac("gp-token", `${reference}:${nonce}`).toString("base64url").slice(0, 32);
}

// Crockford base32: no I, L, O or U, so a code read aloud or typed is hard to get wrong.
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Normalises a typed pass code: case, spaces, dashes, and the O/0, I/1, L/1 confusions. */
export function normaliseCode(code) {
  return String(code || "").toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1").replace(/[^0-9A-Z]/g, "");
}

/**
 * The QR payload currently valid for this pass, or null when there is none to
 * show again (never issued, spent at the return scan, undone, or issued before
 * this fix with a random token that cannot be re-rendered).
 * Needs a document loaded with "+pass.tokenHash +pass.nonce".
 */
export function currentPayload(gatePass) {
  const { tokenHash, nonce } = gatePass?.pass || {};
  if (!tokenHash || !nonce) return null;
  const token = deriveToken(gatePass.reference, nonce);
  return tokenMatches(tokenHash, token) ? buildPayload(gatePass.reference, token) : null;
}

/** The 8-character code printed under the QR ("7KQ4-M29X"), valid exactly as long as the QR is. */
export function passCode(gatePass) {
  if (!currentPayload(gatePass)) return null;
  const bytes = hmac("gp-code", `${gatePass.reference}:${gatePass.pass.nonce}`);
  const chars = Array.from(bytes.subarray(0, 8), (b) => CODE_ALPHABET[b % 32]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

export function codeMatches(gatePass, code) {
  const expected = passCode(gatePass);
  if (!expected) return false;
  const a = Buffer.from(normaliseCode(expected), "utf8");
  const b = Buffer.from(normaliseCode(code), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * What the QR actually encodes: the human-readable reference and the secret,
 * and nothing else. No name, no room, no phone number, no credentials.
 */
export function buildPayload(reference, token) {
  return `NEX-GP:${reference}:${token}`;
}

/**
 * Reads what the camera decoded or the person typed.
 *
 *   { reference, token }   the QR text, NEX-GP:<reference>:<token> (passes issued before the NeX Camp rename read CIOS-GP: and still scan)
 *   { reference, code }    typed by hand: the pass ID and the 8-character code
 *   { reference, error }   a pass ID without its code
 *   null                   anything else — not a campus gate pass
 *
 * GATE-PASS QR FIX: the QR text is found even with stray whitespace, invisible
 * characters or a prefix some scanner apps add, and the prefix matches in any
 * case. Typing the pass ID and code is new: before, only the full hidden QR
 * text was accepted, so typing what the page shows always failed.
 */
export function parsePayload(payload) {
  const text = String(payload || "").replace(/[​-‍⁠﻿]/g, "").trim();
  const match = /(?:NEX|CIOS)-GP:([A-Za-z0-9-]+):([A-Za-z0-9_-]+)/i.exec(text.replace(/\s+/g, ""));
  if (match) return { reference: match[1].toUpperCase(), token: match[2] };
  const ref = /\b(GP-\d{4}-[A-Z0-9]{3,10})\b/i.exec(text);
  if (!ref) return null;
  const reference = ref[1].toUpperCase();
  const code = normaliseCode(text.replace(ref[0], ""));
  if (code.length !== 8) return { reference, error: "Enter the pass ID and the 8-character pass code shown under the QR, e.g. GP-2026-000014 7KQ4-M29X" };
  return { reference, code };
}

export function tokenMatches(storedHash, token) {
  if (!storedHash) return false;
  const a = Buffer.from(storedHash, "utf8");
  const b = Buffer.from(sha256(token), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Renders the payload as a PNG data URL. Generated on demand, never stored. */
export function renderQr(payload) {
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 360,
    color: { dark: "#141312", light: "#f3f2f2" }
  });
}

/** Whole minutes between two instants, never negative. */
const minutesBetween = (from, to) => Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));

/**
 * The authoritative clock for one pass. The frontend renders a countdown from
 * these numbers and re-reads them after any refresh, so a manipulated browser
 * clock changes nothing.
 */
export function timerFor(gatePass, now = new Date()) {
  const expectedReturnAt = gatePass.expectedReturnAt ? new Date(gatePass.expectedReturnAt) : null;
  if (!expectedReturnAt) return null;

  const active = gatePass.status === "ACTIVE" || gatePass.status === "OVERDUE";
  const remainingSeconds = Math.round((expectedReturnAt.getTime() - now.getTime()) / 1000);

  return {
    serverTime: now.toISOString(),
    leaveAt: gatePass.leaveAt,
    expectedReturnAt,
    exitAt: gatePass.exitAt || null,
    returnAt: gatePass.returnAt || null,
    approvedMinutes: gatePass.leaveAt ? minutesBetween(new Date(gatePass.leaveAt), expectedReturnAt) : null,
    remainingSeconds: active ? remainingSeconds : null,
    overdue: active && remainingSeconds <= 0,
    overdueMinutes: gatePass.overdueMinutes ?? (active && remainingSeconds < 0 ? Math.ceil(-remainingSeconds / 60) : 0),
    warningMinutes: GATE_PASS_WARNING_MINUTES,
    warningActive: active && remainingSeconds > 0 && remainingSeconds <= GATE_PASS_WARNING_MINUTES * 60,
    warningSentAt: gatePass.warningSentAt || null
  };
}

async function guardianPhone(studentId) {
  const student = await User.findById(studentId).select("+parentPhone name parentName");
  return { student, phone: student?.parentPhone };
}

/**
 * Raises the five-minute warning for a pass that is inside the warning window.
 * Idempotent — warningSentAt is the guard.
 */
export async function raiseWarning(gatePass, now = new Date()) {
  if (gatePass.warningSentAt) return false;
  gatePass.warningSentAt = now;
  gatePass.log(
    "gatePassMonitor",
    `${GATE_PASS_WARNING_MINUTES}-minute return warning raised for ${gatePass.reference}`,
    "AI RECOMMENDATION"
  );
  await gatePass.save();

  await notify({
    kind: "GATE_PASS_EXPIRY_WARNING",
    audience: "STUDENT",
    user: gatePass.student,
    gatePass: gatePass._id,
    title: "Your gate pass expires in 5 minutes",
    body: `Your gate pass expires in 5 minutes. Please return to the hostel.`,
    tone: "high"
  });
  return true;
}

/**
 * Moves an ACTIVE pass past its return time to OVERDUE and alerts the student,
 * the warden, the administration and — over SMS — the guardian.
 */
export async function raiseOverdue(gatePass, now = new Date()) {
  if (gatePass.status === "OVERDUE") return false;

  gatePass.status = "OVERDUE";
  gatePass.overdueMarkedAt = now;
  gatePass.overdueMinutes = minutesBetween(new Date(gatePass.expectedReturnAt), now);
  gatePass.log(
    "gatePassMonitor",
    `Approved return time passed — pass marked OVERDUE by ${gatePass.overdueMinutes} minute(s) of server time`,
    "ACTUAL DATA"
  );
  await gatePass.save();

  // EXCEPTION-ONLY HOOK: campus event log (fire-and-forget — never blocks or fails this request).
  emitEvent({ type: "GATEPASS_OVERDUE", actor: null, student: gatePass.student, subjectType: "GatePass", subjectId: gatePass._id, subjectRef: gatePass.reference, channel: "SYSTEM", payload: { overdueMinutes: gatePass.overdueMinutes } });

  const { student, phone } = await guardianPhone(gatePass.student);
  const name = student?.name || "The student";
  const due = new Date(gatePass.expectedReturnAt).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });

  await notify({
    kind: "GATE_PASS_OVERDUE",
    audience: "STUDENT",
    user: gatePass.student,
    gatePass: gatePass._id,
    title: "Gate pass overdue",
    body: `Your approved return time was ${due}. Return to the hostel and scan your pass now.`,
    tone: "high"
  });

  await notifyStaff({
    kind: "GATE_PASS_OVERDUE",
    gatePass,
    hostelId: gatePass.hostel,
    title: `GATE PASS OVERDUE — ${name}`,
    body: `${gatePass.reference} · ${gatePass.hostelName || "hostel"} · approved return ${due} · status OVERDUE.`
  });

  if (phone && !gatePass.overdueNotifiedAt) {
    await notifyParent({
      kind: "GATE_PASS_OVERDUE",
      gatePass,
      phone,
      title: "Gate pass overdue",
      body:
        `GATE PASS OVERDUE — ${name} (${gatePass.reference}) has not returned to ` +
        `${gatePass.hostelName || "the hostel"}. Approved return ${due}.`
    });
    gatePass.overdueNotifiedAt = new Date();
    await gatePass.save();
  }
  return true;
}

/**
 * Brings one pass up to date with server time. Called on every read as well as
 * from the background sweep, so a status is never stale just because the sweep
 * has not ticked yet.
 */
export async function reconcile(gatePass, now = new Date()) {
  if (!gatePass || gatePass.status !== "ACTIVE") return gatePass;
  const remaining = new Date(gatePass.expectedReturnAt).getTime() - now.getTime();
  if (remaining <= 0) {
    await raiseOverdue(gatePass, now);
  } else if (remaining <= GATE_PASS_WARNING_MINUTES * 60_000) {
    await raiseWarning(gatePass, now);
  }
  return gatePass;
}

/**
 * The background sweep. Runs on an interval from server.js so the warning and
 * the overdue alarm fire whether or not anybody has a browser tab open.
 */
export async function sweepGatePasses(now = new Date()) {
  const warningFrom = new Date(now.getTime() + GATE_PASS_WARNING_MINUTES * 60_000);
  const due = await GatePass.find({
    status: "ACTIVE",
    expectedReturnAt: { $lte: warningFrom }
  }).limit(200);

  let warned = 0;
  let overdue = 0;
  for (const pass of due) {
    if (new Date(pass.expectedReturnAt) <= now) {
      if (await raiseOverdue(pass, now)) overdue += 1;
    } else if (await raiseWarning(pass, now)) warned += 1;
  }
  return { checked: due.length, warned, overdue };
}

let sweepTimer = null;

export function startGatePassMonitor() {
  if (sweepTimer) return sweepTimer;
  const interval = Math.max(5, env.gatePass.sweepSeconds) * 1000;
  sweepTimer = setInterval(() => {
    sweepGatePasses().catch((error) => console.error("gate pass sweep failed:", error.message));
  }, interval);
  // Never hold the process open on this alone.
  sweepTimer.unref?.();
  return sweepTimer;
}

export function stopGatePassMonitor() {
  if (sweepTimer) clearInterval(sweepTimer);
  sweepTimer = null;
}

/** Guards every transition a scan can make, with the reason it was refused. */
export function assertScannable(gatePass, now = new Date()) {
  if (gatePass.status === "APPROVED") {
    if (now < new Date(gatePass.leaveAt).getTime() - 30 * 60_000) {
      throw ApiError.badRequest("This pass is not valid yet — it starts closer to the approved leaving time");
    }
    if (now > new Date(gatePass.expectedReturnAt)) {
      throw ApiError.badRequest("This pass expired before it was used");
    }
    return "EXIT";
  }
  if (gatePass.status === "ACTIVE" || gatePass.status === "OVERDUE") return "RETURN";
  if (gatePass.status === "RETURNED" || gatePass.status === "RETURNED_LATE") {
    throw ApiError.badRequest("This pass has already been completed");
  }
  if (gatePass.status === "REJECTED") throw ApiError.badRequest("This pass was rejected");
  if (gatePass.status === "CANCELLED") throw ApiError.badRequest("This pass was cancelled");
  throw ApiError.badRequest("This pass has not been approved yet");
}

export { minutesBetween };
