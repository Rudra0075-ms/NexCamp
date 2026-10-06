import { ATTENDANCE_THRESHOLD } from "../../config/constants.js";
import { Anomaly } from "../../models/Anomaly.js";
import { Attendance } from "../../models/Attendance.js";
import { Building } from "../../models/Building.js";
import { Incident } from "../../models/Incident.js";
import { ClassChange } from "../../models/ext/ClassChange.js";
import { ClassSchedule } from "../../models/ext/ClassSchedule.js";
import { ApiError } from "../../utils/ApiError.js";
import { istDateKey, weekdayOf } from "../ext/istTime.js";
import { everyoneWithProfiles, profileFor } from "../ext/profileService.js";
import { SEMESTER_END } from "../xo/changeService.js";
import { DAY, mean, round } from "./stats.js";

/**
 * F6 — Point of no return, and systemic vs individual absence (page 03).
 *
 * Student view: for each subject, the last class date on which reaching the
 * threshold is still mathematically possible if the student keeps missing
 * classes at their recent rate.
 * Staff view: whether a section's drop is about the students or about the
 * class slot itself. There is no faculty role in this system; the academic
 * office (ADMIN) sees every section, a WARDEN sees only their hostel's residents.
 */

export const RECENT_DAYS = 14;
export const MIN_SECTION_STUDENTS = 5;
export const MIN_SESSIONS_PER_WINDOW = 3;
export const DROP_PP = 10;
export const SYSTEMIC_SHARE = 0.6;
export const INDIVIDUAL_DROP_PP = 15;

const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th"}`;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const present = (s) => (s.status ? s.status === "PRESENT" || s.status === "LATE" : s.present);

/** Pure: upcoming class dates for weekdays from `fromKey` (exclusive) to `endKey`, minus cancelled. */
export function upcomingDates(weekdays, fromKey, endKey, cancelled = new Set()) {
  const out = [];
  for (let t = Date.parse(`${fromKey}T00:00:00Z`) + DAY; t <= Date.parse(`${endKey}T00:00:00Z`); t += DAY) {
    const key = new Date(t).toISOString().slice(0, 10);
    if (weekdays.includes(weekdayOf(key)) && !cancelled.has(key)) out.push(key);
  }
  return out;
}

/**
 * Pure: the point of no return for one subject.
 *   spare  = the classes that can still be missed with 100% attendance after:
 *            largest k with (a + R − k) ÷ (t + R) ≥ threshold → k = ⌊a + R − th·(t + R)⌋
 *   at the recent miss rate m, expected misses after i classes = i·m; the point
 *   of no return is the first class where i·m > spare.
 */
export function pointOfNoReturn({ attended, held, upcoming, recentMissRate, threshold = ATTENDANCE_THRESHOLD }) {
  const R = upcoming.length;
  const th = threshold / 100;
  const best = held + R ? ((attended + R) / (held + R)) * 100 : 0;
  const spare = Math.floor(attended + R - th * (held + R) + 1e-9);
  const formula = `spare = ⌊${attended} + ${R} − ${threshold}% × (${held} + ${R})⌋ = ${spare}`;
  if (spare < 0) return { status: "PASSED", spare, remaining: R, bestCase: round(best, 1), text: `Recovery is no longer possible: even attending all ${R} remaining classes ends at ${round(best, 1)}%.`, formula, kind: "ACTUAL DATA" };
  if (!recentMissRate) return { status: "SAFE_AT_RECENT_RATE", spare, remaining: R, bestCase: round(best, 1), text: `At your recent rate you miss nothing, so recovery stays possible. You can still miss ${spare} of ${R} remaining classes.`, formula, kind: "ACTUAL DATA" };
  const i = Math.floor(spare / recentMissRate) + 1;
  if (i > R) return { status: "SAFE_AT_RECENT_RATE", spare, remaining: R, bestCase: round(best, 1), text: `At your recent miss rate (${round(recentMissRate * 100)}%) you stay within reach to the end of semester. You can miss ${spare} more of ${R}.`, formula, kind: "AI PREDICTION" };
  const date = upcoming[i - 1];
  return {
    status: "APPROACHING",
    spare,
    remaining: R,
    bestCase: round(best, 1),
    classesLeftBeforeNoReturn: i - 1,
    lastSafeDate: i >= 2 ? upcoming[i - 2] : null,
    noReturnDate: date,
    text: `Recovery still possible until ${i >= 2 ? upcoming[i - 2] : "your next class"} — after ${i - 1} more class${i - 1 === 1 ? "" : "es"} at a miss rate of ${round(recentMissRate * 100)}%, it no longer is.`,
    formula: `${formula}; at miss rate ${round(recentMissRate, 2)} the ${ordinal(i)} class (${date}) pushes expected misses past ${spare}`,
    kind: "AI PREDICTION"
  };
}

