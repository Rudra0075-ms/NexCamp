import { GATE_PASS_APPROVER_ROLES, GATE_PASS_CLOSED_STATUS, ROLES, STAFF_ROLES } from "../config/constants.js";
import { env } from "../config/env.js";
import { Building } from "../models/Building.js";
import { GatePass } from "../models/GatePass.js";
import { Notification } from "../models/Notification.js";
import { User } from "../models/User.js";
import {
  assertScannable,
  buildPayload,
  codeMatches, // GATE-PASS QR FIX
  currentPayload, // GATE-PASS QR FIX
  issueToken,
  passCode, // GATE-PASS QR FIX
  minutesBetween,
  parsePayload,
  reconcile,
  renderQr,
  timerFor,
  tokenMatches
} from "../services/gatePassService.js";
import { otpState, sendParentOtp, verifyParentOtp } from "../services/otpService.js";
import { notify, notifyParent, notifyStaff } from "../services/notificationService.js";
import { maskPhone, normalisePhone, smsStatus } from "../services/smsService.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { pageMeta, paginate } from "../utils/pagination.js";
import { created, ok } from "../utils/respond.js";
import { emitEvent } from "../services/xo/eventService.js"; // EXCEPTION-ONLY HOOK

const isStaff = (user) => STAFF_ROLES.includes(user.role);
import { applyGatePassPolicy } from "../services/xo/touchlessService.js"; // EXCEPTION-ONLY HOOK
const canApprove = (user) => GATE_PASS_APPROVER_ROLES.includes(user.role);
const owns = (gatePass, user) => String(gatePass.student?._id || gatePass.student) === String(user._id);

/** One wire shape for a pass, used by every endpoint in this file. */
function shape(gatePass, { now = new Date() } = {}) {
  const student = gatePass.student;
  return {
    id: String(gatePass._id),
    reference: gatePass.reference,
    status: gatePass.status,
    student: student?.name
      ? {
          id: String(student._id),
          name: student.name,
          studentId: student.studentId,
          hostelName: student.hostelName,
          room: student.room,
          parentName: student.parentName
        }
      : student
        ? { id: String(student) }
        : null,
    hostelName: gatePass.hostelName,
    room: gatePass.room,
    date: gatePass.date,
    reason: gatePass.reason,
    destination: gatePass.destination,
    leaveAt: gatePass.leaveAt,
    expectedReturnAt: gatePass.expectedReturnAt,
    parent: {
      name: gatePass.parent?.name || null,
      phoneMasked: gatePass.parent?.phoneMasked || null,
      verified: Boolean(gatePass.parent?.verified),
      verifiedAt: gatePass.parent?.verifiedAt || null
    },
    approval: gatePass.approval?.decision
      ? {
          decision: gatePass.approval.decision,
          decidedBy: gatePass.approval.decidedByName,
          decidedAt: gatePass.approval.decidedAt,
          note: gatePass.approval.note
        }
      : null,
    exitAt: gatePass.exitAt || null,
    returnAt: gatePass.returnAt || null,
    actualDurationMinutes: gatePass.actualDurationMinutes ?? null,
    overdueMinutes: gatePass.overdueMinutes ?? null,
    qrIssued: Boolean(gatePass.pass?.issuedAt),
    scanCount: gatePass.pass?.scanCount || 0,
    timer: timerFor(gatePass, now),
    // EXCEPTION-ONLY HOOK: additive fields — who decided and the policy engine's verdict (null when none).
    decidedBy: gatePass.decidedBy || null,
    policyDecision: gatePass.policyDecision || null,
    policyUndo: gatePass.policyUndo || null,
    events: (gatePass.events || []).map((entry) => ({
      at: entry.at,
      actor: entry.actor,
      message: entry.message,
      status: entry.status,
      kind: entry.kind
    })),
    createdAt: gatePass.createdAt,
    updatedAt: gatePass.updatedAt
  };
}

