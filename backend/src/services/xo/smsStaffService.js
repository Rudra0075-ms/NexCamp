import { updateComplaint } from "../../controllers/complaintController.js";
import { Complaint } from "../../models/Complaint.js";
import { User } from "../../models/User.js";
import { FixConfirmation } from "../../models/ext/FixConfirmation.js";
import { SmsMessage } from "../../models/ext/SmsMessage.js";
import { SmsOutbox } from "../../models/xo/SmsOutbox.js";
import { StaffPhone } from "../../models/xo/StaffPhone.js";
import { updateComplaintSchema } from "../../validations/index.js";
import { record } from "../auditChainService.js";
import { maskPhone, normalisePhone, sendSms } from "../smsService.js";
import { confirmFix, ensureConfirmation } from "../ext/fixService.js";
import { profileFor, studentByPhone } from "../ext/profileService.js";
import { fit, phoneHash } from "../ext/smsKeywordService.js";
import { emitEvent } from "./eventService.js";

/**
 * Phase 9 — the SMS work loop, for staff and students on basic phones.
 *
 *   staff:   DONE CMP-1234 [note]           → complaint RESOLVED through the
 *                                              existing updateComplaint, and the
 *                                              student is asked "Is it fixed?"
 *            NEED PART CMP-1234 <part>      → INVESTIGATING, a line in the
 *                                              complaint's audit, the student told
 *   student: YES CMP-1234 / NO CMP-1234     → the existing confirmFix (NO opens a
 *            (or just YES / NO when only        reopen request, as in the app)
 *            one fix is waiting)
 *
 * Only a number registered in StaffPhone may send DONE / NEED PART. Anything
 * else falls through to the existing keyword channel unchanged (null return).
 */

const REF = /^CMP-\d{3,6}$/;

/** Pure: is this one of the work-loop commands? */
export function parseXoCommand(text) {
  const clean = String(text || "").trim().replace(/\s+/g, " ");
  const words = clean.split(" ");
  const first = (words[0] || "").toUpperCase();
  if (first === "DONE" || first === "FIXED") {
    const ref = (words[1] || "").toUpperCase();
    if (!REF.test(ref)) return { command: "DONE", error: "Send DONE CMP-1234 [what was done]" };
    return { command: "DONE", reference: ref, note: words.slice(2).join(" ").slice(0, 300) || null };
  }
  if (first === "NEED" && (words[1] || "").toUpperCase() === "PART") {
    const ref = (words[2] || "").toUpperCase();
    const part = words.slice(3).join(" ").slice(0, 120);
    if (!REF.test(ref) || !part) return { command: "NEED_PART", error: "Send NEED PART CMP-1234 <part>, e.g. NEED PART CMP-1234 tap washer" };
    return { command: "NEED_PART", reference: ref, part };
  }
  if (first === "YES" || first === "NO") {
    const ref = (words[1] || "").toUpperCase();
    if (ref && !REF.test(ref)) return null; // "no water in B-214" is a sentence, not an answer
    return { command: first === "YES" ? "CONFIRM_YES" : "CONFIRM_NO", reference: ref || null, comment: words.slice(ref ? 2 : 1).join(" ").slice(0, 300) || null };
  }
  return null;
}

export async function staffByPhone(phone) {
  const digits = String(phone || "").replace(/[^\d]/g, "").slice(-10);
  if (digits.length < 10) return null;
  const row = await StaffPhone.findOne({ phone: new RegExp(`${digits}$`), active: true }).lean();
  if (!row) return null;
  const user = await User.findById(row.staff);
  return user ? { user, label: row.label, departments: row.departments || [] } : null;
}

/** Sends a campus-initiated SMS to a student and keeps a copy in the outbox (audited). */
export async function notifyStudent(studentId, body, { purpose, relatedRef, actor }) {
  const student = await User.findById(studentId).lean();
  if (!student) return null;
  const profile = await profileFor(student);
  const phone = normalisePhone(profile.registeredPhone || student.phone);
  if (!phone) return { sent: false, reason: "no registered number" };
  const text = fit(body);
  const delivery = await sendSms(phone, text);
  const row = await SmsOutbox.create({ phoneMasked: maskPhone(phone), phoneHash: phoneHash(phone), to: student._id, body: text, purpose, relatedRef, delivery: delivery.delivered ? "SENT" : delivery.mode });
  await record({ entityType: "SmsOutbox", entityId: row._id, entityRef: relatedRef, action: `SMS_SENT_${purpose}`, actor, note: `to ${maskPhone(phone)} · ${row.delivery}` });
  return { sent: delivery.delivered, delivery: row.delivery, to: maskPhone(phone), body: text };
}

