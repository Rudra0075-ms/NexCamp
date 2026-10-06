import { ATTENDANCE_THRESHOLD } from "../config/constants.js";
import { Attendance } from "../models/Attendance.js";
import { simulate } from "./attendanceService.js";
import { clamp, round } from "../utils/text.js";

/**
 * Attendance intelligence.
 *
 * Reads the register (one Attendance document per subject, each holding its
 * individual sessions) and derives everything the Attendance page and the
 * dashboard show: the pattern classification and why it was given, the
 * subject table, the "why did it change" breakdown, the timeline, the classes
 * inferred from the timetable, and the end-of-semester projection.
 *
 * All of it is arithmetic and fixed rules over the student's own records —
 * nothing here is a model's guess, and every classification returns the
 * numbers that produced it. `analyseAttendance` is pure so it can be tested
 * without a database.
 */

const DAY = 864e5;
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export const PATTERNS = ["STABLE", "IMPROVING", "DECLINING", "IRREGULAR", "INSUFFICIENT DATA"];
export const STATUSES = ["SAFE", "WATCH", "AT RISK", "CRITICAL"];

const pct = (attended, held) => (held ? (attended / held) * 100 : null);
const mean = (values) => (values.length ? values.reduce((t, v) => t + v, 0) / values.length : 0);
function stdev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((t, v) => t + (v - m) ** 2, 0) / (values.length - 1));
}

// Dates are read in the server's local time, the same clock the register and
// the mess records are written in.
function dayKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Monday of the week a date falls in, as YYYY-MM-DD. */
function weekKey(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const offset = (d.getDay() + 6) % 7;
  return dayKey(new Date(d.getTime() - offset * DAY));
}

/** A session's register mark, reading older rows that only carry `present`. */
export function statusOf(session) {
  if (session.status) return session.status;
  return session.present ? "PRESENT" : "ABSENT";
}

/** Flattens the per-subject documents into one chronological session list. */
export function flattenSessions(records) {
  const rows = [];
  for (const record of records) {
    for (const session of record.sessions || []) {
      const status = statusOf(session);
      rows.push({
        subject: record.subject,
        subjectCode: record.subjectCode || null,
        date: new Date(session.date),
        day: dayKey(session.date),
        weekday: new Date(session.date).getDay(),
        slot: session.slot || "—",
        status,
        present: status === "PRESENT" || status === "LATE"
      });
    }
  }
  return rows.sort((a, b) => a.date - b.date || a.slot.localeCompare(b.slot));
}

function risk(percentage, threshold) {
  if (percentage === null) return { status: "SAFE", level: "LOW" };
  if (percentage < threshold - 10) return { status: "CRITICAL", level: "CRITICAL" };
  if (percentage < threshold) return { status: "AT RISK", level: "HIGH" };
  if (percentage < threshold + 5) return { status: "WATCH", level: "MEDIUM" };
  return { status: "SAFE", level: "LOW" };
}

/**
 * Classifies a sequence of sessions (oldest first) into a pattern, with the
 * reasons that decided it. The rules are fixed and stated in `rule`.
 */
