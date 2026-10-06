import { ClassChange } from "../../models/ext/ClassChange.js";
import { ClassSchedule } from "../../models/ext/ClassSchedule.js";
import { Notice } from "../../models/ext/Notice.js";
import { similarity, tokenize } from "../../utils/text.js";
import { istDateKey, istInstant, istParts, inQuietHours, nextDigestAt, weekdayOf } from "../ext/istTime.js";
import { normaliseAudience, resolveAudience } from "../ext/noticeService.js";
import { applyChanges } from "../ext/timetableService.js";
import { hygiene } from "../xo/reachService.js";
import { attentionBudget, currentLoad, predictReach, receiptsFor } from "./noticeHistory.js";
import { DAY } from "./stats.js";

/**
 * F4 — Notice linter, collision guard and attention budget (page 13).
 *
 * Rule-based, runs while the author types. Checks that a notice is usable
 * (date, time, venue, action, deadline, contact; absolute dates; readable;
 * not sent at night), that it does not collide with what the audience already
 * has (notices today, their timetable, a contradicting active notice), and how
 * much attention that audience has left. Writes nothing.
 */

export const MAX_NOTICES_PER_DAY = 3;
export const READABILITY = { maxWordsPerSentence: 25, maxLongWordShare: 0.15, longWord: 12 };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const pad = (n) => String(n).padStart(2, "0");

