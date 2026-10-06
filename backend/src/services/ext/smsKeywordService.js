import crypto from "node:crypto";
import { CATEGORIES, GATE_PASS_CLOSED_STATUS } from "../../config/constants.js";
import { createComplaint } from "../../controllers/complaintController.js";
import { Complaint } from "../../models/Complaint.js";
import { GatePass } from "../../models/GatePass.js";
import { NoticeReceipt } from "../../models/ext/NoticeReceipt.js";
import { SmsMessage } from "../../models/ext/SmsMessage.js";
import { createComplaintSchema } from "../../validations/index.js";
import { record } from "../auditChainService.js";
import { simulate, summariseStudent } from "../attendanceService.js";
import { maskPhone, normalisePhone, sendSms } from "../smsService.js";
import { nextMeal } from "./messChangeService.js";
import { studentByPhone } from "./profileService.js";
import { emitEvent } from "../xo/eventService.js"; // EXCEPTION-ONLY HOOK
import { handleXoSms } from "../xo/smsStaffService.js"; // EXCEPTION-ONLY HOOK

/**
 * SMS keyword channel (PS07 extension 2B) — campus services from a basic
 * phone, with no staff in the loop.
 *
 * Commands are accepted only from a student's registered number, are
 * rate-limited per number, and every reply fits in one 160-character SMS.
 * Filing a complaint calls the existing createComplaint controller exactly as
 * the app does; the new record is then marked channel SMS.
 */

export const SMS_MAX = 160;
export const RATE_LIMIT = { windowMinutes: 10, max: 8 };

const CATEGORY_ALIASES = { WIFI: "WI-FI", "WI-FI": "WI-FI", NET: "WI-FI", POWER: "ELECTRICITY", LIGHT: "ELECTRICITY", CLEAN: "CLEANLINESS", FOOD: "MESS", MEDICAL: "HEALTH" };

