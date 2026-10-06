import { Complaint } from "../../models/Complaint.js";
import { FixConfirmation } from "../../models/ext/FixConfirmation.js";
import { FixProof } from "../../models/ext/FixProof.js";
import { ReopenRequest } from "../../models/ext/ReopenRequest.js";
import { nextReference } from "../../models/ext/common.js";
import { ApiError } from "../../utils/ApiError.js";
import { round } from "../../utils/text.js";
import { audit } from "./extAudit.js";
import { createNotice } from "./noticeService.js";
import { emitEvent } from "../xo/eventService.js"; // EXCEPTION-ONLY HOOK

/**
 * Proof of fix and student confirmation (PS07 extension 2C).
 *
 * The existing resolve flow (PATCH /api/complaints/:id) is untouched. This adds
 * an optional proof step after it, a "Is it fixed?" question to the author, and
 * — on NOT FIXED — a new linked ReopenRequest. The original complaint's status
 * is never changed here.
 */

export const CONFIRM_WINDOW_HOURS = 144; // 6 days (144 hours) confirmation access
export const MAX_PHOTO_CHARS = 140_000; // ~100 KB of JPEG once base64-decoded
const PHOTO_PATTERN = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

export function validatePhoto(photo) {
  if (!photo) return null;
  if (typeof photo !== "string" || !PHOTO_PATTERN.test(photo)) throw ApiError.badRequest("photo must be a JPEG, PNG or WebP data URL");
  if (photo.length > MAX_PHOTO_CHARS) throw ApiError.badRequest(`photo is too large (${photo.length} characters; limit ${MAX_PHOTO_CHARS}). Compress it before upload.`);
  // The bytes must really be the declared image type, and more than a header.
  const [, type] = /^data:image\/(jpeg|png|webp)/.exec(photo);
  const head = Buffer.from(photo.split(",")[1].slice(0, 24), "base64");
  const magic = { jpeg: head[0] === 0xff && head[1] === 0xd8, png: head.subarray(0, 4).toString("hex") === "89504e47", webp: head.subarray(0, 4).toString() === "RIFF" && head.subarray(8, 12).toString() === "WEBP" };
  const bytes = Math.round((photo.split(",")[1].length * 3) / 4);
  if (!magic[type] || bytes < 64) throw ApiError.badRequest("photo is not a readable image of the declared type");
  return { photo, bytes };
}

/** Makes sure a resolved complaint has its confirmation question open. */
export async function ensureConfirmation(complaint, askedAt = new Date()) {
  const existing = await FixConfirmation.findOne({ complaint: complaint._id });
  if (existing) return existing;
  return FixConfirmation.create({
    complaint: complaint._id,
    complaintReference: complaint.reference,
    department: complaint.department,
    student: complaint.student,
    askedAt
  });
}

export async function attachProof(complaintId, actor, { note, photo }) {
  const complaint = await Complaint.findById(complaintId).lean();
  if (!complaint) throw ApiError.notFound("No complaint with that id");
  if (complaint.status !== "RESOLVED") throw ApiError.badRequest("Proof of fix can only be attached to a RESOLVED complaint");
  const image = validatePhoto(photo);
  if (!image && !note) throw ApiError.badRequest("Attach a photo, a note, or both");
  const proof = new FixProof({
    complaint: complaint._id,
    complaintReference: complaint.reference,
    department: complaint.department,
    note,
    photo: image?.photo,
    photoBytes: image?.bytes,
    by: actor._id,
    byName: actor.name,
    byRole: actor.role
  });
  await audit(proof, {
    entityType: "FixProof",
    action: "PROOF_OF_FIX_ATTACHED",
    actor,
    note: `${complaint.reference}${image ? ` · photo ${Math.round(image.bytes / 1024)} KB` : ""}${note ? ` · ${note.slice(0, 120)}` : ""}`
  });
  await proof.save();
  await ensureConfirmation(complaint);
  return shapeProof(proof.toObject());
}

export const shapeProof = (p, { withPhoto = true } = {}) => ({
  id: String(p._id),
  complaintReference: p.complaintReference,
  department: p.department,
  note: p.note || null,
  photo: withPhoto ? p.photo || null : undefined,
  hasPhoto: Boolean(p.photo),
  photoBytes: p.photoBytes || null,
  byName: p.byName,
  byRole: p.byRole,
  at: p.createdAt
});

export async function proofsFor(complaintId) {
  const rows = await FixProof.find({ complaint: complaintId }).sort({ createdAt: -1 }).lean();
  return rows.map((r) => shapeProof(r));
}