/** Loads a pass and refuses it to anyone who is neither its owner nor staff. */
async function loadForActor(id, user, { withToken = false } = {}) {
  const query = GatePass.findById(id).populate("student", "name studentId hostelName room parentName");
  if (withToken) query.select("+pass.tokenHash +pass.nonce"); // GATE-PASS QR FIX: + the nonce, to re-show the same QR
  const gatePass = await query;
  if (!gatePass) throw ApiError.notFound("Gate pass not found");
  if (!isStaff(user) && !owns(gatePass, user)) {
    throw ApiError.forbidden("You can only read your own gate passes");
  }
  return gatePass;
}

/**
 * POST /api/gatepass
 * A student applies. The pass opens in PENDING_PARENT_VERIFICATION and the
 * guardian OTP goes out in the same request, so one action starts the chain.
 */
export const createGatePass = asyncHandler(async (req, res) => {
  if (req.user.role !== ROLES.STUDENT) {
    throw ApiError.forbidden("Only students apply for a gate pass");
  }

  const now = new Date();
  const leaveAt = new Date(req.body.leaveAt);
  const expectedReturnAt = new Date(req.body.expectedReturnAt);

  if (expectedReturnAt <= leaveAt) {
    throw ApiError.badRequest("The return time must be after the leaving time");
  }
  const durationMinutes = minutesBetween(leaveAt, expectedReturnAt);
  if (durationMinutes > env.gatePass.maxDurationHours * 60) {
    throw ApiError.badRequest(`A gate pass may not exceed ${env.gatePass.maxDurationHours} hours`);
  }
  if (leaveAt.getTime() < now.getTime() - 60 * 60_000) {
    throw ApiError.badRequest("The leaving time is in the past");
  }

  const open = await GatePass.findOne({
    student: req.user._id,
    status: { $nin: GATE_PASS_CLOSED_STATUS }
  });
  if (open) {
    throw ApiError.conflict(`You already have an open gate pass (${open.reference}). Close it before applying again.`);
  }

  const student = await User.findById(req.user._id).select("+parentPhone");
  const phone = normalisePhone(req.body.parentPhone || student.parentPhone);
  if (!phone) {
    throw ApiError.badRequest(
      "No guardian phone number is on file. Add one to your profile, or supply parentPhone with this application."
    );
  }
  // A number supplied with the application is kept on the profile so a later
  // pass does not have to ask again.
  if (!student.parentPhone || (req.body.parentPhone && phone !== student.parentPhone)) {
    student.parentPhone = phone;
  }
  if (req.body.parentName && req.body.parentName !== student.parentName) {
    student.parentName = req.body.parentName;
  }
  if (student.isModified()) await student.save();

  const hostel = student.hostel ? await Building.findById(student.hostel) : null;

  const gatePass = new GatePass({
    student: student._id,
    hostel: hostel?._id,
    hostelName: hostel?.name || student.hostelName,
    room: student.room,
    date: req.body.date || leaveAt,
    reason: req.body.reason,
    destination: req.body.destination,
    leaveAt,
    expectedReturnAt,
    status: "PENDING_PARENT_VERIFICATION",
    parent: {
      name: req.body.parentName || student.parentName,
      phoneMasked: maskPhone(phone),
      verified: false
    }
  });
  gatePass.log(
    student.name,
    `Gate pass requested · ${gatePass.destination || "destination not stated"} · ${durationMinutes} minute(s)`,
    "ACTUAL DATA"
  );
  if (req.kiosk) {
    gatePass.channel = "KIOSK";
    gatePass.log(req.operator.name, `Applied at the assisted-access kiosk by ${req.operator.name} (${req.operator.role})`, "ACTUAL DATA");
  }

  await gatePass.save();

  const otp = await sendParentOtp({ gatePass, studentName: student.name, phone });
  gatePass.log("otpService", `Verification code sent to guardian ${otp.phoneMasked}`, "ACTUAL DATA");
  await gatePass.save();

  // EXCEPTION-ONLY HOOK: campus event log (fire-and-forget — never blocks or fails this request).
  emitEvent({ ...{ student: gatePass.student?._id || gatePass.student, subjectType: "GatePass", subjectId: gatePass._id, subjectRef: gatePass.reference }, type: "GATEPASS_APPLIED", actor: req.user, channel: req.kiosk ? "KIOSK" : "APP", payload: { leaveAt, expectedReturnAt, durationMinutes, operator: req.operator?.name } });

  await gatePass.populate("student", "name studentId hostelName room parentName");

  return created(
    res,
    {
      gatePass: shape(gatePass),
      otp: { phoneMasked: otp.phoneMasked, expiresAt: otp.expiresAt, delivery: otp.delivery, devCode: otp.devCode },
      sms: smsStatus()
    },
    "Gate pass submitted — waiting for guardian verification"
  );
});