/** Pure: miss rate in the last `days` (null when fewer than MIN_SESSIONS_PER_WINDOW sessions). */
export function recentMissRate(sessions, now = new Date(), days = RECENT_DAYS) {
  const recent = sessions.filter((s) => now - new Date(s.date) <= days * DAY);
  if (recent.length < MIN_SESSIONS_PER_WINDOW) return null;
  return recent.filter((s) => !present(s)).length / recent.length;
}

export async function myPointOfNoReturn(user, { now = new Date() } = {}) {
  const profile = await profileFor(user);
  const records = await Attendance.find({ student: user._id }).lean();
  const todayKey = istDateKey(now);
  const out = [];
  for (const r of records) {
    const schedules = profile?.section ? await ClassSchedule.find({ branch: profile.branch, year: profile.year, section: profile.section, subject: r.subject }).lean() : [];
    const cancelled = new Set((await ClassChange.find({ type: "CANCEL", subject: r.subject, branch: profile?.branch, year: profile?.year, section: profile?.section }).lean()).map((c) => c.sessionDate));
    const weekdays = schedules.map((s) => s.weekday);
    let upcoming = weekdays.length ? upcomingDates(weekdays, todayKey, SEMESTER_END, cancelled) : [];
    // Without a timetable, the semester plan gives a count but no dates.
    if (!upcoming.length && r.semesterPlanned) upcoming = new Array(Math.max(0, r.semesterPlanned - r.totalClasses)).fill(null);
    const rate = recentMissRate(r.sessions || [], now);
    const used = rate ?? (r.totalClasses ? 1 - r.attendedClasses / r.totalClasses : 0);
    const pnr = pointOfNoReturn({ attended: r.attendedClasses, held: r.totalClasses, upcoming, recentMissRate: used });
    out.push({ subject: r.subject, attended: r.attendedClasses, held: r.totalClasses, percentage: r.attendancePercentage, recentMissRate: rate === null ? null : round(rate, 2), missRateUsed: round(used, 2), recentBasis: rate === null ? "fewer than 3 classes in the last 14 days — whole-semester miss rate used" : `last ${RECENT_DAYS} days`, ...pnr });
  }
  const order = { PASSED: 0, APPROACHING: 1, SAFE_AT_RECENT_RATE: 2 };
  return { threshold: ATTENDANCE_THRESHOLD, semesterEnd: SEMESTER_END, semesterEndKind: "ASSUMPTION", subjects: out.sort((a, b) => order[a.status] - order[b.status] || (a.classesLeftBeforeNoReturn ?? 99) - (b.classesLeftBeforeNoReturn ?? 99)), method: "POINT_OF_NO_RETURN (timetable × recent miss rate)" };
}

