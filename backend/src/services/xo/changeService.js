import { Attendance } from "../../models/Attendance.js";
import { Building } from "../../models/Building.js";
import { MessRecord } from "../../models/MessRecord.js";
import { ClassChange } from "../../models/ext/ClassChange.js";
import { ClassSchedule } from "../../models/ext/ClassSchedule.js";
import { nextReference } from "../../models/ext/common.js";
import { ChangeEvent } from "../../models/xo/ChangeEvent.js";
import { ApiError } from "../../utils/ApiError.js";
import { round } from "../../utils/text.js";
import { audit } from "../ext/extAudit.js";
import { istDateKey, weekdayOf } from "../ext/istTime.js";
import { createNotice, resolveAudience, normaliseAudience } from "../ext/noticeService.js";
import { profileFor } from "../ext/profileService.js";
import { adjustRecord } from "../ext/timetableService.js";
import { emitEvent } from "./eventService.js";
import { median } from "./responseStats.js";

/**
 * Change propagation (Phase 6): one change → every consequence.
 *
 *   class cancelled / moved   → the notice already goes to exactly that section
 *                               (timetableService); here each affected student's
 *                               attendance projection is recomputed
 *   menu changed              → the mess demand estimate for that meal
 *   planned water / power cut → a notice to the building's residents, and
 *                               complaints in that building and window are linked
 *                               to the planned event instead of opening an incident
 *
 * The official attendance record is never written to. Every figure says what it is.
 */

// ASSUMPTION: the last teaching day of the current semester. Replace with the
// academic calendar; it only affects the "best case at semester end" figure.
export const SEMESTER_END = process.env.SEMESTER_END || "2026-11-28";
const DAY = 864e5;
const pct = (a, t) => (t ? round((a / t) * 100, 1) : null);

/** Pure: sessions of a weekday between two IST date keys (inclusive), minus cancelled dates. */
export function sessionsLeft(weekdays, fromKey, toKey, cancelled = new Set()) {
  let n = 0;
  for (let t = Date.parse(`${fromKey}T00:00:00Z`); t <= Date.parse(`${toKey}T00:00:00Z`); t += DAY) {
    const key = new Date(t).toISOString().slice(0, 10);
    if (weekdays.includes(weekdayOf(key)) && !cancelled.has(key)) n += 1;
  }
  return n;
}