/**
 * GET /api/gatepass
 * A student sees their own passes. Staff see the queue, filterable by status
 * and scoped to their own hostel when they are a warden of one.
 */
export const listGatePasses = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = {};

  if (isStaff(req.user) && req.query.mine !== "true") {
    if (req.user.role === ROLES.WARDEN && req.user.hostel && req.query.all !== "true") {
      filter.hostel = req.user.hostel;
    }
  } else {
    filter.student = req.user._id;
  }

  if (req.query.status) {
    filter.status = { $in: String(req.query.status).toUpperCase().split(",").map((s) => s.trim()) };
  }
  if (req.query.open === "true") filter.status = { $nin: GATE_PASS_CLOSED_STATUS };

  const [rows, total] = await Promise.all([
    GatePass.find(filter)
      .populate("student", "name studentId hostelName room parentName")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    GatePass.countDocuments(filter)
  ]);

  // Bring anything that ran past its return time up to date before answering.
  const now = new Date();
  await Promise.all(rows.map((row) => reconcile(row, now)));

  return ok(res, {
    gatePasses: rows.map((row) => shape(row, { now })),
    meta: pageMeta(page, limit, total),
    sms: smsStatus()
  });
});

/**
 * GET /api/gatepass/summary
 * The counts the warden console header shows.
 */
export const gatePassSummary = asyncHandler(async (req, res) => {
  const scope = {};
  if (req.user.role === ROLES.WARDEN && req.user.hostel && req.query.all !== "true") {
    scope.hostel = req.user.hostel;
  }

  const rows = await GatePass.aggregate([
    { $match: scope },
    { $group: { _id: "$status", count: { $sum: 1 } } }
  ]);
  const byStatus = Object.fromEntries(rows.map((row) => [row._id, row.count]));

  return ok(res, {
    byStatus,
    awaitingApproval: byStatus.PENDING_WARDEN_APPROVAL || 0,
    active: byStatus.ACTIVE || 0,
    overdue: byStatus.OVERDUE || 0,
    returned: (byStatus.RETURNED || 0) + (byStatus.RETURNED_LATE || 0),
    total: rows.reduce((sum, row) => sum + row.count, 0)
  });
});

/** GET /api/gatepass/:id */
export const getGatePass = asyncHandler(async (req, res) => {
  const gatePass = await loadForActor(req.params.id, req.user);
  await reconcile(gatePass);
  return ok(res, { gatePass: shape(gatePass), otp: await otpState(gatePass._id) });
});

/**
 * GET /api/gatepass/:id/status
 * The lightweight poll the countdown reads. Cheap enough to call every few
 * seconds, and it is what makes a browser refresh harmless.
 */
export const getGatePassStatus = asyncHandler(async (req, res) => {
  const gatePass = await loadForActor(req.params.id, req.user);
  await reconcile(gatePass);
  return ok(res, {
    id: String(gatePass._id),
    reference: gatePass.reference,
    status: gatePass.status,
    timer: timerFor(gatePass),
    serverTime: new Date().toISOString()
  });
});