/** Pure: one section-subject's decomposition. */
export function decompose(students, { now = new Date(), days = RECENT_DAYS } = {}) {
  const cut = now - days * DAY;
  const rows = students.map((s) => {
    const old = s.sessions.filter((x) => new Date(x.date) < cut);
    const recent = s.sessions.filter((x) => new Date(x.date) >= cut);
    const rate = (xs) => (xs.length ? (xs.filter(present).length / xs.length) * 100 : null);
    return { ...s, baseline: rate(old), recent: rate(recent), nOld: old.length, nRecent: recent.length };
  }).filter((r) => r.nOld >= MIN_SESSIONS_PER_WINDOW && r.nRecent >= MIN_SESSIONS_PER_WINDOW);
  if (rows.length < MIN_SECTION_STUDENTS) return { verdict: "INSUFFICIENT DATA", students: rows.length, text: `Insufficient data — ${rows.length} student${rows.length === 1 ? "" : "s"} with ${MIN_SESSIONS_PER_WINDOW}+ classes on both sides of the ${days}-day line (at least ${MIN_SECTION_STUDENTS} needed).`, kind: "INSUFFICIENT DATA" };
  for (const r of rows) r.drop = r.baseline - r.recent;
  const sectionDrop = mean(rows.map((r) => r.drop));
  const dropped = rows.filter((r) => r.drop >= DROP_PP);
  // Which slot drove it: recent vs baseline presence per weekday + slot, all students pooled.
  const slots = new Map();
  for (const r of rows) for (const x of r.sessions) {
    const key = `${DAY_NAMES[new Date(x.date).getDay()]} ${x.slot || "—"}`;
    if (!slots.has(key)) slots.set(key, { old: [], recent: [], dates: new Set() });
    const bucket = slots.get(key);
    (new Date(x.date) < cut ? bucket.old : bucket.recent).push(present(x) ? 1 : 0);
    if (new Date(x.date) >= cut && !present(x)) bucket.dates.add(new Date(x.date).toISOString().slice(0, 10));
  }
  const slotRows = [...slots.entries()].filter(([, v]) => v.old.length >= 3 && v.recent.length >= 3).map(([slot, v]) => ({ slot, baseline: round(mean(v.old) * 100), recent: round(mean(v.recent) * 100), drop: round((mean(v.old) - mean(v.recent)) * 100), absentDates: [...v.dates].sort() })).sort((a, b) => b.drop - a.drop);
  let verdict = "STABLE";
  if (sectionDrop >= DROP_PP && dropped.length / rows.length >= SYSTEMIC_SHARE) verdict = "SYSTEMIC";
  else if (rows.some((r) => r.drop - sectionDrop >= INDIVIDUAL_DROP_PP) && Math.abs(sectionDrop) < DROP_PP) verdict = "INDIVIDUAL";
  else if (sectionDrop >= DROP_PP) verdict = "MIXED";
  const individuals = rows.filter((r) => r.drop - sectionDrop >= INDIVIDUAL_DROP_PP).sort((a, b) => b.drop - a.drop);
  const text = {
    SYSTEMIC: `SYSTEMIC — ${dropped.length} of ${rows.length} students dropped ${DROP_PP}+ points together (section −${round(sectionDrop)} pts)${slotRows[0] ? `, worst on ${slotRows[0].slot} (−${slotRows[0].drop} pts)` : ""}. Look at the slot, room or a campus incident, not the students.`,
    INDIVIDUAL: `INDIVIDUAL — the section moved less than ${DROP_PP} pts (${sectionDrop >= 0 ? "−" : "+"}${Math.abs(round(sectionDrop))}), but ${individuals.length} student${individuals.length === 1 ? "" : "s"} fell ${INDIVIDUAL_DROP_PP}+ pts further than the section.`,
    MIXED: `MIXED — the section fell ${round(sectionDrop)} pts but only ${dropped.length} of ${rows.length} students dropped ${DROP_PP}+ points.`,
    STABLE: `STABLE — no section-wide drop and no student ${INDIVIDUAL_DROP_PP}+ pts below the section's own change.`
  }[verdict];
  return {
    verdict,
    students: rows.length,
    sectionDropPts: round(sectionDrop),
    droppedTogether: dropped.length,
    slots: slotRows.slice(0, 6),
    individuals: individuals.map((r) => ({ name: r.name, studentId: r.studentId, hostel: r.hostel, baseline: round(r.baseline), recent: round(r.recent), dropPts: round(r.drop) })),
    rule: `SYSTEMIC when the section falls ${DROP_PP}+ pts and ≥ ${SYSTEMIC_SHARE * 100}% of students fall ${DROP_PP}+ pts; INDIVIDUAL when the section moves < ${DROP_PP} pts and a student falls ${INDIVIDUAL_DROP_PP}+ pts more than the section. Recent = last ${days} days vs earlier.`,
    text,
    kind: verdict === "INSUFFICIENT DATA" ? "INSUFFICIENT DATA" : "AI DETECTED PATTERN"
  };
}