/** The author answers YES or NOT_FIXED. */
export async function confirmFix(complaintId, student, { response, comment }) {
  const complaintDoc = await Complaint.findById(complaintId);
  if (!complaintDoc) throw ApiError.notFound("No complaint with that id");
  if (student.role !== "STUDENT") throw ApiError.forbidden("Admin and Warden staff cannot confirm or dispute resolutions. Only students can perform this action.");
  if (String(complaintDoc.student) !== String(student._id)) throw ApiError.forbidden("Only the student who reported it can confirm or dispute the fix");
  if (complaintDoc.status !== "RESOLVED") throw ApiError.badRequest("The complaint is not marked resolved yet");

  // Normalize flag responses
  const isGreen = response === "YES" || response === "GREEN_FLAG";
  const isRed = response === "NOT_FIXED" || response === "RED_FLAG";
  const normResponse = isGreen ? "YES" : isRed ? "NOT_FIXED" : response;

  const confirmation = await ensureConfirmation(complaintDoc, complaintDoc.resolution?.resolvedAt || new Date());
  if (confirmation.response !== "PENDING") throw ApiError.conflict(`Already answered: ${confirmation.response}`);
  confirmation.response = normResponse;
  confirmation.respondedAt = new Date();
  confirmation.comment = comment;

  if (!complaintDoc.resolution) {
    complaintDoc.resolution = { resolvedAt: new Date() };
  }
  complaintDoc.resolution.confirmWindowDays = 6;
  complaintDoc.resolution.studentConfirmedAt = new Date();

  let reopen = null;
  if (isRed) {
    complaintDoc.resolution.studentFlag = "RED_FLAG";
    complaintDoc.resolution.studentDisputeReason = comment || "Problem persists (Red Flagged by student)";
    complaintDoc.status = "INVESTIGATING";
    complaintDoc.priority = "CRITICAL";
    complaintDoc.audit.push({
      actor: student.name,
      message: `RED FLAG DISPUTE raised by student: ${comment || "Problem persists after declared resolution"}`,
      kind: "ACTUAL DATA"
    });

    reopen = new ReopenRequest({
      reference: await nextReference("RPN"),
      complaint: complaintDoc._id,
      complaintReference: complaintDoc.reference,
      student: student._id,
      department: complaintDoc.department,
      reason: comment || "Student reports the problem is not fixed (RED FLAG)"
    });
    const notice = await createNotice(
      {
        title: `RED FLAG: ${complaintDoc.reference} disputed as NOT FIXED by student`,
        body: `The student who reported ${complaintDoc.reference} ("${complaintDoc.title}") has RED FLAGGED the resolution.${comment ? ` Dispute details: ${comment}.` : ""} Immediate re-investigation required.`,
        priority: "CRITICAL",
        audience: { departments: [complaintDoc.department || "GENERAL ADMINISTRATION"] },
        actionRequired: { label: "Re-inspect and address student Red Flag" }
      },
      null,
      { kind: "REOPEN", related: { kind: "ReopenRequest", id: String(reopen._id), reference: reopen.reference } }
    );
    reopen.notice = notice._id;
    await audit(reopen, { entityType: "ReopenRequest", action: "REOPEN_REQUESTED", actor: student, note: `${complaintDoc.reference} · department ${complaintDoc.department} notified (${notice.reference})` });
    await reopen.save();
    confirmation.reopen = reopen._id;
  } else if (isGreen) {
    complaintDoc.resolution.studentFlag = "GREEN_FLAG";
    complaintDoc.audit.push({
      actor: student.name,
      message: `GREEN FLAG CONFIRMATION: Student verified problem is resolved ✓${comment ? ` (${comment})` : ""}`,
      kind: "ACTUAL DATA"
    });
  }

  await complaintDoc.save();

  // EXCEPTION-ONLY HOOK: campus event log (fire-and-forget — never blocks or fails this request).
  emitEvent({ type: isRed ? "COMPLAINT_REOPENED" : "COMPLAINT_CONFIRMED_FIXED", actor: student, student, subjectType: "Complaint", subjectId: complaintDoc._id, subjectRef: complaintDoc.reference, department: complaintDoc.department, channel: "APP", payload: { response: normResponse, flag: isGreen ? "GREEN_FLAG" : "RED_FLAG", reopen: reopen?.reference } });
  await confirmation.save();
  return {
    response: confirmation.response,
    flag: complaintDoc.resolution.studentFlag,
    respondedAt: confirmation.respondedAt,
    reopen: reopen ? { id: String(reopen._id), reference: reopen.reference, status: reopen.status } : null
  };
}

export async function updateReopen(id, actor, { status, note }) {
  const reopen = await ReopenRequest.findById(id);
  if (!reopen) throw ApiError.notFound("No reopen request with that id");
  const order = ["OPEN", "ACKNOWLEDGED", "CLOSED"];
  if (order.indexOf(status) <= order.indexOf(reopen.status)) throw ApiError.badRequest(`Cannot move from ${reopen.status} to ${status}`);
  const previous = reopen.status;
  reopen.status = status;
  await audit(reopen, { entityType: "ReopenRequest", action: `REOPEN_${status}`, actor, field: "status", previousValue: previous, newValue: status, note });
  await reopen.save();
  return { id: String(reopen._id), reference: reopen.reference, status: reopen.status };
}