/**
 * GET /api/gatepass/:id/qr
 * Re-renders the QR for an approved pass.
 *
 * GATE-PASS QR FIX (see CHANGES-GATEPASS-QR-FIX.md): the token used to be
 * re-issued on every call, so any second screen that opened the pass (the
 * laptop used to scan, another tab, a warden) silently retired the QR on the
 * student's phone. Now the current QR is shown again, and a new token is
 * minted only on ?rotate=1 (REGENERATE QR) or when no current one can be
 * re-rendered. Rotating still retires every earlier copy, as before.
 */
export const getGatePassQr = asyncHandler(async (req, res) => {
  const gatePass = await loadForActor(req.params.id, req.user, { withToken: true });
  await reconcile(gatePass);

  if (!["APPROVED", "ACTIVE", "OVERDUE"].includes(gatePass.status)) {
    throw ApiError.badRequest("A QR code exists only for an approved pass");
  }
  if (!owns(gatePass, req.user) && !isStaff(req.user)) throw ApiError.forbidden();

  const rotate = ["1", "true"].includes(String(req.query.rotate || "").toLowerCase());
  let payload = rotate ? null : currentPayload(gatePass);
  const rotated = !payload;
  if (!payload) {
    payload = issueToken(gatePass);
    await gatePass.save();
  }

  // `code` and `rotated` are additive fields: the typeable pass code and whether a new token was minted.
  return ok(res, { reference: gatePass.reference, payload, dataUrl: await renderQr(payload), status: gatePass.status, code: passCode(gatePass), rotated });
});

/** POST /api/gatepass/:id/send-otp — resend the guardian code. */
export const sendGatePassOtp = asyncHandler(async (req, res) => {
  const gatePass = await loadForActor(req.params.id, req.user);
  if (!owns(gatePass, req.user)) throw ApiError.forbidden("Only the applicant can request the guardian code");
  if (gatePass.status !== "PENDING_PARENT_VERIFICATION") {
    throw ApiError.badRequest("This pass is past guardian verification");
  }

  const student = await User.findById(gatePass.student).select("+parentPhone name");
  const phone = normalisePhone(student?.parentPhone);
  if (!phone) throw ApiError.badRequest("No guardian phone number is on file");

  const otp = await sendParentOtp({ gatePass, studentName: student.name, phone });
  gatePass.log("otpService", `Verification code re-sent to guardian ${otp.phoneMasked}`, "ACTUAL DATA");
  await gatePass.save();

  return ok(
    res,
    { otp: { phoneMasked: otp.phoneMasked, expiresAt: otp.expiresAt, delivery: otp.delivery, devCode: otp.devCode }, sms: smsStatus() },
    "Verification code sent"
  );
});

/**
 * POST /api/gatepass/:id/verify-otp
 * On success the pass moves through PARENT_VERIFIED and lands in the warden's
 * queue, and the warden and administration are told it is waiting.
 */