/** Pure: one student's attendance effect of cancelling `dateKey` in one subject. */
export function attendanceEffect(record, { priorCancelled, dateKey, weekdays, todayKey, endKey }) {
  const before = adjustRecord(record, priorCancelled);
  const withThis = new Set([...priorCancelled, dateKey]);
  const after = adjustRecord(record, withThis);
  const tomorrow = new Date(Date.parse(`${todayKey}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
  const remBefore = sessionsLeft(weekdays, tomorrow, endKey, priorCancelled);
  const remAfter = sessionsLeft(weekdays, tomorrow, endKey, withThis);
  const a = before.adjusted.attended;
  const t = before.adjusted.total;
  return {
    subject: record.subject,
    adjusted: { before: before.adjusted.percentage, after: after.adjusted.percentage, changed: before.adjusted.percentage !== after.adjusted.percentage },
    remaining: { before: remBefore, after: remAfter },
    bestCase: { before: pct(a + remBefore, t + remBefore), after: pct(after.adjusted.attended + remAfter, after.adjusted.total + remAfter) },
    inRegister: after.cancelledInRegister.some((s) => s.date === dateKey)
  };
}

/** Pure: the sentence a student sees. */
export function effectSentence(e) {
  if (e.adjusted.changed) return `${e.subject}: your attendance (cancelled sessions not counted) moves ${e.adjusted.before}% → ${e.adjusted.after}%.`;
  return `${e.subject}: nothing changes today — ${e.remaining.before} → ${e.remaining.after} classes left this semester; if you attend all of them you finish at ${e.bestCase.after}% (was ${e.bestCase.before}%).`;
}

async function nextChangeRef() {
  return nextReference("CHG");
}

/** Called after timetableService.createChange. Never throws into the caller. */
export async function propagateClassChange(changeId, actor, { now = new Date() } = {}) {
  const change = await ClassChange.findById(changeId).lean();
  if (!change) return null;
  const schedule = await ClassSchedule.findById(change.schedule).lean();
  const type = { CANCEL: "CLASS_CANCEL", RESCHEDULE: "CLASS_RESCHEDULE", ROOM: "CLASS_ROOM" }[change.type];
  const recipients = await resolveAudience(normaliseAudience({ branches: [change.branch], years: [change.year], sections: [change.section], roles: ["STUDENT"] }));
  const rows = [];
  if (change.type !== "ROOM") {
    const prior = await ClassChange.find({ _id: { $ne: change._id }, type: { $in: ["CANCEL", "RESCHEDULE"] }, branch: change.branch, year: change.year, section: change.section, subject: change.subject }).lean();
    const priorCancelled = new Set(prior.filter((c) => c.type === "CANCEL").map((c) => c.sessionDate));
    const weekdays = (await ClassSchedule.find({ branch: change.branch, year: change.year, section: change.section, subject: change.subject }).lean()).map((s) => s.weekday);
    for (const { user } of recipients) {
      const record = await Attendance.findOne({ student: user._id, subject: change.subject }).lean();
      if (!record) continue;
      const effect = attendanceEffect(record, { priorCancelled, dateKey: change.sessionDate, weekdays: weekdays.length ? weekdays : [schedule?.weekday], todayKey: istDateKey(now), endKey: SEMESTER_END });
      rows.push({ student: String(user._id), name: user.name, ...effect, text: effectSentence(effect) });
    }
  }
  const event = await ChangeEvent.create({
    reference: await nextChangeRef(),
    type,
    title: `${change.subject} ${change.type === "CANCEL" ? "cancelled" : change.type === "ROOM" ? `moved to room ${change.newRoom}` : `rescheduled to ${change.newDate} ${change.newStartTime}`} — ${change.sessionDate}`,
    source: { kind: "ClassChange", id: String(change._id), reference: change.reference },
    cohort: { branches: [change.branch], years: [change.year], sections: [change.section], hostels: [] },
    notice: change.noticeReference ? { id: String(change.notice), reference: change.noticeReference } : undefined,
    effects: {
      recipients: recipients.length,
      attendance: { students: rows.length, rows: rows.slice(0, 80), semesterEnd: SEMESTER_END, semesterEndKind: "ASSUMPTION", note: "The official register and its percentage are not changed. The adjusted view does not count sessions the timetable cancelled." }
    },
    byName: actor?.name,
    byRole: actor?.role
  });
  await audit(event, { entityType: "ChangeEvent", action: "CHANGE_PROPAGATED", actor, note: `${change.reference} → notice ${change.noticeReference} (${recipients.length}) · ${rows.length} attendance projections` });
  await event.save();
  return event;
}

/** Pure: the demand estimate for a menu change from how often items were taken before. */
export function demandEstimate({ baselineDemand, oldTaken, newTaken }) {
  if (baselineDemand === null || oldTaken.length < 3 || newTaken.length < 3) return { kind: "INSUFFICIENT DATA", text: "Insufficient data — the new or the old items have been served fewer than 3 times, so no demand change is estimated." };
  const oldRate = median(oldTaken);
  const newRate = median(newTaken);
  const factor = oldRate ? newRate / oldRate : 1;
  const estimate = Math.round(baselineDemand * factor);
  return { kind: "ESTIMATE", baselineDemand, estimate, deltaPct: round((factor - 1) * 100, 1), basis: `median uptake of the new items ${round(newRate)}% vs ${round(oldRate)}% for the items they replace (mess register), applied to the median demand for this meal`, text: `Expected headcount ${baselineDemand} → ${estimate} (${factor >= 1 ? "+" : ""}${round((factor - 1) * 100, 1)}%).` };
}

export async function propagateMenuChange(menuChangeId, actor) {
  const { MenuChange } = await import("../../models/ext/MenuChange.js");
  const m = await MenuChange.findById(menuChangeId).lean();
  if (!m) return null;
  const records = await MessRecord.find({ meal: m.meal }).sort({ date: -1 }).limit(120).lean();
  const taken = (items) => records.flatMap((r) => (r.menu || []).filter((x) => items.some((i) => i.toLowerCase() === String(x.item).toLowerCase())).map((x) => x.takenPercentage)).filter((v) => Number.isFinite(v));
  const demands = records.slice(0, 28).map((r) => r.demand).filter((d) => d > 0);
  const est = demandEstimate({ baselineDemand: demands.length ? Math.round(median(demands)) : null, oldTaken: taken(m.replaces || []), newTaken: taken(m.items || []) });
  const event = await ChangeEvent.create({
    reference: await nextChangeRef(),
    type: "MENU_CHANGE",
    title: `${m.meal} on ${m.date}: ${(m.items || []).join(", ")}`,
    source: { kind: "MenuChange", id: String(m._id), reference: m.reference },
    cohort: { hostels: [] },
    notice: m.noticeReference ? { id: String(m.notice), reference: m.noticeReference } : undefined,
    effects: { mess: { date: m.date, meal: m.meal, items: m.items, replaces: m.replaces, ...est } },
    byName: actor?.name,
    byRole: actor?.role
  });
  await audit(event, { entityType: "ChangeEvent", action: "CHANGE_PROPAGATED", actor, note: `${m.reference} → notice ${m.noticeReference} · mess demand ${est.kind}` });
  await event.save();
  return event;
}

// ---- planned shutdowns ------------------------------------------------------------------------

export async function planShutdown(actor, { buildingCode, utility, from, to, reason }, { now = new Date() } = {}) {
  const building = await Building.findOne({ code: String(buildingCode || "").toUpperCase() }).lean();
  if (!building) throw ApiError.notFound("No building with that code");
  if (!["WATER", "ELECTRICITY", "WI-FI"].includes(utility)) throw ApiError.badRequest("utility must be WATER, ELECTRICITY or WI-FI");
  const start = new Date(from);
  const end = new Date(to);
  if (!(end > start)) throw ApiError.badRequest("The shutdown must end after it starts");
  const fmt = (d) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  const label = { WATER: "Water supply", ELECTRICITY: "Electricity", "WI-FI": "Wi-Fi" }[utility];
  const hostel = building.type === "HOSTEL" ? building.name : null;
  const notice = await createNotice(
    {
      title: `${label} off in ${building.name}: ${fmt(start)}–${fmt(end)}`,
      body: `Planned: ${label.toLowerCase()} in ${building.name} is off from ${fmt(start)} to ${fmt(end)}.${reason ? ` Reason: ${reason}.` : ""} Complaints about it in that window are recorded against this planned work rather than as a new fault.`,
      priority: (start - now) / 3600000 <= 24 ? "HIGH" : "NORMAL",
      // Work starting within 12 hours cannot wait for the morning digest.
      overrideQuietHours: (start - now) / 3600000 <= 12,
      audience: hostel ? { hostels: [hostel], roles: ["STUDENT"] } : { roles: ["STUDENT"] }
    },
    actor,
    { now, kind: "GENERAL" }
  );
  const event = new ChangeEvent({
    reference: await nextChangeRef(),
    type: "PLANNED_SHUTDOWN",
    title: `${label} off in ${building.name}`,
    buildingCode: building.code,
    utility,
    window: { from: start, to: end },
    cohort: { hostels: hostel ? [hostel] : [] },
    notice: { id: String(notice._id), reference: notice.reference, reach: notice.reach, status: notice.status },
    effects: { reason: reason || null },
    byName: actor.name,
    byRole: actor.role
  });
  await audit(event, { entityType: "ChangeEvent", action: "SHUTDOWN_PLANNED", actor, note: `${building.code} ${utility} ${start.toISOString()}–${end.toISOString()} · notice ${notice.reference} → ${notice.reach}` });
  await event.save();
  emitEvent({ type: "SHUTDOWN_PLANNED", actor, subjectType: "ChangeEvent", subjectId: event._id, subjectRef: event.reference, channel: "APP", payload: { building: building.code, utility, from: start, to: end } });
  return event;
}

const GRACE = 30 * 60000;

/** The planned shutdown a complaint falls under (same building, utility and window ± 30 min), if any. */
export async function plannedShutdownFor({ building, category, at = new Date() }) {
  if (!building || !["WATER", "ELECTRICITY", "WI-FI"].includes(category)) return null;
  const code = building.code || (await Building.findById(building).select("code").lean())?.code;
  if (!code) return null;
  return ChangeEvent.findOne({ type: "PLANNED_SHUTDOWN", buildingCode: code, utility: category, "window.from": { $lte: new Date(at.getTime() + GRACE) }, "window.to": { $gte: new Date(at.getTime() - GRACE) } }).lean();
}

export async function linkComplaint(event, complaint, actor) {
  await ChangeEvent.updateOne({ _id: event._id }, { $push: { linkedComplaints: { id: String(complaint._id), reference: complaint.reference, at: new Date() } } });
  await audit({ _id: event._id, reference: event.reference }, { entityType: "ChangeEvent", action: "COMPLAINT_LINKED_TO_PLANNED_WORK", actor, note: `${complaint.reference} linked instead of opening an incident` });
  emitEvent({ type: "COMPLAINT_LINKED_TO_CHANGE", actor, student: complaint.student, subjectType: "Complaint", subjectId: complaint._id, subjectRef: complaint.reference, department: complaint.department, channel: "SYSTEM", humanTouch: false, payload: { change: event.reference } });
}

// ---- reads -------------------------------------------------------------------------------------

export const shapeChange = (e) => ({
  id: String(e._id),
  reference: e.reference,
  type: e.type,
  title: e.title,
  source: e.source || null,
  cohort: e.cohort,
  buildingCode: e.buildingCode || null,
  utility: e.utility || null,
  window: e.window || null,
  notice: e.notice || null,
  effects: e.effects || null,
  linkedComplaints: e.linkedComplaints || [],
  byName: e.byName,
  createdAt: e.createdAt
});

export async function listChanges({ limit = 30 } = {}) {
  const rows = await ChangeEvent.find().sort({ createdAt: -1 }).limit(limit).lean();
  return { changes: rows.map(shapeChange), method: "CHANGE_PROPAGATION", kind: "ACTUAL DATA" };
}

/** Page 02 "What changed for you" and pages 03/04: the changes that reach this student. */
export async function changesFor(student, { days = 14, now = new Date() } = {}) {
  const profile = await profileFor(student);
  const since = new Date(now - days * DAY);
  const rows = await ChangeEvent.find({ createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(40).lean();
  const mine = [];
  for (const e of rows) {
    const c = e.cohort || {};
    const hostelHit = (c.hostels || []).length ? c.hostels.includes(String(student.hostelName || "").toUpperCase()) : false;
    const sectionHit = (c.sections || []).length ? c.branches?.includes(profile.branch) && c.years?.includes(profile.year) && c.sections.includes(profile.section) : false;
    const everyone = e.type === "MENU_CHANGE" && !(c.hostels || []).length;
    if (!hostelHit && !sectionHit && !everyone) continue;
    const row = (e.effects?.attendance?.rows || []).find((r) => r.student === String(student._id));
    mine.push({
      reference: e.reference,
      type: e.type,
      title: e.title,
      at: e.createdAt,
      notice: e.notice || null,
      window: e.window || null,
      forYou: row ? row.text : e.type === "MENU_CHANGE" ? `${e.effects?.mess?.meal} on ${e.effects?.mess?.date}: ${(e.effects?.mess?.items || []).join(", ")}${(e.effects?.mess?.replaces || []).length ? ` (was ${e.effects.mess.replaces.join(", ")})` : ""}. Mess demand: ${e.effects?.mess?.kind === "ESTIMATE" ? `${e.effects.mess.text} (ESTIMATE — ${e.effects.mess.basis})` : "Insufficient data to estimate a change in headcount"}.` : e.type === "PLANNED_SHUTDOWN" ? `${e.title}. If you report it in that window, it is linked to the planned work.` : e.title,
      attendance: row || null,
      kind: row?.adjusted?.changed ? "ACTUAL DATA" : row ? "ESTIMATE" : "ACTUAL DATA"
    });
  }
  return { changes: mine, group: { branch: profile.branch, year: profile.year, section: profile.section, hostel: student.hostelName || null }, method: "CHANGE_PROPAGATION", kind: "ACTUAL DATA" };
}