/** Runs the existing PATCH /complaints/:id controller with a stand-in request. */
async function updateViaController(user, id, body) {
  const { value, errors } = updateComplaintSchema(body);
  if (errors && Object.keys(errors).length) throw Object.assign(new Error(Object.values(errors)[0]), { status: 400 });
  const res = { status() { return this; }, json(p) { this.payload = p; return this; } };
  let failure = null;
  await updateComplaint({ user, params: { id: String(id) }, body: value, query: {} }, res, (e) => { failure = e; });
  if (failure) throw failure;
  return res.payload?.data?.complaint;
}

const allowed = (staff, complaint) => !staff.departments.length || staff.departments.includes(complaint.department);

async function done(staff, parsed) {
  const complaint = await Complaint.findOne({ reference: parsed.reference });
  if (!complaint) return { reply: `${parsed.reference} not found.`, outcome: "REFUSED" };
  if (!allowed(staff, complaint)) return { reply: `${parsed.reference} belongs to ${complaint.department}, not your team. Nothing changed.`, outcome: "REFUSED", relatedRef: complaint.reference };
  if (complaint.status === "RESOLVED") return { reply: `${parsed.reference} is already RESOLVED. Nothing changed.`, outcome: "OK", relatedRef: complaint.reference };
  const description = `${parsed.note || "Work done"} — ${staff.label} by SMS`;
  const updated = await updateViaController(staff.user, complaint._id, { status: "RESOLVED", resolutionDescription: description });
  const fresh = await Complaint.findById(complaint._id).lean();
  await ensureConfirmation(fresh, fresh.resolution?.resolvedAt || new Date());
  // The resolution above is the human touch; this event only records the channel it came through.
  emitEvent({ type: "COMPLAINT_WORK_DONE", actor: staff.user, student: fresh.student, subjectType: "Complaint", subjectId: fresh._id, subjectRef: fresh.reference, department: fresh.department, channel: "SMS", humanTouch: false, payload: { label: staff.label, note: parsed.note } });
  const asked = await notifyStudent(fresh.student, `${staff.label} marked ${fresh.reference} done. Is it fixed? Reply YES ${fresh.reference} or NO ${fresh.reference}`, { purpose: "FIX_CHECK", relatedRef: fresh.reference, actor: staff.user });
  const who = asked?.to ? `Student ${asked.to} asked "Is it fixed?"` : "Student has no registered number; they will see it in the app";
  return { reply: `${updated?.reference || fresh.reference} RESOLVED. ${who}. Thank you.`, outcome: "OK", relatedRef: fresh.reference, asked };
}

async function needPart(staff, parsed) {
  const complaint = await Complaint.findOne({ reference: parsed.reference });
  if (!complaint) return { reply: `${parsed.reference} not found.`, outcome: "REFUSED" };
  if (!allowed(staff, complaint)) return { reply: `${parsed.reference} belongs to ${complaint.department}, not your team. Nothing changed.`, outcome: "REFUSED", relatedRef: complaint.reference };
  if (complaint.status === "RESOLVED") return { reply: `${parsed.reference} is RESOLVED. Nothing changed.`, outcome: "OK", relatedRef: complaint.reference };
  const moved = complaint.status !== "INVESTIGATING";
  if (moved) await updateViaController(staff.user, complaint._id, { status: "INVESTIGATING" });
  await Complaint.updateOne({ _id: complaint._id }, { $push: { audit: { at: new Date(), actor: staff.user.name, message: `Waiting for a part: ${parsed.part} (${staff.label}, by SMS)`, kind: "ACTUAL DATA" } } });
  await record({ entityType: "Complaint", entityId: complaint._id, entityRef: complaint.reference, action: "COMPLAINT_NEEDS_PART", newValue: parsed.part, actor: staff.user, note: `${staff.label} · channel SMS` });
  emitEvent({ type: "COMPLAINT_NEEDS_PART", actor: staff.user, student: complaint.student, subjectType: "Complaint", subjectId: complaint._id, subjectRef: complaint.reference, department: complaint.department, channel: "SMS", humanTouch: !moved, payload: { part: parsed.part, label: staff.label } });
  const told = await notifyStudent(complaint.student, `${complaint.reference}: ${staff.label} is waiting for a part (${parsed.part}). We will tell you when it is fixed.`, { purpose: "NEEDS_PART", relatedRef: complaint.reference, actor: staff.user });
  return { reply: `${complaint.reference} INVESTIGATING, part noted: ${parsed.part}. Student ${told?.to ? "told by SMS" : "will see it in the app"}. Send DONE ${complaint.reference} when fixed.`, outcome: "OK", relatedRef: complaint.reference };
}