export function classifyPattern(sessions, { now = new Date(), windowDays = 14 } = {}) {
  const cut = now.getTime() - windowDays * DAY;
  const priorCut = cut - windowDays * DAY;
  const recent = sessions.filter((s) => s.date.getTime() > cut && s.date.getTime() <= now.getTime());
  const prior = sessions.filter((s) => s.date.getTime() > priorCut && s.date.getTime() <= cut);

  const recentRate = pct(recent.filter((s) => s.present).length, recent.length);
  const priorRate = pct(prior.filter((s) => s.present).length, prior.length);

  // Weekly attendance rates, oldest first, over the weeks that held a class.
  const weeks = new Map();
  for (const s of sessions) {
    const key = weekKey(s.date);
    const row = weeks.get(key) || { week: key, held: 0, attended: 0 };
    row.held += 1;
    if (s.present) row.attended += 1;
    weeks.set(key, row);
  }
  const weekly = [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week)).map((row) => ({ ...row, rate: round(pct(row.attended, row.held), 1) }));

  // Consecutive week-on-week declines ending at the latest week.
  let declines = 0;
  for (let i = weekly.length - 1; i > 0 && weekly[i].rate < weekly[i - 1].rate; i -= 1) declines += 1;
  let rises = 0;
  for (let i = weekly.length - 1; i > 0 && weekly[i].rate > weekly[i - 1].rate; i -= 1) rises += 1;

  const reasons = [];
  let pattern = "STABLE";

  if (recent.length < 3 || prior.length < 3) {
    pattern = "INSUFFICIENT DATA";
    reasons.push(`Only ${recent.length} classes in the last ${windowDays} days and ${prior.length} in the ${windowDays} before — at least 3 in each are needed to judge a direction.`);
  } else {
    const diff = recentRate - priorRate;
    const recentMissed = recent.filter((s) => !s.present).length;
    const priorMissed = prior.filter((s) => !s.present).length;
    // A direction needs at least two missed classes behind it (and more than
    // the other window), so a single absence in a small subject is not called
    // a decline.
    const weeklyDrop = declines >= 2 && weekly[weekly.length - 1].rate < weekly[weekly.length - 1 - declines].rate - 10;
    // Irregularity only means something across weeks that each held a few classes.
    const fullWeeks = weekly.filter((w) => w.held >= 3);
    const fullSpread = stdev(fullWeeks.map((w) => w.rate));
    if ((diff <= -10 || weeklyDrop) && recentMissed >= 2 && recentMissed > priorMissed) {
      pattern = "DECLINING";
    } else if ((diff >= 10 || rises >= 2) && priorMissed >= 2 && recentMissed < priorMissed) {
      pattern = "IMPROVING";
    } else if (fullWeeks.length >= 3 && fullSpread >= 18) {
      pattern = "IRREGULAR";
    }
    reasons.push(`Last ${windowDays} days: ${recent.filter((s) => s.present).length} of ${recent.length} attended (${round(recentRate, 1)}%), against ${prior.filter((s) => s.present).length} of ${prior.length} (${round(priorRate, 1)}%) in the ${windowDays} days before.`);
    if (declines >= 2) reasons.push(`${declines + 1} consecutive weeks of decline (${weekly.slice(-declines - 1).map((w) => `${w.rate}%`).join(" → ")}).`);
    if (rises >= 2) reasons.push(`${rises + 1} consecutive weeks of improvement (${weekly.slice(-rises - 1).map((w) => `${w.rate}%`).join(" → ")}).`);
    if (pattern === "IRREGULAR") reasons.push(`Weekly attendance swings widely (spread ±${round(fullSpread, 1)} points across ${fullWeeks.length} weeks).`);
  }

  // How much evidence stands behind the label, not a model probability.
  const n = recent.length + prior.length;
  const margin = recentRate !== null && priorRate !== null ? Math.abs(recentRate - priorRate) : 0;
  const confidence = pattern === "INSUFFICIENT DATA" ? null : Math.round(clamp(48 + Math.min(n, 30) * 1.1 + Math.min(margin, 35) * 0.55, 40, 94));

  return {
    pattern,
    reasons,
    confidence,
    confidenceBasis: "Rule-based: grows with the number of classes compared and the size of the change. It is not a model probability.",
    recent: { held: recent.length, attended: recent.filter((s) => s.present).length, rate: recentRate === null ? null : round(recentRate, 1) },
    prior: { held: prior.length, attended: prior.filter((s) => s.present).length, rate: priorRate === null ? null : round(priorRate, 1) },
    weekly,
    rule: `DECLINING if the last ${windowDays} days are ≥10 points below the ${windowDays} before (or 2+ straight weekly falls totalling >10 points) with at least 2 missed and more than before; IMPROVING if ≥10 points above or 2+ straight weekly rises, with fewer missed than before (from at least 2); IRREGULAR if weeks holding 3+ classes spread ≥18 points; otherwise STABLE.`
  };
}