export const verifyGatePassOtp = asyncHandler(async (req, res) => {
  const gatePass = await loadForActor(req.params.id, req.user);
  if (!owns(gatePass, req.user)) throw ApiError.forbidden("Only the applicant can enter the guardian code");
  if (gatePass.status !== "PENDING_PARENT_VERIFICATION") {
    throw ApiError.badRequest("This pass is past guardian verification");
  }

  const { phoneMasked, verifiedAt } = await verifyParentOtp({ gatePass, code: req.body.code });

  gatePass.parent.verified = true;
  gatePass.parent.verifiedAt = verifiedAt;
  gatePass.parent.phoneMasked = phoneMasked || gatePass.parent.phoneMasked;
  gatePass.status = "PARENT_VERIFIED";
  gatePass.log("otpService", `Guardian ${phoneMasked} verified the outing by one-time code`, "ACTUAL DATA");

  gatePass.status = "PENDING_WARDEN_APPROVAL";
  gatePass.log("gatePassService", "Forwarded to the hostel warden for approval", "ACTUAL DATA");
  await gatePass.save();
  // EXCEPTION-ONLY HOOK: campus event log (fire-and-forget — never blocks or fails this request).
  emitEvent({ ...{ student: gatePass.student?._id || gatePass.student, subjectType: "GatePass", subjectId: gatePass._id, subjectRef: gatePass.reference }, type: "GATEPASS_OTP_VERIFIED", actor: req.user, channel: req.kiosk ? "KIOSK" : "APP", payload: { verifiedAt } });

  // EXCEPTION-ONLY HOOK: the Touchless Lane. After the guardian's code (never skipped), an in-policy
  // outing is approved under the cited rule and the warden is told FYI with UNDO; anything
  // else stays in the warden's queue exactly as before, now with the failed conditions.
  const lane = await applyGatePassPolicy(gatePass);
  if (lane.approved) {
    await gatePass.populate("student", "name studentId hostelName room parentName");
    return ok(res, { gatePass: shape(gatePass), policy: lane.policy, qr: { payload: lane.payload, dataUrl: await renderQr(lane.payload), code: passCode(gatePass) } }, `Guardian verified — approved under ${lane.policy.citation?.section || "policy"}`);
  }

  await notifyStaff({
    kind: "GATE_PASS_SUBMITTED",
    gatePass,
    hostelId: gatePass.hostel,
    title: `Gate pass awaiting approval — ${gatePass.student?.name || "student"}`,
    body: `${gatePass.reference} · ${gatePass.hostelName || "hostel"} · ${gatePass.reason}`,
    tone: "mid"
  });

  return ok(res, { gatePass: shape(gatePass), policy: lane.policy }, "Guardian verified — waiting for warden approval");
});

/**
 * POST /api/gatepass/:id/approve
 * Warden or admin only. Issues the QR token in the same transaction, so an
 * approved pass always has something to scan.
 */
export const approveGatePass = asyncHandler(async (req, res) => {
  if (!canApprove(req.user)) throw ApiError.forbidden("Only a warden or administrator may approve a gate pass");

  const gatePass = await GatePass.findById(req.params.id)
    .select("+pass.tokenHash")
    .populate("student", "name studentId hostelName room parentName");
  if (!gatePass) throw ApiError.notFound("Gate pass not found");
  if (owns(gatePass, req.user)) throw ApiError.forbidden("You cannot approve your own gate pass");
  if (gatePass.status !== "PENDING_WARDEN_APPROVAL") {
    throw ApiError.badRequest(`A pass in ${gatePass.status} cannot be approved`);
  }

  // A warden may shorten (never lengthen past the cap) the approved window.
  if (req.body.expectedReturnAt) {
    const revised = new Date(req.body.expectedReturnAt);
    if (revised <= new Date(gatePass.leaveAt)) {
      throw ApiError.badRequest("The revised return time must be after the leaving time");
    }
    if (minutesBetween(new Date(gatePass.leaveAt), revised) > env.gatePass.maxDurationHours * 60) {
      throw ApiError.badRequest(`A gate pass may not exceed ${env.gatePass.maxDurationHours} hours`);
    }
    gatePass.expectedReturnAt = revised;
  }

  gatePass.decidedBy = "HUMAN"; // EXCEPTION-ONLY HOOK: a person decided this pass
  gatePass.status = "APPROVED";
  gatePass.approval = {
    decision: "APPROVED",
    decidedBy: req.user._id,
    decidedByName: req.user.name,
    decidedAt: new Date(),
    note: req.body.note
  };
  const payload = issueToken(gatePass);
  gatePass.log(
    req.user.name,
    `Approved · valid until ${new Date(gatePass.expectedReturnAt).toISOString()} · QR issued`,
    "ACTUAL DATA"
  );
  await gatePass.save();

  await notify({
    kind: "GATE_PASS_APPROVED",
    audience: "STUDENT",
    user: gatePass.student?._id || gatePass.student,
    gatePass: gatePass._id,
    title: "Gate pass approved",
    body: `${gatePass.reference} is approved. Scan your QR at the gate when you leave.`,
    tone: "low"
  });

  const student = await User.findById(gatePass.student?._id || gatePass.student).select("+parentPhone name");
  if (student?.parentPhone) {
    await notifyParent({
      kind: "GATE_PASS_APPROVED",
      gatePass,
      phone: student.parentPhone,
      title: "Gate pass approved",
      body:
        `${student.name}'s gate pass ${gatePass.reference} has been approved by the hostel warden. ` +
        `Expected back by ${new Date(gatePass.expectedReturnAt).toLocaleString("en-IN", { hour12: true })}.`
    });
  }

  // EXCEPTION-ONLY HOOK: campus event log (fire-and-forget — never blocks or fails this request).
  emitEvent({ ...{ student: gatePass.student?._id || gatePass.student, subjectType: "GatePass", subjectId: gatePass._id, subjectRef: gatePass.reference }, type: "GATEPASS_APPROVED", actor: req.user, channel: "APP", payload: { note: req.body.note } });

  return ok(res, { gatePass: shape(gatePass), qr: { payload, dataUrl: await renderQr(payload) } }, "Gate pass approved");
});

