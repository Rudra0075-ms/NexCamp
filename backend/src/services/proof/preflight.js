import { Attendance } from "../../models/Attendance.js";
import { GatePass } from "../../models/GatePass.js";
import { MessRecord } from "../../models/MessRecord.js";
import { ClassChange } from "../../models/ext/ClassChange.js";
import { ClassSchedule } from "../../models/ext/ClassSchedule.js";
import { ApiError } from "../../utils/ApiError.js";
import { istDateKey, istInstant, isValidDateKey, weekdayOf } from "../ext/istTime.js";
import { menuFor } from "../ext/messChangeService.js";
import { normaliseAudience, resolveAudience } from "../ext/noticeService.js";
import { applyChanges, prettyDate } from "../ext/timetableService.js";
import { SERVICE_WINDOWS } from "../messIntelligenceService.js";
import { SEMESTER_END, attendanceEffect, demandEstimate } from "../xo/changeService.js";
import { predictReach, receiptsFor } from "./noticeHistory.js";
import { ATTENDANCE_THRESHOLD } from "../../config/constants.js";
import { median, round } from "./stats.js";

/**
 * F3 — Pre-flight impact preview (page 15).
 *
 * Change Propagation (changeService) works out a change's consequences after
 * it is committed. This works out the same consequences — plus conflicts —
 * before anyone presses COMMIT, like a diff. It reuses the same arithmetic
 * (attendanceEffect, demandEstimate) and reads only. It never writes.
 */

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const toMin = (hhmm) => {
  const [h, m] = String(hhmm || "00:00").split(":").map(Number);
  return h * 60 + (m || 0);
};
const fromMin = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const overlaps = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;
const pctOf = (a, t) => (t ? (a / t) * 100 : 0);

/** Pure: which meal window (and its recorded peak) a slot falls into. */
export function mealCollision({ start, end }, peaks) {
  for (const [meal, [from, to]] of Object.entries(SERVICE_WINDOWS)) {
    if (!overlaps(start, end, toMin(from), toMin(to))) continue;
    const peak = peaks[meal];
    const hitsPeak = peak ? overlaps(start, end, toMin(peak.time), toMin(peak.time) + 30) : false;
    return { meal, window: `${from}–${to}`, peak: peak || null, hitsPeak };
  }
  return null;
}

/** Pure: a student's line when missing the moved session would drop them below the threshold. */
export function edgeOfThreshold(record, threshold = ATTENDANCE_THRESHOLD) {
  const now = pctOf(record.attendedClasses, record.totalClasses);
  const ifMissed = pctOf(record.attendedClasses, record.totalClasses + 1);
  return { now: round(now, 1), ifMissed: round(ifMissed, 1), crosses: now >= threshold && ifMissed < threshold };
}

async function peakSlots(weekday) {
  const rows = await MessRecord.find({}).select("date time meal crowd queueMinutes").sort({ date: -1 }).limit(900).lean();
  const out = {};
  for (const meal of Object.keys(SERVICE_WINDOWS)) {
    const same = rows.filter((r) => r.meal === meal && new Date(r.date).getDay() === weekday);
    const byTime = new Map();
    for (const r of same) {
      if (!byTime.has(r.time)) byTime.set(r.time, { crowd: [], queue: [] });
      byTime.get(r.time).crowd.push(r.crowd || 0);
      byTime.get(r.time).queue.push(r.queueMinutes || 0);
    }
    const slots = [...byTime.entries()].map(([time, v]) => ({ time, crowd: Math.round(median(v.crowd)), queueMinutes: round(median(v.queue), 1), days: v.crowd.length }));
    const top = slots.sort((a, b) => b.crowd - a.crowd)[0];
    if (top) out[meal] = top;
  }
  return out;
}

function line(kind, text, extra = {}) {
  return { kind, text, ...extra };
}