/** Next occurrences of each subject's usual weekday+slot, inferred from the register. */
function inferUpcoming(sessions, now, limit = 6) {
  const combos = new Map();
  for (const s of sessions) {
    const key = `${s.subject}|${s.weekday}|${s.slot}`;
    combos.set(key, (combos.get(key) || 0) + 1);
  }
  const regular = [...combos.entries()].filter(([, count]) => count >= 2).map(([key]) => key.split("|"));
  const upcoming = [];
  for (let ahead = 0; ahead < 8 && upcoming.length < 40; ahead += 1) {
    const day = new Date(now.getTime() + ahead * DAY);
    for (const [subject, weekday, slot] of regular) {
      if (day.getDay() !== Number(weekday)) continue;
      const [h, m] = slot.split(":").map(Number);
      const at = new Date(day);
      at.setHours(h || 0, m || 0, 0, 0);
      if (at.getTime() > now.getTime()) upcoming.push({ subject, at: at.toISOString(), day: WEEKDAYS[at.getDay()], date: dayKey(at), slot });
    }
  }
  return upcoming.sort((a, b) => a.at.localeCompare(b.at)).slice(0, limit);
}

/** How many classes can be missed / must be attended for a held+attended pair. */
function margins(attended, held, threshold) {
  const s = simulate({ attendedClasses: attended, totalClasses: held, plannedClasses: 0, threshold });
  return { classesCanMiss: s.classesCanMiss, classesToThreshold: s.classesToThreshold };
}

/**
 * The full analysis for one student's register. `records` are Attendance
 * documents (lean objects are fine). Pure.
 */