/** POST /api/gatepass/:id/reject — warden or admin only. */
export const rejectGatePass = asyncHandler(async (req, res) => {
  if (!canApprove(req.user)) throw ApiError.forbidden("Only a warden or administrator may reject a gate pass");

  const gatePass = await GatePass.findById(req.params.id).populate(
    "student",
    "name studentId hostelName room parentName"
  );
  if (!gatePass) throw ApiError.notFound("Gate pass not found");
  if (owns(gatePass, req.user)) throw ApiError.forbidden("You cannot decide your own gate pass");
  if (!["PENDING_WARDEN_APPROVAL", "PARENT_VERIFIED", "PENDING_PARENT_VERIFICATION"].includes(gatePass.status)) {
    throw ApiError.badRequest(`A pass in ${gatePass.status} cannot be rejected`);
  }

  gatePass.decidedBy = "HUMAN"; // EXCEPTION-ONLY HOOK: a person decided this pass
  gatePass.status = "REJECTED";
  gatePass.approval = {
    decision: "REJECTED",
    decidedBy: req.user._id,
    decidedByName: req.user.name,
    decidedAt: new Date(),
    note: req.body.note
  };
  gatePass.log(req.user.name, `Rejected${req.body.note ? ` · ${req.body.note}` : ""}`, "ACTUAL DATA");
  await gatePass.save();

  await notify({
    kind: "GATE_PASS_REJECTED",
    audience: "STUDENT",
    user: gatePass.student?._id || gatePass.student,
    gatePass: gatePass._id,
    title: "Gate pass rejected",
    body: `${gatePass.reference} was not approved${req.body.note ? `: ${req.body.note}` : "."}`,
    tone: "high"
  });

  // EXCEPTION-ONLY HOOK: campus event log (fire-and-forget — never blocks or fails this request).
  emitEvent({ ...{ student: gatePass.student?._id || gatePass.student, subjectType: "GatePass", subjectId: gatePass._id, subjectRef: gatePass.reference }, type: "GATEPASS_REJECTED", actor: req.user, channel: "APP", payload: { note: req.body.note } });

  return ok(res, { gatePass: shape(gatePass) }, "Gate pass rejected");
});

/** POST /api/gatepass/:id/cancel — the applicant withdraws before leaving. */
export const cancelGatePass = asyncHandler(async (req, res) => {
  const gatePass = await loadForActor(req.params.id, req.user);
  if (!owns(gatePass, req.user)) throw ApiError.forbidden("Only the applicant can cancel a gate pass");
  if (["ACTIVE", "OVERDUE", ...GATE_PASS_CLOSED_STATUS].includes(gatePass.status)) {
    throw ApiError.badRequest(`A pass in ${gatePass.status} cannot be cancelled`);
  }

  gatePass.status = "CANCELLED";
  gatePass.log(req.user.name, "Cancelled by the applicant", "ACTUAL DATA");
  await gatePass.save();
  return ok(res, { gatePass: shape(gatePass) }, "Gate pass cancelled");
});