/** Preview of a class cancellation / reschedule / room change. */
export async function previewClassChange(input, { now = new Date() } = {}) {
  const schedule = await ClassSchedule.findById(input.scheduleId).lean();
  if (!schedule) throw ApiError.notFound("No scheduled class with that id");
  if (!isValidDateKey(input.sessionDate)) throw ApiError.badRequest("sessionDate must be YYYY-MM-DD");
  if (weekdayOf(input.sessionDate) !== schedule.weekday) throw ApiError.badRequest(`${schedule.subject} meets on ${DAY_NAMES[schedule.weekday]}s; ${input.sessionDate} is a ${DAY_NAMES[weekdayOf(input.sessionDate)]}`);
  if (input.type === "ROOM" && !input.newRoom) throw ApiError.badRequest("A room change needs newRoom");
  if (input.type === "RESCHEDULE" && (!isValidDateKey(input.newDate) || !input.newStartTime)) throw ApiError.badRequest("A reschedule needs newDate (YYYY-MM-DD) and newStartTime (HH:MM)");
  const existing = await ClassChange.findOne({ schedule: schedule._id, sessionDate: input.sessionDate }).lean();

  const recipients = await resolveAudience(normaliseAudience({ branches: [schedule.branch], years: [schedule.year], sections: [schedule.section], roles: ["STUDENT"] }));
  const byHostel = {};
  for (const r of recipients) byHostel[r.user.hostelName || "Day scholar"] = (byHostel[r.user.hostelName || "Day scholar"] || 0) + 1;
  const lines = [];
  const cohort = `${schedule.branch}-${schedule.year}${schedule.section}`;
  lines.push(line("ACTUAL DATA", `${recipients.length} students in ${cohort} are affected${Object.keys(byHostel).length ? ` (${Object.entries(byHostel).map(([h, n]) => `${h} ${n}`).join(", ")})` : ""}.`, { section: "AFFECTED", rows: recipients.map((r) => ({ name: r.user.name, studentId: r.user.studentId, hostel: r.user.hostelName || null })) }));
  if (existing) lines.push(line("ACTUAL DATA", `This session already has a change (${existing.reference}); COMMIT will be refused.`, { section: "CONFLICT", severity: "BLOCK" }));

  const records = await Attendance.find({ student: { $in: recipients.map((r) => r.user._id) }, subject: schedule.subject }).lean();
  const recOf = new Map(records.map((r) => [String(r.student), r]));
  const durationMin = schedule.endTime ? toMin(schedule.endTime) - toMin(schedule.startTime) : 60;

  // Attendance consequences.
  if (input.type === "CANCEL") {
    const prior = await ClassChange.find({ type: "CANCEL", branch: schedule.branch, year: schedule.year, section: schedule.section, subject: schedule.subject }).lean();
    const priorCancelled = new Set(prior.map((c) => c.sessionDate));
    const weekdays = (await ClassSchedule.find({ branch: schedule.branch, year: schedule.year, section: schedule.section, subject: schedule.subject }).lean()).map((s) => s.weekday);
    const rows = [];
    for (const r of recipients) {
      const record = recOf.get(String(r.user._id));
      if (!record) continue;
      const e = attendanceEffect(record, { priorCancelled, dateKey: input.sessionDate, weekdays, todayKey: istDateKey(now), endKey: SEMESTER_END });
      rows.push({ name: r.user.name, studentId: r.user.studentId, ...e, losesRecovery: e.bestCase.before >= ATTENDANCE_THRESHOLD && e.bestCase.after < ATTENDANCE_THRESHOLD });
    }
    const lost = rows.filter((x) => x.losesRecovery);
    lines.push(line(lost.length ? "SIMULATED" : "ACTUAL DATA", lost.length ? `${lost.length} student${lost.length === 1 ? "" : "s"} would lose their last route to ${ATTENDANCE_THRESHOLD}% in ${schedule.subject}: even attending every remaining class, they end below ${ATTENDANCE_THRESHOLD}% (this was their recovery class).` : `No student's eligibility changes: everyone who could reach ${ATTENDANCE_THRESHOLD}% still can.`, { section: "ATTENDANCE", severity: lost.length ? "WARN" : "OK", rows: rows.map((x) => ({ name: x.name, studentId: x.studentId, bestCaseBefore: x.bestCase.before, bestCaseAfter: x.bestCase.after, remainingBefore: x.remaining.before, remainingAfter: x.remaining.after, flagged: x.losesRecovery })), formula: `best case = (attended + remaining) ÷ (held + remaining); remaining counts ${DAY_NAMES.filter((_, i) => weekdays.includes(i)).join("/")} sessions to ${SEMESTER_END} (ASSUMPTION: semester end)` }));
  }

  let newSlot = null;
  if (input.type === "RESCHEDULE") {
    const start = toMin(input.newStartTime);
    newSlot = { dateKey: input.newDate, start, end: start + durationMin, label: `${prettyDate(input.newDate)} ${input.newStartTime}–${fromMin(start + durationMin)}` };
    const edge = [];
    for (const r of recipients) {
      const record = recOf.get(String(r.user._id));
      if (!record) continue;
      const e = edgeOfThreshold(record);
      if (e.crosses) edge.push({ name: r.user.name, studentId: r.user.studentId, ...e });
    }
    lines.push(line("SIMULATED", edge.length ? `${edge.length} student${edge.length === 1 ? "" : "s"} would cross below ${ATTENDANCE_THRESHOLD}% in ${schedule.subject} if they miss the moved session.` : `No student is within one class of dropping below ${ATTENDANCE_THRESHOLD}% in ${schedule.subject}.`, { section: "ATTENDANCE", severity: edge.length ? "WARN" : "OK", rows: edge, formula: `if missed: attended ÷ (held + 1) — e.g. ${edge[0] ? `${edge[0].now}% → ${edge[0].ifMissed}%` : "—"}` }));

    // The same cohort's other classes that day.
    const [cohortSchedules, dayChanges] = await Promise.all([
      ClassSchedule.find({ branch: schedule.branch, year: schedule.year, section: schedule.section }).lean(),
      ClassChange.find({ branch: schedule.branch, year: schedule.year, section: schedule.section, $or: [{ sessionDate: input.newDate }, { newDate: input.newDate }] }).lean()
    ]);
    const clash = applyChanges(input.newDate, cohortSchedules, dayChanges).filter((s) => s.status !== "CANCELLED" && s.status !== "MOVED_AWAY" && String(s.id || s._id) !== String(schedule._id) && overlaps(newSlot.start, newSlot.end, toMin(s.startTime), s.endTime ? toMin(s.endTime) : toMin(s.startTime) + 60));
    lines.push(line("ACTUAL DATA", clash.length ? `Clashes with ${clash.map((s) => `${s.subject} ${s.startTime}${s.endTime ? `–${s.endTime}` : ""}`).join(", ")} for the whole of ${cohort}.` : `No other ${cohort} class at ${newSlot.label}.`, { section: "CONFLICT", severity: clash.length ? "BLOCK" : "OK" }));

    // Room: any cohort using the target room at that time.
    const room = input.newRoom || schedule.room;
    if (room) {
      const inRoom = await ClassSchedule.find({ room, weekday: weekdayOf(input.newDate), _id: { $ne: schedule._id } }).lean();
      const busy = inRoom.filter((s) => overlaps(newSlot.start, newSlot.end, toMin(s.startTime), s.endTime ? toMin(s.endTime) : toMin(s.startTime) + 60));
      lines.push(line("ACTUAL DATA", busy.length ? `Room ${room} is taken by ${busy.map((s) => `${s.branch}-${s.year}${s.section} ${s.subject}`).join(", ")} at that time.` : `Room ${room} is free at that time (timetable).`, { section: "CONFLICT", severity: busy.length ? "BLOCK" : "OK" }));
    }

    // Mess: the new slot inside a meal window.
    const peaks = await peakSlots(weekdayOf(input.newDate));
    const meal = mealCollision(newSlot, peaks);
    if (meal) {
      const movers = recipients.filter((r) => r.user.hostelName).length;
      lines.push(line("SIMULATED", `Falls inside ${meal.meal.toLowerCase()} service (${meal.window})${meal.hitsPeak ? ` and its peak at ${meal.peak.time} (median ${meal.peak.crowd} covers, ${meal.peak.queueMinutes} min queue on this weekday)` : ""}. About ${movers} hostel residents will eat before or after the class, shifting up to ${movers} covers out of that slot.`, { section: "MESS", severity: meal.hitsPeak ? "WARN" : "INFO", meal: meal.meal, peak: meal.peak, basis: "Mess register, same weekday, last 4+ weeks; every resident assumed to eat (upper bound)" }));
    } else lines.push(line("ACTUAL DATA", "Outside every meal service window.", { section: "MESS", severity: "OK" }));
  }

  // Gate passes: approved or active passes covering the session (moved or original).
  const slotStart = newSlot ? istInstant(newSlot.dateKey, fromMin(newSlot.start)) : istInstant(input.sessionDate, schedule.startTime);
  const slotEnd = new Date(slotStart.getTime() + durationMin * 60000);
  if (input.type !== "CANCEL") {
    const away = await GatePass.find({ student: { $in: recipients.map((r) => r.user._id) }, status: { $in: ["APPROVED", "ACTIVE", "PARENT_VERIFIED", "PENDING_WARDEN_APPROVAL"] }, leaveAt: { $lt: slotEnd }, expectedReturnAt: { $gt: slotStart } }).populate("student", "name studentId").select("reference student status leaveAt expectedReturnAt").lean();
    lines.push(line("ACTUAL DATA", away.length ? `${away.length} student${away.length === 1 ? "" : "s"} will be off campus on a gate pass during the session.` : "No student in this section has a gate pass covering the session.", { section: "CONFLICT", severity: away.length ? "WARN" : "OK", rows: away.map((g) => ({ name: g.student?.name, studentId: g.student?.studentId, reference: g.reference, status: g.status, leaveAt: g.leaveAt, expectedReturnAt: g.expectedReturnAt })) }));
  }

  // The notice that would go out, and its predicted reach.
  const title = input.type === "CANCEL" ? `${schedule.subject} cancelled — ${prettyDate(input.sessionDate)} ${schedule.startTime}` : input.type === "ROOM" ? `${schedule.subject} moved to room ${input.newRoom} — ${prettyDate(input.sessionDate)} ${schedule.startTime}` : `${schedule.subject} rescheduled to ${prettyDate(input.newDate)} ${input.newStartTime}`;
  const rows = await receiptsFor(recipients.map((r) => r.user._id), { now });
  const reach = predictReach(rows, { recipients: recipients.length, channel: "APP", at: now });
  lines.push(line(reach.kind, `Drafted notice to exactly ${cohort} (${recipients.length}): “${title}”. ${reach.text}`, { section: "NOTICE", notice: { title, body: `${schedule.branch} year ${schedule.year} section ${schedule.section}: ${title}.${input.reason ? ` Reason: ${input.reason}.` : ""}`, audience: { branches: [schedule.branch], years: [schedule.year], sections: [schedule.section], roles: ["STUDENT"] } }, reach }));

  return {
    change: { kind: "CLASS", type: input.type, subject: schedule.subject, cohort, sessionDate: input.sessionDate, originalSlot: `${prettyDate(input.sessionDate)} ${schedule.startTime}`, newSlot: newSlot?.label || null, room: input.newRoom || schedule.room || null },
    lines,
    blocking: lines.filter((l) => l.severity === "BLOCK").length,
    warnings: lines.filter((l) => l.severity === "WARN").length,
    writes: 0,
    method: "PRE_FLIGHT_DRY_RUN (same arithmetic as Change Propagation)",
    kind: "SIMULATED"
  };
}