const RE = {
  isoDate: /\b(20\d{2})-(\d{2})-(\d{2})\b/,
  dayMonth: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS.join("|")})[a-z]*\\b`, "i"),
  monthDay: new RegExp(`\\b(${MONTHS.join("|")})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i"),
  slashDate: /\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/,
  weekday: new RegExp(`\\b(?:(next|this|coming)\\s+)?(${WEEKDAYS.join("|")})\\b`, "i"),
  relative: /\b(today|tonight|tomorrow|day after tomorrow|this evening|this morning)\b/i,
  time: /\b(\d{1,2})(?::|\.)(\d{2})\s*(am|pm)?\b|\b(\d{1,2})\s*(am|pm)\b|\b(noon|midnight)\b/i,
  venue: /\b(room\s*[a-z0-9-]+|[a-z]{1,3}-\d{2,3}|hall|block\s+[a-z]|[a-z]\s+block|lab\s*[-#]?\d+|laboratory\s*\d+|venue|auditorium|ground|library|seminar hall|classroom|court\s*\d*|office|counter\s*\d+|online|google meet|zoom|teams|mess hall|at the mess)\b/i,
  eventish: /\b(class|exam|examination|test|quiz|meeting|session|event|workshop|seminar|lecture|lab|drive|camp|programme|program|practical|viva|assembly|orientation|rehearsal)\b/i,
  action: /\b(submit|bring|attend|register|report|pay|collect|fill|carry|apply|upload|sign|complete|reply|confirm|visit|deposit|action required)\b/i,
  // Actions that need a deadline of their own (attending an event is bounded by the event's time).
  deadlineAction: /\b(submit|bring|register|pay|collect|fill|apply|upload|sign|complete|reply|confirm|deposit)\b/i,
  deadline: /\b(by|before|deadline|last date|no later than|until|till|due)\b/i,
  contact: /(\+?\d[\d\s-]{8,}\d)|\b[\w.+-]+@[\w-]+\.[\w.]+\b|\b(contact|call|reach|enquir|helpdesk|help desk|office|warden|coordinator|ext\.?\s*\d+)\b/i
};

/** Pure: an absolute date (IST key) the text names, and whether it named it relatively. */
export function extractWhen(text, now = new Date()) {
  const t = String(text || "");
  const year = istParts(now).y;
  const today = istDateKey(now);
  let dateKey = null;
  let relative = null;
  let absolute = false;
  let m;
  if ((m = RE.isoDate.exec(t))) dateKey = `${m[1]}-${m[2]}-${m[3]}`;
  else if ((m = RE.dayMonth.exec(t))) dateKey = `${year}-${pad(MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1)}-${pad(Number(m[1]))}`;
  else if ((m = RE.monthDay.exec(t))) dateKey = `${year}-${pad(MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1)}-${pad(Number(m[2]))}`;
  else if ((m = RE.slashDate.exec(t)) && Number(m[2]) <= 12 && Number(m[1]) <= 31 && !RE.time.exec(m[0])) dateKey = `${m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : year}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  absolute = Boolean(dateKey);
  const rel = RE.relative.exec(t);
  if (rel) {
    const word = rel[1].toLowerCase();
    const add = word === "tomorrow" ? 1 : word === "day after tomorrow" ? 2 : 0;
    relative = { word: rel[1], dateKey: istDateKey(now, add) };
    if (!dateKey) dateKey = relative.dateKey;
  } else if ((m = RE.weekday.exec(t))) {
    const target = WEEKDAYS.indexOf(m[2].toLowerCase());
    let add = (target - weekdayOf(today) + 7) % 7;
    if (add === 0 || (m[1] || "").toLowerCase() === "next") add = add || 7;
    relative = { word: m[0], dateKey: istDateKey(now, add) };
    if (!dateKey) dateKey = relative.dateKey;
  }
  let time = null;
  const tm = RE.time.exec(t);
  if (tm) {
    if (tm[6]) time = tm[6].toLowerCase() === "noon" ? "12:00" : "00:00";
    else {
      let h = Number(tm[1] ?? tm[4]);
      const min = Number(tm[2] ?? 0);
      const ap = (tm[3] || tm[5] || "").toLowerCase();
      if (ap === "pm" && h < 12) h += 12;
      if (ap === "am" && h === 12) h = 0;
      if (h <= 23 && min <= 59) time = `${pad(h)}:${pad(min)}`;
    }
  }
  return { dateKey, time, relative, absolute };
}

const pretty = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return `${WEEKDAYS[weekdayOf(key)].replace(/^\w/, (c) => c.toUpperCase())} ${d} ${MONTHS[m - 1].replace(/^\w/, (c) => c.toUpperCase())} ${y}`;
};

/** Pure: content findings for one draft. */
export function lintText({ title = "", body = "", priority = "NORMAL", scheduledFor } = {}, { now = new Date() } = {}) {
  const text = `${title}. ${body}`;
  const when = extractWhen(text, now);
  const findings = [];
  const add = (rule, severity, message, suggestion) => findings.push({ rule, severity, message, suggestion: suggestion || null });
  const eventish = RE.eventish.test(text);
  const action = RE.action.test(text);

  if (!when.dateKey) add("MISSING_DATE", "WARN", "No date found.", "Add the date, e.g. “Monday 29 Sep 2026”.");
  if (when.relative && !when.absolute) add("RELATIVE_DATE", "WARN", `“${when.relative.word}” is relative — it means a different day to whoever reads it late.`, `Write the absolute date: ${pretty(when.relative.dateKey)}.`);
  if (eventish && !when.time) add("MISSING_TIME", "WARN", "No time found for what looks like an event.", "Add a time, e.g. “14:00”.");
  if (eventish && !RE.venue.test(text)) add("MISSING_VENUE", "WARN", "No venue found for what looks like an event.", "Add where, e.g. “Room 204, Academic Block A”.");
  if (!action && eventish) add("MISSING_ACTION", "INFO", "It is not clear what the reader must do.", "Say the action: attend, bring, submit…");
  if (RE.deadlineAction.test(text) && !RE.deadline.test(text)) add("MISSING_DEADLINE", "WARN", "An action is asked for, but there is no deadline.", "Add “by <date> <time>”.");
  if (!RE.contact.test(text)) add("MISSING_CONTACT", "INFO", "No contact for questions.", "Add who to ask, e.g. “Academic office, ext. 214”.");

  const sentences = String(body || title).split(/[.!?]+\s/).map((s) => s.trim()).filter(Boolean);
  const words = tokenize(`${title} ${body}`).length ? String(`${title} ${body}`).split(/\s+/).filter(Boolean) : [];
  const perSentence = sentences.length ? words.length / sentences.length : 0;
  const longShare = words.length ? words.filter((w) => w.replace(/[^a-z]/gi, "").length >= READABILITY.longWord).length / words.length : 0;
  if (perSentence > READABILITY.maxWordsPerSentence) add("READABILITY", "INFO", `Sentences average ${Math.round(perSentence)} words (limit ${READABILITY.maxWordsPerSentence}).`, "Split long sentences; one instruction per sentence.");
  if (longShare > READABILITY.maxLongWordShare && words.length >= 12) add("READABILITY", "INFO", `${Math.round(longShare * 100)}% long words.`, "Prefer short everyday words.");

  const sendAt = scheduledFor ? new Date(scheduledFor) : now;
  if (inQuietHours(sendAt) && priority !== "CRITICAL") add("NIGHT_SEND", "WARN", "It would go out between 22:00 and 07:00 IST.", `Schedule it for ${nextDigestAt(sendAt).toISOString()} (07:30 IST).`);

  return {
    findings,
    extracted: { date: when.dateKey, time: when.time, relative: when.relative?.word || null, eventish, action },
    readability: { wordsPerSentence: Math.round(perSentence * 10) / 10, longWordPct: Math.round(longShare * 100), limits: READABILITY, limitsKind: "ASSUMPTION" },
    score: Math.max(0, 100 - findings.reduce((t, f) => t + (f.severity === "WARN" ? 15 : 5), 0)),
    method: "RULE_BASED_NOTICE_LINT"
  };
}

const toMin = (hhmm) => {
  const [h, m] = String(hhmm || "00:00").split(":").map(Number);
  return h * 60 + (m || 0);
};

/** Pure: the timetable sessions of any cohort in `cohorts` overlapping a 60-minute event at dateKey/time. */
export function timetableOverlap({ dateKey, time, durationMin = 60 }, schedules, changes) {
  if (!dateKey || !time) return [];
  const start = toMin(time);
  const end = start + durationMin;
  return applyChanges(dateKey, schedules, changes)
    .filter((s) => s.status !== "CANCELLED" && s.status !== "MOVED_AWAY")
    .filter((s) => {
      const a = toMin(s.startTime);
      const b = s.endTime ? toMin(s.endTime) : a + 60;
      return a < end && start < b;
    });
}

/** Full lint: text + collisions + attention budget + predicted reach + the existing hygiene checks. */
export async function lintNotice(input = {}, { now = new Date() } = {}) {
  const text = lintText(input, { now });
  const audience = normaliseAudience(input.audience || {});
  const recipients = await resolveAudience(audience);
  const ids = recipients.map((r) => r.user._id);
  const [rows, base] = await Promise.all([receiptsFor(ids, { days: 84, now }), hygiene({ title: input.title, body: input.body, audience: input.audience || {}, priority: input.priority || "NORMAL", scheduledFor: input.scheduledFor }, { now })]);

  // Collision: notices already received today.
  const today = istDateKey(now);
  const perStudentToday = new Map();
  for (const r of rows) if (r.publishedAt && istDateKey(r.publishedAt) === today) perStudentToday.set(r.student, (perStudentToday.get(r.student) || 0) + 1);
  const overloaded = [...perStudentToday.values()].filter((n) => n >= MAX_NOTICES_PER_DAY).length;
  const collisions = [];
  if (overloaded) collisions.push({ rule: "TOO_MANY_TODAY", severity: "WARN", message: `${overloaded} of ${recipients.length} recipients already received ${MAX_NOTICES_PER_DAY}+ notices today.`, suggestion: "Hold it for tomorrow's digest unless it is urgent.", kind: "ACTUAL DATA" });

  // Collision: the event time overlaps the audience's timetable.
  if (text.extracted.date && text.extracted.time) {
    const cohorts = new Map();
    for (const r of recipients) if (r.profile.branch && r.profile.year && r.profile.section) cohorts.set(`${r.profile.branch}|${r.profile.year}|${r.profile.section}`, (cohorts.get(`${r.profile.branch}|${r.profile.year}|${r.profile.section}`) || 0) + 1);
    for (const [key, count] of cohorts) {
      const [branch, year, section] = key.split("|");
      const [schedules, changes] = await Promise.all([
        ClassSchedule.find({ branch, year: Number(year), section }).lean(),
        ClassChange.find({ branch, year: Number(year), section, $or: [{ sessionDate: text.extracted.date }, { newDate: text.extracted.date }] }).lean()
      ]);
      for (const s of timetableOverlap({ dateKey: text.extracted.date, time: text.extracted.time }, schedules, changes)) {
        collisions.push({ rule: "TIMETABLE_OVERLAP", severity: "WARN", message: `${text.extracted.date} ${text.extracted.time} overlaps ${branch}-${year}${section} ${s.subject} ${s.startTime}${s.endTime ? `–${s.endTime}` : ""} (${s.room || "room —"}) for ${count} recipient${count === 1 ? "" : "s"}.`, suggestion: "Move the event or narrow the audience.", kind: "ACTUAL DATA" });
      }
    }
  }

  // Collision: an active notice on the same subject names a different date.
  if (text.extracted.date) {
    const active = await Notice.find({ status: "PUBLISHED", publishedAt: { $gte: new Date(now - 14 * DAY) }, supersededBy: { $exists: false } }).select("reference title body publishedAt").lean();
    for (const n of active) {
      const sim = similarity(`${input.title} ${input.body}`, `${n.title} ${n.body}`);
      if (sim < 0.2) continue;
      const other = extractWhen(`${n.title}. ${n.body}`, new Date(n.publishedAt));
      if (other.dateKey && other.dateKey !== text.extracted.date) collisions.push({ rule: "CONTRADICTS_ACTIVE", severity: "WARN", message: `${n.reference} (“${n.title}”) is still active and says ${other.dateKey}; this says ${text.extracted.date} (${Math.round(sim * 100)}% word overlap).`, suggestion: `If this replaces it, mark ${n.reference} as superseded.`, reference: n.reference, kind: "ACTUAL DATA" });
    }
  }

  const budget = attentionBudget(rows);
  const load = currentLoad(rows, now);
  const priority = String(input.priority || "NORMAL").toUpperCase();
  const digest = (priority === "INFO" || priority === "NORMAL") && load.median >= 4
    ? { text: `Recipients have had a median of ${load.median} notices this week. Bundle this ${priority} notice into the morning digest instead of sending it on its own.`, kind: "RECOMMENDED ACTION" }
    : null;
  const at = input.scheduledFor ? new Date(input.scheduledFor) : now;
  return {
    ...text,
    collisions,
    attention: { ...budget, thisWeek: load, digest },
    reach: predictReach(rows, { recipients: recipients.length, channel: "APP", at }),
    hygiene: base,
    audienceCount: recipients.length,
    writes: 0,
    method: "RULE_BASED_NOTICE_LINT + RECEIPT_HISTORY",
    kind: "ACTUAL DATA"
  };
}

export { istInstant };