/** Staff view: every section-subject in scope. */
export async function sectionAttendance(user, { now = new Date() } = {}) {
  if (!["ADMIN", "WARDEN"].includes(user.role)) throw ApiError.forbidden("Section attendance analysis is for the academic office (ADMIN) and wardens (their own hostel)");
  const everyone = await everyoneWithProfiles({ roles: ["STUDENT"] });
  const inScope = everyone.filter((e) => user.role === "ADMIN" || (user.hostelName && e.user.hostelName === user.hostelName));
  const records = await Attendance.find({ student: { $in: inScope.map((e) => e.user._id) } }).lean();
  const byStudent = new Map(inScope.map((e) => [String(e.user._id), e]));
  const groups = new Map();
  for (const r of records) {
    const e = byStudent.get(String(r.student));
    if (!e?.profile.section) continue;
    const key = `${e.profile.branch}|${e.profile.year}|${e.profile.section}|${r.subject}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ id: String(r.student), name: e.user.name, studentId: e.user.studentId, hostel: e.user.hostelName, sessions: r.sessions || [], linkedIncident: r.linkedIncident, record: r });
  }
  const todayKey = istDateKey(now);
  const sections = [];
  const approaching = [];
  for (const [key, students] of groups) {
    const [branch, year, section, subject] = key.split("|");
    const d = decompose(students, { now });
    // Evidence for a systemic drop: incidents / anomalies in the section's hostels during the recent window.
    let evidence = [];
    if (d.verdict === "SYSTEMIC" || d.verdict === "MIXED") {
      const hostels = [...new Set(students.map((s) => s.hostel).filter(Boolean))];
      const buildings = await Building.find({ name: { $in: hostels } }).select("_id name").lean();
      const since = new Date(now - RECENT_DAYS * DAY);
      const [incidents, anomalies] = await Promise.all([
        Incident.find({ building: { $in: buildings.map((b) => b._id) }, $or: [{ firstComplaintAt: { $gte: since } }, { status: { $ne: "RESOLVED" } }] }).select("reference title category").lean(),
        Anomaly.find({ building: { $in: buildings.map((b) => b._id) }, detectedAt: { $gte: since } }).select("metric signal").lean()
      ]);
      const linked = students.filter((s) => s.linkedIncident).length;
      evidence = [...incidents.map((i) => ({ kind: "ACTUAL DATA", text: `${i.reference} ${i.title} (${i.category}) in the section's hostels during the window` })), ...anomalies.map((a) => ({ kind: "AI DETECTED PATTERN", text: `Anomaly: ${a.metric} — ${a.signal}` })), ...(linked ? [{ kind: "ACTUAL DATA", text: `${linked} of these students' ${subject} records are linked to an incident` }] : [])];
    }
    sections.push({ branch, year: Number(year), section, subject, ...d, evidence, evidenceNote: evidence.length ? "Co-occurrence in time and place — AI HYPOTHESIS, not proof of cause." : null });
    const schedules = await ClassSchedule.find({ branch, year: Number(year), section, subject }).lean();
    const upcoming = upcomingDates(schedules.map((s) => s.weekday), todayKey, SEMESTER_END);
    for (const s of students) {
      const rate = recentMissRate(s.sessions, now);
      const p = pointOfNoReturn({ attended: s.record.attendedClasses, held: s.record.totalClasses, upcoming, recentMissRate: rate ?? 0 });
      if (p.status === "APPROACHING" || p.status === "PASSED") approaching.push({ name: s.name, studentId: s.studentId, hostel: s.hostel, cohort: `${branch}-${year}${section}`, subject, status: p.status, classesLeft: p.classesLeftBeforeNoReturn ?? 0, noReturnDate: p.noReturnDate || null, daysLeft: p.noReturnDate ? Math.round((Date.parse(`${p.noReturnDate}T00:00:00Z`) - Date.parse(`${todayKey}T00:00:00Z`)) / DAY) : 0, percentage: s.record.attendancePercentage });
    }
  }
  const rank = { SYSTEMIC: 0, MIXED: 1, INDIVIDUAL: 2, STABLE: 3, "INSUFFICIENT DATA": 4 };
  return {
    scope: user.role === "ADMIN" ? { role: "ADMIN", sees: "every section (academic office)" } : { role: "WARDEN", sees: `residents of ${user.hostelName} only` },
    noFacultyRole: "There is no faculty role in this system; the academic office (ADMIN) stands in for faculty.",
    sections: sections.sort((a, b) => rank[a.verdict] - rank[b.verdict] || (b.sectionDropPts ?? 0) - (a.sectionDropPts ?? 0)),
    approaching: approaching.sort((a, b) => a.daysLeft - b.daysLeft),
    method: "SECTION_VS_STUDENT_DECOMPOSITION + POINT_OF_NO_RETURN"
  };
}