async function confirm(student, parsed) {
  let reference = parsed.reference;
  if (!reference) {
    const pending = await FixConfirmation.find({ student: student._id, response: "PENDING" }).sort({ askedAt: -1 }).limit(2).lean();
    if (pending.length !== 1) return { reply: pending.length ? `More than one fix is waiting. Reply YES CMP-1234 or NO CMP-1234.` : "No fix is waiting for your answer.", outcome: "OK" };
    reference = pending[0].complaintReference;
  }
  const complaint = await Complaint.findOne({ reference, student: student._id }).lean();
  if (!complaint) return { reply: `${reference}: not found for your number.`, outcome: "REFUSED" };
  const yes = parsed.command === "CONFIRM_YES";
  try {
    const r = await confirmFix(complaint._id, student, { response: yes ? "YES" : "NOT_FIXED", comment: parsed.comment || "Answered by SMS" });
    return { reply: yes ? `Thank you. ${reference} closed as fixed.` : `Sorry. ${reference} reopened as ${r.reopen?.reference}; the team is told. Reply STATUS ${reference}`, outcome: "OK", relatedRef: reference };
  } catch (error) {
    return { reply: `${reference}: ${error.message}.`, outcome: "REFUSED", relatedRef: reference };
  }
}

/**
 * Called by the keyword channel before its own dispatch. Returns null when the
 * message is not a work-loop command (or a YES/NO from an unregistered number),
 * so the existing behaviour is untouched.
 */
export async function handleXoSms({ phone, text, base }) {
  const parsed = parseXoCommand(text);
  if (!parsed) return null;
  const staffCommand = parsed.command === "DONE" || parsed.command === "NEED_PART";
  let result;
  let actor;
  let student = null;
  let staff = null;
  if (staffCommand) {
    staff = phone ? await staffByPhone(phone) : null;
    if (!staff) {
      result = { reply: "Only registered staff numbers can send DONE or NEED PART. Ask the facility office to register this number.", outcome: "REFUSED" };
    } else if (parsed.error) result = { reply: parsed.error, outcome: "OK" };
    else {
      actor = staff.user;
      try {
        result = parsed.command === "DONE" ? await done(staff, parsed) : await needPart(staff, parsed);
      } catch (error) {
        console.error("smsStaffService:", error.message);
        result = { reply: "Sorry, that could not be done right now. Try again or call the facility office.", outcome: "ERROR" };
      }
    }
  } else {
    student = phone ? await studentByPhone(phone) : null;
    if (!student) return null; // the keyword channel answers an unregistered number as it always has
    actor = student;
    result = await confirm(student, parsed);
  }
  const row = await SmsMessage.create({ ...base, student: student?._id, staff: staff?.user?._id, command: parsed.command, outcome: result.outcome, reply: fit(result.reply), relatedRef: result.relatedRef });
  if (actor) emitEvent({ type: "SMS_REQUEST", actor, student: student || undefined, subjectType: "SmsMessage", subjectId: row._id, subjectRef: result.relatedRef, channel: "SMS", humanTouch: false, payload: { command: parsed.command, outcome: result.outcome, simulated: base.simulated } });
  await record({ entityType: "SmsMessage", entityId: row._id, entityRef: result.relatedRef, action: `SMS_${parsed.command}`, actor: actor || { name: base.phoneMasked, role: "SYSTEM" }, note: `channel SMS · ${base.simulated ? "simulated" : base.via} · ${result.outcome}${staff ? ` · ${staff.label}` : ""}` });
  return { reply: row.reply, outcome: result.outcome, message: row, student: student || undefined, staff: staff ? { label: staff.label } : undefined, asked: result.asked };
}

/** Recent campus-initiated SMS, for the page-18 demo (masked numbers). */
export async function outbox({ limit = 20, user } = {}) {
  const filter = user && user.role === "STUDENT" ? { to: user._id } : {};
  const rows = await SmsOutbox.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  return {
    messages: rows.map((r) => ({ id: String(r._id), at: r.createdAt, to: r.phoneMasked, body: r.body, purpose: r.purpose, relatedRef: r.relatedRef, delivery: r.delivery })),
    note: "delivery 'console' means no SMS provider is configured: the message was printed on the server (SIMULATED), not sent to a handset.",
    method: "DATABASE_RECORDS",
    kind: "ACTUAL DATA"
  };
}

/** Registered staff numbers (masked) for the demo phone picker; staff only. */
export async function staffPhones() {
  const rows = await StaffPhone.find({ active: true }).populate("staff", "name role").lean();
  return rows.filter((r) => r.staff).map((r) => ({ phone: r.phone, masked: maskPhone(r.phone), label: r.label, name: r.staff.name, role: r.staff.role, departments: r.departments }));
}