/**
 * POST /api/gatepass/scan
 * The single endpoint both scans go through. Which transition it performs is
 * decided here from the stored status — the scanner has no say in it.
 *
 * Validation, in order: does the pass exist, does the token match, is the
 * scanner entitled to it, is the pass in a scannable state, and has it already
 * been used. A failure at any step activates nothing.
 */
export const scanGatePass = asyncHandler(async (req, res) => {
  const parsed = parsePayload(req.body.token);
  if (!parsed) throw ApiError.badRequest("That QR code is not a campus gate pass");
  // GATE-PASS QR FIX: a typed pass ID without its code gets told what is missing.
  if (parsed.error) throw ApiError.badRequest(parsed.error);

  const gatePass = await GatePass.findOne({ reference: parsed.reference })
    .select("+pass.tokenHash +pass.nonce")
    .populate("student", "name studentId hostelName room parentName");
  if (!gatePass) throw ApiError.notFound("No gate pass matches that code");
  // GATE-PASS QR FIX: the QR token, or the pass ID + 8-character code typed by hand.
  const valid = parsed.token ? tokenMatches(gatePass.pass?.tokenHash, parsed.token) : codeMatches(gatePass, parsed.code);
  if (!valid) {
    throw ApiError.badRequest(
      parsed.token
        ? "That gate pass code is not valid — this QR was replaced by a newer one or has already been used. Show the latest QR on page 11."
        : "That gate pass code is not valid — check the 8-character code shown under the QR."
    );
  }
  // Either the student it belongs to, or staff acting as gate security.
  if (!isStaff(req.user) && !owns(gatePass, req.user)) {
    throw ApiError.forbidden("This gate pass belongs to another student");
  }

  const now = new Date();
  await reconcile(gatePass, now);
  const action = assertScannable(gatePass, now);

  if (action === "EXIT") {
    gatePass.status = "ACTIVE";
    gatePass.exitAt = now;
    gatePass.pass.exitScanAt = now;
    gatePass.pass.scanCount = (gatePass.pass.scanCount || 0) + 1;
    // The approved window runs from the real exit, so the clock the student
    // sees is the clock the warden approved.
    const approvedMinutes = minutesBetween(new Date(gatePass.leaveAt), new Date(gatePass.expectedReturnAt));
    gatePass.expectedReturnAt = new Date(now.getTime() + approvedMinutes * 60_000);
    gatePass.warningSentAt = undefined;
    gatePass.log(
      req.user.name,
      `Exit scan accepted at the gate · pass ACTIVE for ${approvedMinutes} minute(s)`,
      "ACTUAL DATA"
    );
    await gatePass.save();

    await notify({
      kind: "GATE_PASS_ACTIVE",
      audience: "STUDENT",
      user: gatePass.student?._id || gatePass.student,
      gatePass: gatePass._id,
      title: "Gate pass active",
      body: `Return by ${new Date(gatePass.expectedReturnAt).toLocaleTimeString("en-IN", { hour12: true })}.`,
      tone: "mid"
    });

    // EXCEPTION-ONLY HOOK: campus event log (fire-and-forget — never blocks or fails this request).
    emitEvent({ ...{ student: gatePass.student?._id || gatePass.student, subjectType: "GatePass", subjectId: gatePass._id, subjectRef: gatePass.reference }, type: "GATEPASS_EXITED", actor: req.user, channel: "APP", humanTouch: false, payload: { at: now } });

    return ok(res, { result: "VALID", action: "EXIT", gatePass: shape(gatePass, { now }) }, "Gate pass active");
  }

  // RETURN
  const late = now > new Date(gatePass.expectedReturnAt);
  gatePass.status = late ? "RETURNED_LATE" : "RETURNED";
  gatePass.returnAt = now;
  gatePass.pass.returnScanAt = now;
  gatePass.pass.scanCount = (gatePass.pass.scanCount || 0) + 1;
  gatePass.actualDurationMinutes = gatePass.exitAt ? minutesBetween(new Date(gatePass.exitAt), now) : null;
  gatePass.overdueMinutes = late ? minutesBetween(new Date(gatePass.expectedReturnAt), now) : 0;
  // Spent: the token cannot open anything again.
  gatePass.pass.tokenHash = undefined;
  gatePass.pass.nonce = undefined; // GATE-PASS QR FIX: the typeable code dies with the token
  gatePass.log(
    req.user.name,
    late
      ? `Return scan accepted · ${gatePass.overdueMinutes} minute(s) late`
      : "Return scan accepted · returned on time",
    "ACTUAL DATA"
  );
  await gatePass.save();

  await notify({
    kind: "GATE_PASS_RETURNED",
    audience: "STUDENT",
    user: gatePass.student?._id || gatePass.student,
    gatePass: gatePass._id,
    title: late ? "Gate pass completed — returned late" : "Gate pass completed",
    body: `${gatePass.reference} closed at ${now.toLocaleTimeString("en-IN", { hour12: true })}.`,
    tone: late ? "high" : "low"
  });

  if (late) {
    await notifyStaff({
      kind: "GATE_PASS_RETURNED",
      gatePass,
      hostelId: gatePass.hostel,
      title: `Late return — ${gatePass.student?.name || "student"}`,
      body: `${gatePass.reference} returned ${gatePass.overdueMinutes} minute(s) after the approved time.`
    });
  }

  // EXCEPTION-ONLY HOOK: campus event log (fire-and-forget — never blocks or fails this request).
  emitEvent({ ...{ student: gatePass.student?._id || gatePass.student, subjectType: "GatePass", subjectId: gatePass._id, subjectRef: gatePass.reference }, type: "GATEPASS_RETURNED", actor: req.user, channel: "APP", humanTouch: false, payload: { late, overdueMinutes: gatePass.overdueMinutes } });

  return ok(
    res,
    { result: "VALID", action: "RETURN", gatePass: shape(gatePass, { now }) },
    late ? "Gate pass completed — returned late" : "Gate pass completed"
  );
});