/** Preview of a menu change. */
export async function previewMenuChange(input, { now = new Date() } = {}) {
  if (!isValidDateKey(input.date)) throw ApiError.badRequest("date must be YYYY-MM-DD");
  const current = await menuFor(input.date, input.meal);
  const recipients = await resolveAudience(normaliseAudience({ hostels: input.hostels || [], roles: ["STUDENT"] }));
  const records = await MessRecord.find({ meal: input.meal }).sort({ date: -1 }).limit(120).lean();
  const taken = (items) => records.flatMap((r) => (r.menu || []).filter((x) => items.some((i) => i.toLowerCase() === String(x.item).toLowerCase())).map((x) => x.takenPercentage)).filter((v) => Number.isFinite(v));
  const demands = records.slice(0, 28).map((r) => r.demand).filter((d) => d > 0);
  const est = demandEstimate({ baselineDemand: demands.length ? Math.round(median(demands)) : null, oldTaken: taken(current.items || []), newTaken: taken(input.items || []) });
  const title = `${input.meal} menu changed — ${prettyDate(input.date)}`;
  const rows = await receiptsFor(recipients.map((r) => r.user._id), { now });
  const reach = predictReach(rows, { recipients: recipients.length, channel: "APP", at: now });
  const lines = [
    line("ACTUAL DATA", `${recipients.length} students will be told${input.hostels?.length ? ` (${input.hostels.join(", ")})` : " (every hostel)"}.`, { section: "AFFECTED" }),
    line("ACTUAL DATA", `Replaces: ${(current.items || []).join(", ") || "no recorded menu"} → ${(input.items || []).join(", ")}.`, { section: "MESS" }),
    line(est.kind === "ESTIMATE" ? "SIMULATED" : "INSUFFICIENT DATA", est.text + (est.basis ? ` Basis: ${est.basis}.` : ""), { section: "MESS", severity: est.deltaPct && Math.abs(est.deltaPct) >= 10 ? "WARN" : "INFO" }),
    line(reach.kind, `Drafted notice: “${title}”. ${reach.text}`, { section: "NOTICE", notice: { title }, reach })
  ];
  return { change: { kind: "MENU", date: input.date, meal: input.meal, items: input.items }, lines, blocking: 0, warnings: lines.filter((l) => l.severity === "WARN").length, writes: 0, method: "PRE_FLIGHT_DRY_RUN (same arithmetic as Change Propagation)", kind: "SIMULATED" };
}

export async function previewChange(input, options) {
  return input.kind === "MENU" ? previewMenuChange(input, options) : previewClassChange(input, options);
}