/** 48 hours without an answer is recorded as NO_RESPONSE. */
export async function expireConfirmations(now = new Date()) {
  // Every resolved complaint gets its question, asked from the moment it was
  // resolved — with or without a proof attached.
  const asked = await FixConfirmation.distinct("complaint");
  const missing = await Complaint.find({ status: "RESOLVED", _id: { $nin: asked } }).select("reference department student resolution updatedAt").limit(200).lean();
  for (const c of missing) await ensureConfirmation(c, c.resolution?.resolvedAt || c.updatedAt);
  const cutoff = new Date(now.getTime() - CONFIRM_WINDOW_HOURS * 3600000);
  const result = await FixConfirmation.updateMany({ response: "PENDING", askedAt: { $lte: cutoff } }, { $set: { response: "NO_RESPONSE", respondedAt: now } });
  return result.modifiedCount || 0;
}

/** What the author sees on their resolved complaints. */
export async function confirmationsFor(student) {
  const resolved = await Complaint.find({ student: student._id, status: "RESOLVED" }).select("reference title department resolution createdAt").lean();
  const [confirmations, proofs] = await Promise.all([
    FixConfirmation.find({ student: student._id }).populate("reopen", "reference status").lean(),
    FixProof.find({ complaint: { $in: resolved.map((c) => c._id) } }).sort({ createdAt: -1 }).lean()
  ]);
  return resolved.map((c) => {
    const conf = confirmations.find((x) => String(x.complaint) === String(c._id));
    const askedAt = conf?.askedAt || c.resolution?.resolvedAt || c.updatedAt;
    return {
      complaintId: String(c._id),
      reference: c.reference,
      title: c.title,
      department: c.department,
      resolvedAt: c.resolution?.resolvedAt || null,
      resolutionDescription: c.resolution?.resolutionDescription || null,
      proofs: proofs.filter((p) => String(p.complaint) === String(c._id)).map((p) => shapeProof(p)),
      response: conf?.response || "PENDING",
      respondedAt: conf?.respondedAt || null,
      reopen: conf?.reopen ? { reference: conf.reopen.reference, status: conf.reopen.status } : null,
      answerBy: askedAt ? new Date(new Date(askedAt).getTime() + CONFIRM_WINDOW_HOURS * 3600000) : null
    };
  });
}

/** Reopen rate and proof-of-fix rate per department. */
export async function fixMetrics() {
  const [resolved, proofs, confirmations, reopens] = await Promise.all([
    Complaint.find({ status: "RESOLVED" }).select("department").lean(),
    FixProof.distinct("complaint"),
    FixConfirmation.find().lean(),
    ReopenRequest.find().select("department status").lean()
  ]);
  const proofSet = new Set(proofs.map(String));
  const departments = [...new Set(resolved.map((c) => c.department || "UNROUTED"))].sort();
  const rows = departments.map((dept) => {
    const mine = resolved.filter((c) => (c.department || "UNROUTED") === dept);
    const withProof = mine.filter((c) => proofSet.has(String(c._id))).length;
    const conf = confirmations.filter((c) => (c.department || "UNROUTED") === dept);
    const yes = conf.filter((c) => c.response === "YES").length;
    const notFixed = conf.filter((c) => c.response === "NOT_FIXED").length;
    const noResponse = conf.filter((c) => c.response === "NO_RESPONSE").length;
    const pending = conf.filter((c) => c.response === "PENDING").length;
    const answered = yes + notFixed;
    return {
      department: dept,
      resolved: mine.length,
      withProof,
      proofRate: mine.length ? round((withProof / mine.length) * 100, 1) : null,
      confirmations: { yes, notFixed, noResponse, pending },
      reopenRate: answered ? round((notFixed / answered) * 100, 1) : null,
      reopenRequests: reopens.filter((r) => r.department === dept).length
    };
  });
  return {
    departments: rows,
    totals: {
      resolved: resolved.length,
      withProof: rows.reduce((t, r) => t + r.withProof, 0),
      notFixed: rows.reduce((t, r) => t + r.confirmations.notFixed, 0),
      answered: rows.reduce((t, r) => t + r.confirmations.yes + r.confirmations.notFixed, 0)
    },
    definitions: {
      proofRate: "Resolved complaints with at least one proof-of-fix record ÷ resolved complaints.",
      reopenRate: "NOT FIXED answers ÷ (YES + NOT FIXED answers). NO RESPONSE and pending are excluded; a rate over zero answers is shown as Insufficient data."
    },
    method: "DATABASE_AGGREGATION",
    kind: "ACTUAL DATA"
  };
}