/** GET /api/gatepass/notifications — the signed-in user's own alerts. */
export const listGatePassNotifications = asyncHandler(async (req, res) => {
  const rows = await Notification.find({ user: req.user._id })
    .populate("gatePass", "reference status")
    .sort({ createdAt: -1 })
    .limit(30);

  return ok(res, {
    notifications: rows.map((row) => ({
      id: String(row._id),
      kind: row.kind,
      audience: row.audience,
      title: row.title,
      body: row.body,
      tone: row.tone,
      read: Boolean(row.readAt),
      gatePass: row.gatePass ? { id: String(row.gatePass._id), reference: row.gatePass.reference, status: row.gatePass.status } : null,
      createdAt: row.createdAt
    })),
    unread: rows.filter((row) => !row.readAt).length
  });
});

/** POST /api/gatepass/notifications/:id/read */
export const readGatePassNotification = asyncHandler(async (req, res) => {
  const row = await Notification.findOne({ _id: req.params.id, user: req.user._id });
  if (!row) throw ApiError.notFound("Notification not found");
  if (!row.readAt) {
    row.readAt = new Date();
    await row.save();
  }
  return ok(res, { id: String(row._id), read: true });
});

/** GET /api/gatepass/config — what the interface needs to render, no secrets. */
export const gatePassConfig = asyncHandler(async (req, res) => {
  const student = req.user.role === ROLES.STUDENT ? await User.findById(req.user._id).select("+parentPhone") : null;
  return ok(res, {
    sms: smsStatus(),
    maxDurationHours: env.gatePass.maxDurationHours,
    otpTtlMinutes: env.gatePass.otpTtlMinutes,
    warningMinutes: 5,
    canApprove: canApprove(req.user),
    parentOnFile: student ? { name: student.parentName || null, phoneMasked: maskPhone(student.parentPhone) || null } : null,
    serverTime: new Date().toISOString()
  });
});
