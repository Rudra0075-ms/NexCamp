import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { STAFF_ROLES } from "../../config/constants.js";
import { DocumentRequest, DOCUMENT_SLA_HOURS, DOCUMENT_TYPES } from "../../models/ext/DocumentRequest.js";
import { FeeAccount } from "../../models/ext/FeeAccount.js";
import { nextReference } from "../../models/ext/common.js";
import { ApiError } from "../../utils/ApiError.js";
import { round } from "../../utils/text.js";
import { audit } from "./extAudit.js";
import { buildPdf, PAGE } from "./pdfWriter.js";
import { emitEvent } from "../xo/eventService.js"; // EXCEPTION-ONLY HOOK

/**
 * Certificate & document requests with a verifiable QR code.
 *
 * On issue, the certificate's canonical content (a fixed, line-by-line text
 * form of the fields printed on it) is hashed with SHA-256 and only the digest
 * is stored. Verification rebuilds the canonical content from the record and
 * compares digests, so a changed record — or a changed copy of the PDF — no
 * longer matches.
 */

export const TYPE_LABELS = {
  BONAFIDE: "Bonafide Certificate",
  NO_DUES: "No Dues Certificate",
  HOSTEL_RESIDENCE: "Hostel Residence Certificate",
  CHARACTER: "Character Certificate"
};

const OPEN = ["SUBMITTED", "UNDER_REVIEW", "APPROVED"];
// v2 = NeX Camp (prefix NEX-CERT). Certificates issued as v1 keep the original
// CIO-CERT prefix, so their stored hash still verifies after the rename.
const CANONICAL_VERSION = 2;
const certPrefix = (version) => (Number(version) >= 2 ? "NEX-CERT" : "CIO-CERT");

export const isStaff = (user) => STAFF_ROLES.includes(user?.role);

export function verifyBaseUrl() {
  return (process.env.VERIFY_BASE_URL || env.clientUrls[0] || "http://localhost:5173").replace(/\/$/, "");
}

/** "PRITISH RANJAN SAHOO" → "PR***** RA**** SA***" */
export function maskName(name = "") {
  return String(name)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (word.length <= 2 ? `${word[0]}*` : `${word.slice(0, 2)}${"*".repeat(Math.min(6, word.length - 2))}`))
    .join(" ");
}