export function analyseAttendance(records, { now = new Date(), windowDays = 14, threshold = ATTENDANCE_THRESHOLD } = {}) {
  const sessions = flattenSessions(records).filter((s) => s.date.getTime() <= now.getTime());
  const held = records.reduce((t, r) => t + (r.totalClasses || 0), 0);
  const attended = records.reduce((t, r) => t + (r.attendedClasses || 0), 0);
  const overall = pct(attended, held);

  if (!records.length || !held) {
    return {
      empty: true,
      threshold,
      message: "No attendance has been recorded for this account yet, so there is nothing to analyse."
    };
  }

  const planned = records.every((r) => Number.isFinite(r.semesterPlanned)) ? records.reduce((t, r) => t + r.semesterPlanned, 0) : null;
  const overallRisk = risk(overall, threshold);
  const classification = classifyPattern(sessions, { now, windowDays });
  const m = margins(attended, held, threshold);

  // Cumulative percentage by day — the trend line — and where it crossed the bar.
  let runHeld = 0;
  let runAttended = 0;
  const byDay = new Map();
  for (const s of sessions) {
    const row = byDay.get(s.day) || { date: s.day, held: 0, attended: 0 };
    row.held += 1;
    if (s.present) row.attended += 1;
    byDay.set(s.day, row);
  }
  const trend = [...byDay.values()].map((row) => {
    runHeld += row.held;
    runAttended += row.attended;
    return { ...row, cumulative: round(pct(runAttended, runHeld), 1), rate: round(pct(row.attended, row.held), 1) };
  });

  const monthly = new Map();
  for (const s of sessions) {
    const key = s.day.slice(0, 7);
    const row = monthly.get(key) || { month: key, held: 0, attended: 0 };
    row.held += 1;
    if (s.present) row.attended += 1;
    monthly.set(key, row);
  }

  // The window the "why" and "recent change" answers talk about.
  const cut = now.getTime() - windowDays * DAY;
  const inWindow = sessions.filter((s) => s.date.getTime() > cut);
  const before = sessions.filter((s) => s.date.getTime() <= cut);
  const startPct = before.length ? round(pct(before.filter((s) => s.present).length, before.length), 1) : null;
  const missedInWindow = inWindow.filter((s) => !s.present);

  const subjects = records
    .map((record) => {
      const own = sessions.filter((s) => s.subject === record.subject);
      const percentage = pct(record.attendedClasses, record.totalClasses);
      const cls = classifyPattern(own, { now, windowDays });
      const rk = risk(percentage, threshold);
      const recentMissed = own.filter((s) => s.date.getTime() > cut && !s.present).length;
      const trendArrow = cls.pattern === "DECLINING" ? "DOWN" : cls.pattern === "IMPROVING" ? "UP" : "FLAT";
      return {
        id: String(record._id || record.subject),
        subject: record.subject,
        subjectCode: record.subjectCode || null,
        attendedClasses: record.attendedClasses,
        totalClasses: record.totalClasses,
        percentage: round(percentage, 1),
        semesterPlanned: Number.isFinite(record.semesterPlanned) ? record.semesterPlanned : null,
        remaining: Number.isFinite(record.semesterPlanned) ? Math.max(0, record.semesterPlanned - record.totalClasses) : null,
        risk: rk.level,
        status: rk.status,
        trend: trendArrow,
        pattern: cls.pattern,
        patternReasons: cls.reasons,
        recentRate: cls.recent.rate,
        priorRate: cls.prior.rate,
        missedInWindow: recentMissed,
        late: own.filter((s) => s.status === "LATE").length,
        leave: own.filter((s) => s.status === "LEAVE").length,
        ...margins(record.attendedClasses, record.totalClasses, threshold),
        linkedIncident: record.linkedIncident
          ? { id: String(record.linkedIncident._id || record.linkedIncident), reference: record.linkedIncident.reference || null, title: record.linkedIncident.title || null }
          : null,
        sessions: own.map((s) => ({ date: s.date.toISOString(), slot: s.slot, status: s.status }))
      };
    })
    .sort((a, b) => a.percentage - b.percentage);

  // Why: which subjects and slots the window's absences came from.
  const bySubject = new Map();
  for (const s of missedInWindow) bySubject.set(s.subject, (bySubject.get(s.subject) || 0) + 1);
  const bySlotMissed = new Map();
  for (const s of missedInWindow) bySlotMissed.set(s.slot, (bySlotMissed.get(s.slot) || 0) + 1);

  const slotRates = [...new Set(sessions.map((s) => s.slot))].sort().map((slot) => {
    const all = sessions.filter((s) => s.slot === slot);
    const recent = all.filter((s) => s.date.getTime() > cut);
    return {
      slot,
      held: all.length,
      rate: round(pct(all.filter((s) => s.present).length, all.length), 1),
      recentHeld: recent.length,
      recentRate: recent.length ? round(pct(recent.filter((s) => s.present).length, recent.length), 1) : null
    };
  });
  const weekdayRates = [1, 2, 3, 4, 5].map((weekday) => {
    const all = sessions.filter((s) => s.weekday === weekday);
    return { weekday: WEEKDAYS[weekday], held: all.length, rate: all.length ? round(pct(all.filter((s) => s.present).length, all.length), 1) : null };
  });

  const why = {
    windowDays,
    from: startPct,
    to: round(overall, 1),
    change: startPct === null ? null : round(overall - startPct, 1),
    missed: missedInWindow.length,
    held: inWindow.length,
    bySubject: [...bySubject.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([subject, missed]) => ({
        subject,
        missed,
        sessions: missedInWindow.filter((s) => s.subject === subject).map((s) => ({ date: s.day, slot: s.slot, status: s.status }))
      })),
    bySlot: [...bySlotMissed.entries()].sort((a, b) => b[1] - a[1]).map(([slot, missed]) => ({ slot, missed })),
    insufficient: inWindow.length < 3
  };

  // Timeline events worth flagging, computed from the register.
  const events = [];
  let wasAbove = null;
  let rh = 0;
  let ra = 0;
  for (const s of sessions) {
    rh += 1;
    if (s.present) ra += 1;
    const p = pct(ra, rh);
    const above = p >= threshold;
    if (wasAbove !== null && above !== wasAbove && rh >= 5) {
      events.push({ date: s.day, kind: above ? "RECOVERED" : "BELOW THRESHOLD", text: `${above ? "Back above" : "Fell below"} ${threshold}% (${round(p, 1)}%) after ${s.subject} on ${s.day}.` });
    }
    wasAbove = above;
  }
  for (const subject of subjects) {
    let streak = 0;
    let start = null;
    for (const s of sessions.filter((x) => x.subject === subject.subject)) {
      if (!s.present) {
        streak += 1;
        if (streak === 1) start = s.day;
        if (streak === 2) events.push({ date: s.day, kind: "ABSENCE STREAK", text: `${subject.subject}: consecutive absences starting ${start}.` });
      } else streak = 0;
    }
  }
  sessions.filter((s) => s.status === "LEAVE").forEach((s) => events.push({ date: s.day, kind: "LEAVE", text: `Approved leave recorded for ${s.subject} — still counts as a missed class.` }));
  events.sort((a, b) => b.date.localeCompare(a.date));

  // End of semester, if the planned total is known: attend everything left,
  // or keep the recent rate.
  let semester = null;
  if (planned !== null) {
    const remaining = Math.max(0, planned - held);
    const recentRate = classification.recent.rate ?? round(overall, 1);
    const atRecent = pct(attended + Math.round((remaining * recentRate) / 100), planned);
    const attendAll = pct(attended + remaining, planned);
    let neededShare = null;
    if (remaining) {
      const need = Math.ceil((threshold / 100) * planned - attended);
      neededShare = need <= 0 ? 0 : need > remaining ? null : round((need / remaining) * 100, 1);
    }
    semester = {
      planned,
      remaining,
      projectedAtRecentRate: round(atRecent, 1),
      projectedIfAttendAll: round(attendAll, 1),
      recentRate,
      neededShareOfRemaining: neededShare,
      reachable: attendAll >= threshold,
      kind: "PROJECTED STATUS",
      method: "ARITHMETIC_PROJECTION"
    };
  }

  return {
    empty: false,
    generatedAt: now,
    threshold,
    windowDays,
    overall: round(overall, 1),
    attendedClasses: attended,
    totalClasses: held,
    missedClasses: held - attended,
    lateCount: sessions.filter((s) => s.status === "LATE").length,
    leaveCount: sessions.filter((s) => s.status === "LEAVE").length,
    status: overallRisk.status,
    risk: overallRisk.level,
    eligible: overall >= threshold,
    ...m,
    classification,
    subjects,
    trend,
    weekly: classification.weekly,
    monthly: [...monthly.values()].map((row) => ({ ...row, rate: round(pct(row.attended, row.held), 1) })),
    slotRates,
    weekdayRates,
    why,
    events: events.slice(0, 20),
    timeline: sessions.slice().reverse().map((s) => ({ date: s.date.toISOString(), day: s.day, subject: s.subject, slot: s.slot, status: s.status })),
    upcoming: inferUpcoming(sessions, now),
    semester,
    dataRange: sessions.length ? { from: sessions[0].day, to: sessions[sessions.length - 1].day, sessions: sessions.length } : null,
    methods: {
      classification: "RULE_BASED_PATTERN",
      projection: "ARITHMETIC_PROJECTION",
      upcoming: "INFERRED_FROM_REGISTER",
      note: "Every figure is computed from your attendance register. No language model produces these numbers."
    }
  };
}

export async function attendanceIntelligence(studentId, options = {}) {
  const records = await Attendance.find({ student: studentId })
    .populate("linkedIncident", "reference title risk")
    .sort({ subject: 1 })
    .lean();
  return analyseAttendance(records, options);
}
