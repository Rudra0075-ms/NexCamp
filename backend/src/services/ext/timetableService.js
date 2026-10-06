import { Attendance } from "../../models/Attendance.js";
import { ClassChange } from "../../models/ext/ClassChange.js";
import { ClassSchedule } from "../../models/ext/ClassSchedule.js";
import { nextReference } from "../../models/ext/common.js";
import { ApiError } from "../../utils/ApiError.js";
import { round } from "../../utils/text.js";
import { ATTENDANCE_THRESHOLD } from "../../config/constants.js";
import { audit } from "./extAudit.js";
import { istDateKey, istInstant, isValidDateKey, weekdayOf } from "./istTime.js";
import { createNotice } from "./noticeService.js";
import { profileFor } from "./profileService.js";
import { emitEvent } from "../xo/eventService.js"; // EXCEPTION-ONLY HOOK

/**
 * Timetable and class changes.
 *
 * A change is stored in its own ClassChange collection and announced through
 * the Notice Center to exactly the affected branch / year / section. The
 * existing attendance records and their calculation are never written to or
 * altered; `adjustedAttendance` is an additional, read-only view.
 */

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const prettyDate = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return `${DAY_NAMES[weekdayOf(key)].slice(0, 3)} ${d} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
};

const shapeSchedule = (row) => ({
  id: String(row._id),
  branch: row.branch,
  year: row.year,
  section: row.section,
  subject: row.subject,
  subjectCode: row.subjectCode,
  weekday: row.weekday,
  weekdayName: DAY_NAMES[row.weekday],
  startTime: row.startTime,
  endTime: row.endTime,
  room: row.room,
  faculty: row.faculty
});

export const shapeChange = (row) => ({
  id: String(row._id),
  reference: row.reference,
  schedule: row.schedule ? String(row.schedule._id || row.schedule) : null,
  sessionDate: row.sessionDate,
  sessionDateLabel: row.sessionDate ? prettyDate(row.sessionDate) : null,
  type: row.type,
  newDate: row.newDate || null,
  newStartTime: row.newStartTime || null,
  newRoom: row.newRoom || null,
  reason: row.reason || null,
  branch: row.branch,
  year: row.year,
  section: row.section,
  subject: row.subject,
  byName: row.byName,
  noticeReference: row.noticeReference || null,
  createdAt: row.createdAt
});

export async function scheduleFor(profile) {
  if (!profile?.branch || !profile?.year || !profile?.section) return [];
  return ClassSchedule.find({ branch: profile.branch, year: profile.year, section: profile.section }).sort({ weekday: 1, startTime: 1 }).lean();
}

/** Pure: the day's sessions with any change applied. */
export function applyChanges(dateKey, schedules, changes) {
  const weekday = weekdayOf(dateKey);
  const rows = schedules
    .filter((s) => s.weekday === weekday)
    .map((s) => {
      const change = changes.find((c) => String(c.schedule) === String(s._id) && c.sessionDate === dateKey);
      let status = "AS_SCHEDULED";
      if (change?.type === "CANCEL") status = "CANCELLED";
      else if (change?.type === "ROOM") status = "ROOM_CHANGED";
      else if (change?.type === "RESCHEDULE") status = "MOVED_AWAY";
      return {
        ...shapeSchedule(s),
        date: dateKey,
        status,
        room: change?.type === "ROOM" ? change.newRoom : s.room,
        originalRoom: s.room,
        change: change ? shapeChange(change) : null
      };
    });
  // Sessions rescheduled INTO this day.
  for (const change of changes.filter((c) => c.type === "RESCHEDULE" && c.newDate === dateKey)) {
    const s = schedules.find((row) => String(row._id) === String(change.schedule));
    if (!s) continue;
    rows.push({
      ...shapeSchedule(s),
      date: dateKey,
      status: "RESCHEDULED_HERE",
      startTime: change.newStartTime || s.startTime,
      room: change.newRoom || s.room,
      originalRoom: s.room,
      change: shapeChange(change)
    });
  }
  return rows.sort((a, b) => a.startTime.localeCompare(b.startTime));
}

export async function dayFor(profile, dateKey) {
  const schedules = await scheduleFor(profile);
  const changes = await ClassChange.find({
    branch: profile.branch,
    year: profile.year,
    section: profile.section,
    $or: [{ sessionDate: dateKey }, { newDate: dateKey }]
  }).lean();
  return applyChanges(dateKey, schedules, changes);
}

/** Pure: the sentence answer for one day's sessions. */
export function answerFor(dateKey, sessions, { label = "tomorrow", subject } = {}) {
  const scoped = subject ? sessions.filter((s) => s.subject.toLowerCase().includes(subject.toLowerCase())) : sessions;
  const when = `${label} (${prettyDate(dateKey)})`;
  if (!sessions.length) return { answer: `No classes are scheduled ${when}.`, cancelled: [], changed: [] };
  if (subject && !scoped.length) return { answer: `${subject.toUpperCase()} is not on your timetable ${when}.`, cancelled: [], changed: [] };
  const cancelled = scoped.filter((s) => s.status === "CANCELLED" || s.status === "MOVED_AWAY");
  const changed = scoped.filter((s) => s.status === "ROOM_CHANGED" || s.status === "RESCHEDULED_HERE");
  const parts = [];
  if (cancelled.length) {
    parts.push(
      `Yes — ${cancelled
        .map((s) => `${s.subject} ${s.startTime} is ${s.status === "CANCELLED" ? "cancelled" : `moved to ${s.change.newDate} ${s.change.newStartTime || s.startTime}`}`)
        .join("; ")} ${when}.`
    );
  } else {
    parts.push(`No — ${subject ? `${scoped[0].subject} runs` : `none of your ${scoped.length} class${scoped.length === 1 ? "" : "es"} is cancelled`} ${when}.`);
  }
  if (changed.length) parts.push(`Changed: ${changed.map((s) => (s.status === "ROOM_CHANGED" ? `${s.subject} ${s.startTime} moves to room ${s.room}` : `${s.subject} added at ${s.startTime} in ${s.room}`)).join("; ")}.`);
  return { answer: parts.join(" "), cancelled, changed };
}

/** "Is tomorrow's class cancelled?" — answered from the schedule, with evidence. */
export async function answerDay(student, { day = "tomorrow", subject, now = new Date() } = {}) {
  const profile = await profileFor(student);
  const offset = day === "today" ? 0 : day === "tomorrow" ? 1 : null;
  let dateKey;
  let sessions;
  if (offset !== null) dateKey = istDateKey(now, offset);
  else if (day === "next") {
    // The next date, from tomorrow, on which this section has any class.
    for (let i = 1; i <= 7 && !dateKey; i += 1) {
      const key = istDateKey(now, i);
      const rows = await dayFor(profile, key);
      if (rows.length) {
        dateKey = key;
        sessions = rows;
      }
    }
    if (!dateKey) dateKey = istDateKey(now, 1);
  } else if (isValidDateKey(day)) dateKey = day;
  else throw ApiError.badRequest("day must be today, tomorrow, next or YYYY-MM-DD");
  sessions = sessions || (await dayFor(profile, dateKey));
  const label = offset === 0 ? "today" : offset === 1 ? "tomorrow" : day === "next" ? "on the next class day" : "on";
  const result = answerFor(dateKey, sessions, { label, subject });
  const hasSection = Boolean(profile.section);
  return {
    question: `Is ${day === "today" ? "today's" : day === "tomorrow" ? "tomorrow's" : day === "next" ? "the next class day's" : `${dateKey}'s`} class cancelled?`,
    date: dateKey,
    dateLabel: prettyDate(dateKey),
    group: { branch: profile.branch, year: profile.year, section: profile.section, source: profile.source },
    answer: hasSection ? result.answer : "Insufficient data — no section is recorded for you, so your timetable cannot be read.",
    sessions,
    evidence: [...result.cancelled, ...result.changed].map((s) => ({
      kind: "EVIDENCE",
      label: `${s.change.reference} · ${s.change.type}`,
      value: `${s.subject} ${s.date} ${s.startTime} — by ${s.change.byName || "staff"}${s.change.reason ? ` · ${s.change.reason}` : ""}${s.change.noticeReference ? ` · notice ${s.change.noticeReference}` : ""}`
    })),
    method: "TIMETABLE_LOOKUP",
    source: "DETERMINISTIC",
    kind: "ACTUAL DATA"
  };
}

/** Deterministic parser for the /ask endpoint: day word + optional subject. */
export function parseQuestion(question = "", subjects = []) {
  const q = String(question).toLowerCase();
  let day = "tomorrow";
  if (/\btoday\b|\btonight\b/.test(q)) day = "today";
  else if (/\btomorrow\b|\btmrw\b|\bkal\b/.test(q)) day = "tomorrow";
  const subject = subjects.find((s) => q.includes(s.toLowerCase()) || (s.split(" ")[0].length > 3 && q.includes(s.split(" ")[0].toLowerCase())));
  return { day, subject: subject || null };
}

export async function weekFor(student, { now = new Date() } = {}) {
  const profile = await profileFor(student);
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const key = istDateKey(now, i);
    days.push({ date: key, label: prettyDate(key), sessions: await dayFor(profile, key) });
  }
  return { group: { branch: profile.branch, year: profile.year, section: profile.section, source: profile.source }, days, method: "TIMETABLE_LOOKUP", kind: "ACTUAL DATA" };
}

// ---- changes ----------------------------------------------------------------

export async function createChange(actor, input, { now = new Date() } = {}) {
  const schedule = await ClassSchedule.findById(input.scheduleId).lean();
  if (!schedule) throw ApiError.notFound("No scheduled class with that id");
  if (!isValidDateKey(input.sessionDate)) throw ApiError.badRequest("sessionDate must be YYYY-MM-DD");
  if (weekdayOf(input.sessionDate) !== schedule.weekday) {
    throw ApiError.badRequest(`${schedule.subject} meets on ${DAY_NAMES[schedule.weekday]}s; ${input.sessionDate} is a ${DAY_NAMES[weekdayOf(input.sessionDate)]}`);
  }
  if (input.type === "ROOM" && !input.newRoom) throw ApiError.badRequest("A room change needs newRoom");
  if (input.type === "RESCHEDULE" && (!isValidDateKey(input.newDate) || !input.newStartTime)) throw ApiError.badRequest("A reschedule needs newDate (YYYY-MM-DD) and newStartTime (HH:MM)");
  const existing = await ClassChange.findOne({ schedule: schedule._id, sessionDate: input.sessionDate }).lean();
  if (existing) throw ApiError.conflict(`This session already has a change (${existing.reference})`);

  const change = new ClassChange({
    reference: await nextReference("CLS"),
    schedule: schedule._id,
    sessionDate: input.sessionDate,
    type: input.type,
    newDate: input.newDate,
    newStartTime: input.newStartTime,
    newRoom: input.newRoom,
    reason: input.reason,
    branch: schedule.branch,
    year: schedule.year,
    section: schedule.section,
    subject: schedule.subject,
    by: actor._id,
    byName: actor.name
  });

  const when = `${prettyDate(input.sessionDate)} ${schedule.startTime}`;
  const title =
    input.type === "CANCEL"
      ? `${schedule.subject} cancelled — ${when}`
      : input.type === "ROOM"
        ? `${schedule.subject} moved to room ${input.newRoom} — ${when}`
        : `${schedule.subject} rescheduled to ${prettyDate(input.newDate)} ${input.newStartTime}`;
  const hoursAway = (istInstant(input.sessionDate, schedule.startTime) - now) / 3600000;
  const notice = await createNotice(
    {
      title,
      body: `${schedule.branch} year ${schedule.year} section ${schedule.section}: ${title}.${input.reason ? ` Reason: ${input.reason}.` : ""} ${input.type === "CANCEL" ? "This session will not be counted in the adjusted attendance view." : ""}`.trim(),
      priority: hoursAway <= 24 ? "HIGH" : "NORMAL",
      audience: { branches: [schedule.branch], years: [schedule.year], sections: [schedule.section], roles: ["STUDENT"] }
    },
    actor,
    { now, kind: "CLASS_CHANGE", related: { kind: "ClassChange", id: String(change._id), reference: change.reference } }
  );
  change.notice = notice._id;
  change.noticeReference = notice.reference;
  await audit(change, {
    entityType: "ClassChange",
    action: `CLASS_${input.type}`,
    actor,
    note: `${schedule.subject} ${schedule.branch}-${schedule.year}${schedule.section} ${when} · notice ${notice.reference} → ${notice.reach} students`
  });
  await change.save();
  // EXCEPTION-ONLY HOOK: campus event log (fire-and-forget — never blocks or fails this request).
  emitEvent({ type: "CLASS_CHANGED", actor, subjectType: "ClassChange", subjectId: change._id, subjectRef: change.reference, channel: "APP", department: "ACADEMIC OFFICE", payload: { changeType: input.type, subject: schedule.subject, sessionDate: input.sessionDate, cohort: { branch: schedule.branch, year: schedule.year, section: schedule.section }, notice: notice.reference, reach: notice.reach } });
  // EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md): propagate the change to everyone it affects.
  // Never fails the change itself: a propagation error is logged and the change stands.
  try {
    await (await import("../xo/changeService.js")).propagateClassChange(change._id, actor, { now });
  } catch (error) {
    console.error("changeService: propagation failed —", error.message);
  }
  return { change: shapeChange(change), notice: { id: String(notice._id), reference: notice.reference, status: notice.status, reach: notice.reach } };
}

export async function listChanges({ limit = 40 } = {}) {
  const rows = await ClassChange.find().sort({ createdAt: -1 }).limit(limit).lean();
  return rows.map(shapeChange);
}

export async function listSchedules() {
  const rows = await ClassSchedule.find().sort({ branch: 1, year: 1, section: 1, weekday: 1, startTime: 1 }).lean();
  return rows.map(shapeSchedule);
}

// ---- adjusted attendance (additional view) ------------------------------------

/** Pure: removes register sessions that fall on a cancelled date. */
export function adjustRecord(record, cancelledDates) {
  const hits = (record.sessions || []).filter((s) => cancelledDates.has(istDateKey(s.date)));
  const attendedHits = hits.filter((s) => s.present !== false && s.status !== "ABSENT" && s.status !== "LEAVE").length;
  const total = Math.max(0, record.totalClasses - hits.length);
  const attended = Math.max(0, record.attendedClasses - attendedHits);
  return {
    subject: record.subject,
    subjectCode: record.subjectCode,
    recorded: { attended: record.attendedClasses, total: record.totalClasses, percentage: record.attendancePercentage },
    cancelledInRegister: hits.map((s) => ({ date: istDateKey(s.date), slot: s.slot, markedPresent: s.present !== false })),
    adjusted: { attended, total, percentage: total ? round((attended / total) * 100, 1) : null }
  };
}

export async function adjustedAttendance(student) {
  const profile = await profileFor(student);
  const [records, changes] = await Promise.all([
    Attendance.find({ student: student._id }).sort({ subject: 1 }).lean(),
    profile.section
      ? ClassChange.find({ type: { $in: ["CANCEL", "RESCHEDULE"] }, branch: profile.branch, year: profile.year, section: profile.section }).lean()
      : []
  ]);
  const bySubject = new Map();
  for (const c of changes) {
    if (!bySubject.has(c.subject)) bySubject.set(c.subject, []);
    bySubject.get(c.subject).push(c);
  }
  const subjects = records.map((record) => {
    const own = bySubject.get(record.subject) || [];
    const row = adjustRecord(record, new Set(own.filter((c) => c.type === "CANCEL").map((c) => c.sessionDate)));
    row.changes = own.map(shapeChange);
    return row;
  });
  const sum = (key, part) => subjects.reduce((t, s) => t + s[key][part], 0);
  const recordedTotal = sum("recorded", "total");
  const adjustedTotal = sum("adjusted", "total");
  return {
    threshold: ATTENDANCE_THRESHOLD,
    recorded: { attended: sum("recorded", "attended"), total: recordedTotal, percentage: recordedTotal ? round((sum("recorded", "attended") / recordedTotal) * 100, 1) : null, label: "OFFICIAL FIGURE — unchanged" },
    adjusted: { attended: sum("adjusted", "attended"), total: adjustedTotal, percentage: adjustedTotal ? round((sum("adjusted", "attended") / adjustedTotal) * 100, 1) : null, label: "ADDITIONAL VIEW — cancelled sessions not counted" },
    subjects,
    group: { branch: profile.branch, year: profile.year, section: profile.section, source: profile.source },
    note: "Sessions that the register holds on a date the timetable marks CANCELLED are shown as 'cancelled — not counted'. The official attendance record and its calculation are not modified.",
    method: "REGISTER_MINUS_CANCELLED_SESSIONS",
    source: "DETERMINISTIC",
    kind: "ACTUAL DATA"
  };
}