const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** An 8-character code, no 0/O/1/I/L, shown as XXXX-XXXX. */
export function newVerificationCode(random = crypto.randomBytes(8)) {
  let out = "";
  for (let i = 0; i < 8; i += 1) out += CODE_ALPHABET[random[i] % CODE_ALPHABET.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

export function normaliseCode(code) {
  return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^(.{4})(.{4})$/, "$1-$2");
}

/** The exact text that is hashed. Field order is fixed. */
export function canonicalContent(doc) {
  const s = doc.studentSnapshot || {};
  const c = doc.certificate || {};
  return [
    `${certPrefix(c.canonicalVersion || 1)}/v${c.canonicalVersion || 1}`,
    `code=${c.verificationCode || ""}`,
    `serial=${c.serial || ""}`,
    `type=${doc.type}`,
    `reference=${doc.reference}`,
    `name=${s.name || ""}`,
    `studentId=${s.studentId || ""}`,
    `course=${s.course || ""}`,
    `department=${s.department || ""}`,
    `semester=${s.semester ?? ""}`,
    `hostel=${[s.hostelName, s.room].filter(Boolean).join(" ")}`,
    `purpose=${doc.purpose}`,
    `issuedAt=${c.issuedAt ? new Date(c.issuedAt).toISOString() : ""}`,
    `issuedBy=${c.issuedByName || ""}`
  ].join("\n");
}

export const sha256 = (text) => crypto.createHash("sha256").update(String(text), "utf8").digest("hex");

export function slaState(doc, now = new Date()) {
  if (!doc.dueAt) return { state: "NO_SLA" };
  const end = doc.status === "ISSUED" ? new Date(doc.certificate?.issuedAt || doc.updatedAt) : doc.status === "REJECTED" ? new Date(doc.reviewedAt || doc.updatedAt) : now;
  const total = doc.slaHours * 3600000;
  const used = end - new Date(doc.createdAt);
  const remainingHours = round((new Date(doc.dueAt) - now) / 3600000, 1);
  let state = "ON_TRACK";
  if (used > total) state = doc.status === "ISSUED" || doc.status === "REJECTED" ? "MET_LATE" : "BREACHED";
  else if (doc.status === "ISSUED" || doc.status === "REJECTED") state = "MET";
  else if (used > total * 0.75) state = "AT_RISK";
  return { state, slaHours: doc.slaHours, dueAt: doc.dueAt, remainingHours, elapsedHours: round(used / 3600000, 1) };
}

export function shapeDocument(doc, { staff = false } = {}) {
  return {
    id: String(doc._id),
    reference: doc.reference,
    type: doc.type,
    typeLabel: TYPE_LABELS[doc.type],
    purpose: doc.purpose,
    status: doc.status,
    channel: doc.channel,
    operator: doc.operator || null,
    reviewerName: doc.reviewerName || null,
    reviewedAt: doc.reviewedAt || null,
    rejectionReason: doc.rejectionReason || null,
    sla: slaState(doc),
    student: staff
      ? { name: doc.studentSnapshot?.name, studentId: doc.studentSnapshot?.studentId, hostelName: doc.studentSnapshot?.hostelName }
      : undefined,
    certificate: doc.certificate?.verificationCode
      ? {
          verificationCode: doc.certificate.verificationCode,
          serial: doc.certificate.serial,
          issuedAt: doc.certificate.issuedAt,
          issuedByName: doc.certificate.issuedByName,
          revokedAt: doc.certificate.revokedAt || null,
          revocationReason: doc.certificate.revocationReason || null,
          digestShort: doc.certificate.digest?.slice(0, 16),
          verifyUrl: `${verifyBaseUrl()}/verify/${doc.certificate.verificationCode}`
        }
      : null,
    history: doc.history || [],
    // EXCEPTION-ONLY HOOK: additive fields — who decided and the policy engine's verdict (null when none).
    decidedBy: doc.decidedBy || null,
    policyDecision: doc.policyDecision || null,
    policyUndo: doc.policyUndo || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

export async function requestDocument(student, { type, purpose }, { channel = "APP", operator, actor } = {}) {
  if (!DOCUMENT_TYPES.includes(type)) throw ApiError.badRequest("Unknown document type");
  const open = await DocumentRequest.findOne({ student: student._id, type, status: { $in: OPEN } }).lean();
  if (open) throw ApiError.conflict(`An open ${TYPE_LABELS[type]} request already exists (${open.reference})`);
  const now = new Date();
  const slaHours = DOCUMENT_SLA_HOURS[type];
  const doc = new DocumentRequest({
    reference: await nextReference("DOC"),
    student: student._id,
    type,
    purpose,
    channel,
    operator: operator ? { name: operator.name, role: operator.role } : undefined,
    slaHours,
    dueAt: new Date(now.getTime() + slaHours * 3600000),
    studentSnapshot: {
      name: student.name,
      studentId: student.studentId,
      course: student.course,
      department: student.department,
      semester: student.semester,
      hostelName: student.hostelName,
      room: student.room
    }
  });
  await audit(doc, {
    entityType: "DocumentRequest",
    action: "DOCUMENT_REQUESTED",
    actor: actor || operator || student,
    channel,
    field: "status",
    newValue: "SUBMITTED",
    note: `${TYPE_LABELS[type]}${operator ? ` · filed by ${operator.name} (${operator.role}) for ${student.studentId}` : ""}`
  });
  await doc.save();
  // EXCEPTION-ONLY HOOK: campus event log (fire-and-forget — never blocks or fails this request).
  emitEvent({ ...{ student: doc.student, subjectType: "DocumentRequest", subjectId: doc._id, subjectRef: doc.reference, department: "ACADEMIC OFFICE" }, type: "CERTIFICATE_REQUESTED", actor: actor || operator || student, channel, humanTouch: false, payload: { docType: type, operator: operator?.name } });
  return doc;
}

async function feesOutstanding(studentId) {
  const accounts = await FeeAccount.find({ student: studentId }).lean();
  let due = 0;
  for (const account of accounts) for (const head of account.heads) due += Math.max(0, head.amount - head.paid);
  return accounts.length ? due : null;
}

export async function listDocuments(user, { status, type, limit = 50 } = {}) {
  const staff = isStaff(user);
  const filter = staff ? {} : { student: user._id };
  if (status) filter.status = status;
  if (type) filter.type = type;
  const docs = await DocumentRequest.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  const rows = [];
  for (const doc of docs) {
    const row = shapeDocument(doc, { staff });
    if (staff && doc.type === "NO_DUES" && OPEN.includes(doc.status)) {
      const due = await feesOutstanding(doc.student);
      row.evidence = {
        feesOutstanding: due,
        kind: "EVIDENCE",
        note: due === null ? "No fee ledger on record — Insufficient data" : due > 0 ? `₹${due.toLocaleString("en-IN")} outstanding on the fee ledger` : "Fee ledger shows no dues"
      };
    }
    rows.push(row);
  }
  const counts = await DocumentRequest.aggregate([{ $match: staff ? {} : { student: user._id } }, { $group: { _id: "$status", n: { $sum: 1 } } }]);
  return {
    documents: rows,
    counts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
    types: DOCUMENT_TYPES.map((t) => ({ type: t, label: TYPE_LABELS[t], slaHours: DOCUMENT_SLA_HOURS[t] })),
    method: "DATABASE_RECORDS",
    kind: "ACTUAL DATA"
  };
}

async function load(id) {
  const doc = await DocumentRequest.findById(id);
  if (!doc) throw ApiError.notFound("No document request with that id");
  return doc;
}

/** START_REVIEW, APPROVE or REJECT. Staff only (enforced in the route). */
export async function reviewDocument(id, actor, { decision, reason }) {
  const doc = await load(id);
  const previous = doc.status;
  if (decision === "START_REVIEW") {
    if (doc.status !== "SUBMITTED") throw ApiError.badRequest(`Cannot start review from ${doc.status}`);
    doc.status = "UNDER_REVIEW";
  } else if (decision === "APPROVE") {
    if (!["SUBMITTED", "UNDER_REVIEW"].includes(doc.status)) throw ApiError.badRequest(`Cannot approve from ${doc.status}`);
    doc.status = "APPROVED";
  } else if (decision === "REJECT") {
    if (!reason || String(reason).trim().length < 5) throw ApiError.badRequest("A rejection needs a reason (at least 5 characters)");
    if (!OPEN.includes(doc.status)) throw ApiError.badRequest(`Cannot reject from ${doc.status}`);
    doc.status = "REJECTED";
    doc.rejectionReason = String(reason).trim();
  } else {
    throw ApiError.badRequest("decision must be START_REVIEW, APPROVE or REJECT");
  }
  doc.reviewer = actor._id;
  doc.reviewerName = actor.name;
  // EXCEPTION-ONLY HOOK: who decided — the written policy (Touchless Lane) or a person.
  if (decision !== "START_REVIEW") doc.decidedBy = actor?.role === "POLICY" ? "POLICY" : "HUMAN";
  doc.reviewedAt = new Date();
  await audit(doc, { entityType: "DocumentRequest", action: `DOCUMENT_${decision}`, actor, field: "status", previousValue: previous, newValue: doc.status, note: reason });
  await doc.save();
  // EXCEPTION-ONLY HOOK: campus event log (fire-and-forget — never blocks or fails this request).
  emitEvent({ ...{ student: doc.student, subjectType: "DocumentRequest", subjectId: doc._id, subjectRef: doc.reference, department: "ACADEMIC OFFICE" }, type: decision === "REJECT" ? "CERTIFICATE_REJECTED" : "CERTIFICATE_REVIEWED", actor, channel: actor?.role === "POLICY" ? "POLICY" : "APP", payload: { decision, from: previous, to: doc.status } });
  return doc;
}

export async function issueDocument(id, actor, { now = new Date() } = {}) {
  const doc = await load(id);
  if (doc.status !== "APPROVED") throw ApiError.badRequest("Only an approved request can be issued");
  let code = newVerificationCode();
  while (await DocumentRequest.exists({ "certificate.verificationCode": code })) code = newVerificationCode();
  doc.certificate = {
    serial: doc.reference.replace("DOC", "CERT"),
    verificationCode: code,
    canonicalVersion: CANONICAL_VERSION,
    issuedAt: now,
    issuedByName: actor.name
  };
  doc.certificate.digest = sha256(canonicalContent(doc));
  doc.status = "ISSUED";
  await audit(doc, {
    entityType: "DocumentRequest",
    action: "DOCUMENT_ISSUED",
    actor,
    field: "status",
    previousValue: "APPROVED",
    newValue: "ISSUED",
    note: `code ${code} · sha256 ${doc.certificate.digest.slice(0, 16)}…`
  });
  await doc.save();
  // EXCEPTION-ONLY HOOK: campus event log (fire-and-forget — never blocks or fails this request).
  emitEvent({ ...{ student: doc.student, subjectType: "DocumentRequest", subjectId: doc._id, subjectRef: doc.reference, department: "ACADEMIC OFFICE" }, type: "CERTIFICATE_ISSUED", actor, channel: actor?.role === "POLICY" ? "POLICY" : "APP", payload: { docType: doc.type, code: doc.certificate.verificationCode } });
  return doc;
}

export async function revokeDocument(id, actor, reason) {
  const doc = await load(id);
  if (doc.status !== "ISSUED") throw ApiError.badRequest("Only an issued certificate can be revoked");
  if (doc.certificate.revokedAt) throw ApiError.conflict("Already revoked");
  if (!reason || String(reason).trim().length < 5) throw ApiError.badRequest("A revocation needs a reason");
  doc.certificate.revokedAt = new Date();
  doc.certificate.revokedByName = actor.name;
  doc.certificate.revocationReason = String(reason).trim();
  doc.markModified("certificate");
  await audit(doc, { entityType: "DocumentRequest", action: "CERTIFICATE_REVOKED", actor, field: "certificate", previousValue: "VALID", newValue: "REVOKED", note: reason });
  await doc.save();
  return doc;
}

/** Public verification — returns only what a third party needs. */
export async function verifyCode(rawCode) {
  const code = normaliseCode(rawCode);
  const doc = code ? await DocumentRequest.findOne({ "certificate.verificationCode": code }).lean() : null;
  const base = { code, method: "SHA256_DIGEST_OF_CANONICAL_CONTENT", checkedAt: new Date() };
  if (!doc) return { ...base, status: "NOT_FOUND", message: "No certificate was issued with this code." };
  const reproduced = sha256(canonicalContent(doc)) === doc.certificate.digest;
  const status = doc.certificate.revokedAt ? "REVOKED" : reproduced ? "VALID" : "TAMPERED";
  return {
    ...base,
    status,
    message:
      status === "VALID"
        ? "This certificate was issued by the institution and its recorded content is unchanged."
        : status === "REVOKED"
          ? "This certificate was issued but has since been revoked."
          : "The stored record no longer reproduces the digest recorded at issue — treat this certificate as invalid.",
    type: doc.type,
    typeLabel: TYPE_LABELS[doc.type],
    issuedAt: doc.certificate.issuedAt,
    serial: doc.certificate.serial,
    nameMasked: maskName(doc.studentSnapshot?.name),
    revokedAt: doc.certificate.revokedAt || null,
    revocationReason: doc.certificate.revokedAt ? doc.certificate.revocationReason : null,
    digestShort: doc.certificate.digest.slice(0, 16)
  };
}

/** Checks a copy's canonical content (typed or read out of the PDF). */
export async function verifyCopy(rawCode, content) {
  const result = await verifyCode(rawCode);
  if (result.status === "NOT_FOUND") return { ...result, copyMatches: false };
  const doc = await DocumentRequest.findOne({ "certificate.verificationCode": result.code }).lean();
  const copyMatches = sha256(String(content || "")) === doc.certificate.digest;
  return {
    ...result,
    copyMatches,
    copyMessage: copyMatches
      ? "The copy's content hashes to the digest recorded at issue."
      : "The copy's content does not match what was issued — it has been altered."
  };
}

/** Greedy word wrap by character count (Helvetica averages ~0.5 em). */
export function wrap(text, width) {
  const lines = [];
  let line = "";
  for (const word of String(text).split(/\s+/)) {
    if (line && (line + " " + word).length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.slice(0, 4);
}

export async function certificatePdf(id, user) {
  const doc = await DocumentRequest.findById(id).lean();
  if (!doc) throw ApiError.notFound("No document request with that id");
  if (!isStaff(user) && String(doc.student) !== String(user._id)) throw ApiError.forbidden("Not your document");
  if (doc.status !== "ISSUED") throw ApiError.badRequest("The certificate has not been issued yet");
  const canonical = canonicalContent(doc);
  const s = doc.studentSnapshot || {};
  const c = doc.certificate;
  const verifyUrl = `${verifyBaseUrl()}/verify/${c.verificationCode}`;
  const issued = new Date(c.issuedAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "long", year: "numeric" });
  const bodyLines = {
    BONAFIDE: [`This is to certify that ${s.name} (${s.studentId}) is a bonafide student of`, `${s.course || s.department}, semester ${s.semester ?? "—"}, for the academic year in progress.`],
    NO_DUES: [`This is to certify that ${s.name} (${s.studentId}) has no outstanding dues`, "with the institution as on the date of issue."],
    HOSTEL_RESIDENCE: [`This is to certify that ${s.name} (${s.studentId}) is a resident of`, `${s.hostelName || "the campus hostel"}${s.room ? `, room ${s.room}` : ""}.`],
    CHARACTER: [`This is to certify that ${s.name} (${s.studentId}) bears a good moral character`, "and no disciplinary proceedings are recorded against the student."]
  }[doc.type];
  const accent = [0.925, 0.188, 0.075];
  const items = [
    { kind: "rect", x: 0, y: PAGE.h - 14, w: PAGE.w, h: 14, color: accent },
    { kind: "text", x: 56, y: 780, size: 10, bold: true, text: "BIJU PATNAIK UNIVERSITY OF TECHNOLOGY · NEX CAMP", color: accent },
    { kind: "text", x: 56, y: 740, size: 28, bold: true, text: TYPE_LABELS[doc.type] },
    { kind: "text", x: 56, y: 718, size: 10, text: `Serial ${c.serial}   ·   Reference ${doc.reference}   ·   Issued ${issued}` },
    { kind: "rect", x: 56, y: 700, w: PAGE.w - 112, h: 1.5 },
    ...wrap(bodyLines.join(" "), 74).map((line, i) => ({ kind: "text", x: 56, y: 664 - i * 20, size: 13, text: line })),
    ...wrap(`Purpose: ${doc.purpose}`, 74).map((line, i) => ({ kind: "text", x: 56, y: 580 - i * 20, size: 13, text: line })),
    { kind: "text", x: 56, y: 520, size: 11, bold: true, text: c.issuedByName },
    { kind: "text", x: 56, y: 505, size: 10, text: "Issuing authority · Academic Office" },
    { kind: "rect", x: 56, y: 150, w: PAGE.w - 112, h: 290, stroke: 1.5 },
    { kind: "qr", x: 76, y: 190, size: 200, value: verifyUrl },
    { kind: "text", x: 300, y: 400, size: 10, bold: true, text: "VERIFY THIS CERTIFICATE", color: accent },
    { kind: "text", x: 300, y: 372, size: 22, bold: true, text: c.verificationCode },
    { kind: "text", x: 300, y: 350, size: 9, text: "Scan the QR code or open:" },
    { kind: "text", x: 300, y: 336, size: 9, text: verifyUrl },
    { kind: "text", x: 300, y: 300, size: 9, text: "SHA-256 of the canonical content:" },
    { kind: "text", x: 300, y: 286, size: 8, text: c.digest.slice(0, 32) },
    { kind: "text", x: 300, y: 274, size: 8, text: c.digest.slice(32) },
    { kind: "text", x: 300, y: 240, size: 8, text: "Only this digest is stored by the institution. Any change" },
    { kind: "text", x: 300, y: 228, size: 8, text: "to the certified details makes verification fail." },
    { kind: "text", x: 56, y: 120, size: 8, text: `Generated by NeX Camp · ${doc.channel === "KIOSK" ? `requested at the assisted-access kiosk (${doc.operator?.name || "operator"})` : "requested in the app"}` }
  ];
  return {
    filename: `${c.serial}.pdf`,
    buffer: await buildPdf(items, { title: `${TYPE_LABELS[doc.type]} ${c.serial}`, canonical, digest: c.digest })
  };
}