export function fit(text, max = SMS_MAX) {
  const clean = String(text).replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export const phoneHash = (phone) => crypto.createHash("sha256").update(String(normalisePhone(phone) || phone)).digest("hex");

/** Pure: which command a message is. */
export function parseCommand(text) {
  const clean = String(text || "").trim().replace(/\s+/g, " ");
  const [first = "", ...rest] = clean.split(" ");
  const word = first.toUpperCase();
  if (!word) return { command: "EMPTY" };
  if (word === "HELP" || word === "?") return { command: "HELP" };
  if (word === "ATT") return { command: "ATT" };
  if (word === "GP") return { command: "GP" };
  if (word === "MENU") return { command: "MENU" };
  if (word === "NOTICE" || word === "NOTICES") return { command: "NOTICE" };
  if (word === "STATUS") {
    const ref = (rest[0] || "").toUpperCase();
    return /^CMP-\d{3,6}$/.test(ref) ? { command: "STATUS", reference: ref } : { command: "STATUS", error: "Send STATUS CMP-1234" };
  }
  const category = CATEGORIES.includes(word) ? word : CATEGORY_ALIASES[word];
  if (category) {
    const [location, ...words] = rest;
    const description = words.join(" ");
    if (!location || words.length < 2) return { command: "COMPLAINT", category, error: `Send ${word} <place> <problem>, e.g. ${word} B-214 no water since morning` };
    return { command: "COMPLAINT", category, location: location.toUpperCase(), description };
  }
  return { command: "UNKNOWN" };
}

export const HELP_TEXT = fit("CAMPUS SMS: ATT | GP | MENU | NOTICE | STATUS CMP-1234 | <TYPE> <place> <problem> e.g. WATER B-214 no water. TYPE: WATER POWER WIFI CLEAN MESS SAFETY HEALTH");

async function attendanceReply(student) {
  const s = await summariseStudent(student._id);
  if (!s.totalClasses) return "ATT: Insufficient data — no classes recorded yet.";
  const sim = simulate({ attendedClasses: s.attendedClasses, totalClasses: s.totalClasses });
  const lowest = [...s.subjects].sort((a, b) => a.percentage - b.percentage)[0];
  const need = sim.eligibleNow ? `Safe: can miss ${sim.classesCanMiss} more.` : `Need ${sim.classesToThreshold} classes in a row for ${sim.threshold}%.`;
  return `ATT ${s.overall}% (${s.attendedClasses}/${s.totalClasses}). ${need} Lowest: ${lowest.subject} ${lowest.percentage}%.`;
}

async function statusReply(student, reference) {
  const c = await Complaint.findOne({ reference, student: student._id }).lean();
  if (!c) return `${reference}: not found for your number.`;
  const filed = new Date(c.createdAt).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
  const sla = c.aiClassification?.slaHours ? ` SLA ${c.aiClassification.slaHours}h.` : "";
  return `${c.reference} ${c.category}: ${c.status}${c.department ? ` - ${c.department}` : ""}. Filed ${filed}.${sla}`;
}

async function gatePassReply(student) {
  const gp = await GatePass.findOne({ student: student._id, status: { $nin: GATE_PASS_CLOSED_STATUS } }).sort({ createdAt: -1 }).lean();
  if (!gp) return "GP: no open gate pass. Apply in the app or at the help desk.";
  const t = (d) => new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short", hour12: false });
  return `${gp.reference} ${gp.status}. Leave ${t(gp.leaveAt)}, return by ${t(gp.expectedReturnAt)}.`;
}

async function noticeReply(student) {
  const receipts = await NoticeReceipt.find({ student: student._id, readAt: null }).populate("notice").sort({ createdAt: -1 }).lean();
  const live = receipts.filter((r) => r.notice?.status === "PUBLISHED");
  if (!live.length) return "NOTICE: no unread notices.";
  const shown = live.slice(0, 2);
  const now = new Date();
  const ids = shown.map((r) => r._id);
  await NoticeReceipt.updateMany({ _id: { $in: ids }, deliveredAt: null }, { $set: { deliveredAt: now } });
  await NoticeReceipt.updateMany({ _id: { $in: ids } }, { $set: { readAt: now, channel: "SMS" } });
  const parts = shown.map((r) => `#${r.notice.reference.slice(-4)} ${r.notice.title}`);
  const more = live.length > 2 ? ` +${live.length - 2} more` : "";
  return `${parts.join(" | ")}${more}`;
}

/** Runs the existing controller with a stand-in request and response. */
export async function fileComplaintViaController(student, body) {
  const { value, errors } = createComplaintSchema(body);
  if (errors && Object.keys(errors).length) throw Object.assign(new Error(Object.values(errors)[0]), { status: 400 });
  const req = { user: student, body: value, query: {}, params: {} };
  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
  let failure = null;
  await createComplaint(req, res, (error) => {
    failure = error;
  });
  if (failure) throw failure;
  return res.payload?.data;
}

async function complaintReply(student, parsed, phone) {
  const title = parsed.description.length > 60 ? `${parsed.description.slice(0, 57)}…` : parsed.description;
  const data = await fileComplaintViaController(student, {
    title: title.charAt(0).toUpperCase() + title.slice(1),
    description: `${parsed.description} (reported by SMS from ${parsed.location})`,
    category: parsed.category,
    location: `${student.hostelName ? `${student.hostelName} · ` : ""}${parsed.location}`
  });
  const complaint = data.complaint;
  // The controller files it as APP; the channel and a line in the complaint's
  // own audit trail record that it came by SMS.
  await Complaint.updateOne(
    { _id: complaint.id },
    { $set: { channel: "SMS" }, $push: { audit: { at: new Date(), actor: student.name, message: `Filed by SMS keyword channel from ${maskPhone(phone)}`, kind: "ACTUAL DATA" } } }
  );
  await record({ entityType: "Complaint", entityId: complaint.id, entityRef: complaint.reference, action: "COMPLAINT_FILED_BY_SMS", field: "channel", newValue: "SMS", actor: student, note: `channel SMS · ${maskPhone(phone)}` });
  return {
    reply: `Filed ${complaint.reference} (${complaint.category}, ${complaint.priority}) to ${complaint.department || "the office"}. Reply STATUS ${complaint.reference}`,
    relatedRef: complaint.reference
  };
}

/**
 * Handles one inbound message. Never throws: every outcome, including errors,
 * becomes a logged SmsMessage and a reply.
 */
export async function handleInbound({ from, text, simulated = false, via = "WEBHOOK" }) {
  const phone = normalisePhone(from);
  const hash = phoneHash(from);
  const base = { phoneMasked: maskPhone(phone || from), phoneHash: hash, body: String(text || "").slice(0, 480), simulated, via };

  const maxAllowed = simulated ? 60 : RATE_LIMIT.max;
  const since = new Date(Date.now() - RATE_LIMIT.windowMinutes * 60000);
  const recent = await SmsMessage.countDocuments({ phoneHash: hash, createdAt: { $gte: since } });
  if (recent >= maxAllowed) {
    const row = await SmsMessage.create({ ...base, command: "RATE_LIMITED", outcome: "RATE_LIMITED", reply: fit(`Too many messages. Try again in ${RATE_LIMIT.windowMinutes} minutes.`) });
    return { reply: row.reply, outcome: row.outcome, message: row };
  }

  // EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md): staff DONE / NEED PART and student YES / NO
  // answers. Returns null for every other message, which then runs exactly as before.
  const workLoop = await handleXoSms({ phone, text, base });
  if (workLoop) return workLoop;

  const student = phone ? await studentByPhone(phone) : null;
  const parsed = parseCommand(text);
  if (!student) {
    const row = await SmsMessage.create({ ...base, command: parsed.command, outcome: "UNREGISTERED", reply: fit("This number is not registered for campus SMS. Visit the help desk in the Admin Block to register it.") });
    return { reply: row.reply, outcome: row.outcome, message: row };
  }

  let reply;
  let outcome = "OK";
  let relatedRef;
  try {
    if (parsed.error) reply = parsed.error;
    else if (parsed.command === "HELP" || parsed.command === "EMPTY") reply = HELP_TEXT;
    else if (parsed.command === "ATT") reply = await attendanceReply(student);
    else if (parsed.command === "STATUS") {
      reply = await statusReply(student, parsed.reference);
      relatedRef = parsed.reference;
    } else if (parsed.command === "GP") reply = await gatePassReply(student);
    else if (parsed.command === "MENU") reply = (await nextMeal()).answer;
    else if (parsed.command === "NOTICE") reply = await noticeReply(student);
    else if (parsed.command === "COMPLAINT") ({ reply, relatedRef } = await complaintReply(student, parsed, phone));
    else {
      reply = "Not understood. Send HELP for the list of commands.";
      outcome = "UNKNOWN_COMMAND";
    }
  } catch (error) {
    console.error("smsKeywordService:", error.message);
    reply = "Sorry, that could not be done right now. Try again or visit the help desk.";
    outcome = "ERROR";
  }

  const row = await SmsMessage.create({ ...base, student: student._id, command: parsed.command, outcome, reply: fit(reply), relatedRef });
  // EXCEPTION-ONLY HOOK: campus event log (fire-and-forget — never blocks or fails this request).
  emitEvent({ type: "SMS_REQUEST", actor: student, student, subjectType: "SmsMessage", subjectId: row._id, subjectRef: relatedRef, channel: "SMS", payload: { command: parsed.command, outcome, simulated } });
  if (parsed.command !== "COMPLAINT") {
    await record({ entityType: "SmsMessage", entityId: row._id, entityRef: relatedRef, action: `SMS_${parsed.command}`, actor: student, note: `channel SMS · ${simulated ? "simulated" : via} · ${outcome}` });
  }
  return { reply: row.reply, outcome, message: row, student };
}

/** Sends the reply back through the configured SMS provider (webhook path). */
export async function deliverReply(to, reply, messageId) {
  const delivery = await sendSms(to, reply);
  await SmsMessage.updateOne({ _id: messageId }, { $set: { replyDelivery: delivery.delivered ? "SENT" : delivery.mode } });
  return delivery;
}

export async function activity({ limit = 30 } = {}) {
  const [rows, byCommand, byOutcome, filed] = await Promise.all([
    SmsMessage.find().sort({ createdAt: -1 }).limit(limit).populate("student", "studentId").lean(),
    SmsMessage.aggregate([{ $group: { _id: "$command", n: { $sum: 1 } } }, { $sort: { n: -1 } }]),
    SmsMessage.aggregate([{ $group: { _id: "$outcome", n: { $sum: 1 } } }]),
    Complaint.find({ channel: "SMS" }).sort({ createdAt: -1 }).limit(10).select("reference title status category createdAt").lean()
  ]);
  const maskId = (id = "") => (id.length > 4 ? `${"•".repeat(id.length - 4)}${id.slice(-4)}` : id);
  return {
    messages: rows.map((m) => ({
      id: String(m._id),
      at: m.createdAt,
      phone: m.phoneMasked,
      student: m.student ? maskId(m.student.studentId) : null,
      body: m.body,
      command: m.command,
      outcome: m.outcome,
      reply: m.reply,
      relatedRef: m.relatedRef || null,
      simulated: m.simulated,
      via: m.via
    })),
    byCommand: byCommand.map((r) => ({ command: r._id, count: r.n })),
    byOutcome: Object.fromEntries(byOutcome.map((r) => [r._id, r.n])),
    complaintsFiled: filed.map((c) => ({ reference: c.reference, title: c.title, status: c.status, category: c.category, at: c.createdAt })),
    note: "Messages marked SIMULATED came from the on-screen phone simulator, not a mobile network.",
    method: "DATABASE_RECORDS",
    kind: "ACTUAL DATA"
  };
}
