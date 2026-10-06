import { Attendance } from "../models/Attendance.js";
import { Building } from "../models/Building.js";
import { CampusMemory } from "../models/CampusMemory.js";
import { Complaint } from "../models/Complaint.js";
import { GatePass } from "../models/GatePass.js";
import { MessFeedback } from "../models/MessFeedback.js";
import { MessRecord } from "../models/MessRecord.js";
import { User } from "../models/User.js";
import { AlertState } from "../models/AlertState.js";
import { SLA_BY_PRIORITY } from "./classificationService.js";
import { findRecurring } from "./recurrenceService.js";
import { predictComplaintVolume } from "./predictionService.js";
import { slaForecast } from "./operationsIntelligenceService.js";
import { loadMealDays, predictMeal, MEAL_ORDER } from "./messIntelligenceService.js";
import { round } from "../utils/text.js";

/**
 * Campus early warning, predictive insights, recurring-issue intelligence and
 * the Campus Pulse indicator (PS07 features 1–4, 7 and 8).
 *
 * Everything here is computed from stored records. The pure functions at the
 * top take plain rows so they can be tested without a database; the loaders at
 * the bottom read the collections and hand the rows in.
 *
 * Every statement produced carries one of five kinds, so the interface can
 * never present a guess as a fact:
 *   ACTUAL DATA          counted from records
 *   AI DETECTED PATTERN  a rule found a shape in the counts
 *   AI HYPOTHESIS        a possible explanation — not verified
 *   AI PREDICTION        an estimate about the future
 *   RECOMMENDED ACTION   what an operator could do next
 */

export const KINDS = {
  DATA: "ACTUAL DATA",
  PATTERN: "AI DETECTED PATTERN",
  HYPOTHESIS: "AI HYPOTHESIS",
  PREDICTION: "AI PREDICTION",
  ACTION: "RECOMMENDED ACTION"
};

export const TIERS = ["CRITICAL", "WARNING", "WATCH", "NORMAL"];
export const INSUFFICIENT = "Insufficient data to determine the cause.";
export const INSUFFICIENT_PREDICTION = "Insufficient data for a reliable prediction.";

const DAY = 864e5;
const MAINTENANCE = ["WATER", "ELECTRICITY", "WI-FI", "CLEANLINESS"];

const CATEGORY_DEPARTMENT = {
  WATER: "MAINTENANCE · PLUMBING",
  ELECTRICITY: "MAINTENANCE · ELECTRICAL",
  "WI-FI": "IT · NETWORK",
  CLEANLINESS: "HOUSEKEEPING",
  MESS: "MESS ADMINISTRATION",
  SAFETY: "SECURITY",
  ATTENDANCE: "ACADEMIC OFFICE",
  HEALTH: "MEDICAL CENTRE",
  OTHER: "GENERAL ADMINISTRATION"
};
export const departmentFor = (category) => CATEGORY_DEPARTMENT[category] || CATEGORY_DEPARTMENT.OTHER;

// Local calendar day, so "today" matches the campus clock rather than UTC.
export function dayKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dayRange(days, now) {
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  return Array.from({ length: days }, (_, i) => dayKey(new Date(end.getTime() - (days - 1 - i) * DAY)));
}

const mean = (values) => (values.length ? values.reduce((t, v) => t + v, 0) / values.length : null);

// ---------------------------------------------------------------------------
// Rooms and floors
// ---------------------------------------------------------------------------

/**
 * Reads a room out of a free-text location: "HOSTEL B · B-214" → B-214, floor 2.
 * Returns null when there is no room number — the floor is never guessed.
 */
export function parseRoom(location = "") {
  const match = String(location).match(/\b([A-Z])\s?-\s?(\d{3,4})\b/i);
  if (match) {
    const number = Number(match[2]);
    return { room: `${match[1].toUpperCase()}-${match[2]}`, block: match[1].toUpperCase(), floor: Math.floor(number / 100) };
  }
  const floor = String(location).match(/\b(?:floor\s*(\d{1,2})|(\d{1,2})(?:st|nd|rd|th)\s*floor)\b/i);
  if (floor) return { room: null, block: null, floor: Number(floor[1] || floor[2]) };
  return null;
}

// ---------------------------------------------------------------------------
// Daily series and trends (feature 2)
// ---------------------------------------------------------------------------

/**
 * Buckets rows into one value per local day. `agg` is "count" or "mean"; a day
 * with no rows is 0 for a count and null (unknown, not zero) for a mean.
 */
export function dailySeries(rows, { dateOf, valueFn = () => 1, agg = "count", days = 14, now = new Date() }) {
  const keys = dayRange(days, now);
  const buckets = new Map(keys.map((k) => [k, []]));
  for (const row of rows) {
    const key = dayKey(dateOf(row));
    if (!buckets.has(key)) continue;
    const value = valueFn(row);
    if (value === null || value === undefined || Number.isNaN(value)) continue;
    buckets.get(key).push(value);
  }
  return keys.map((date) => {
    const values = buckets.get(date);
    if (agg === "count") return { date, value: values.length, n: values.length };
    return { date, value: values.length ? round(mean(values), 2) : null, n: values.length };
  });
}

/**
 * The shape of a series over its last two weeks.
 *
 *   recent / prior   means of the last 7 and the 7 before (days with data only)
 *   changePct        recent vs prior
 *   consecutive      how many days in a row, ending at the latest day with
 *                    data, the value moved in the harmful direction
 *
 * The tier is a rule, stated in `rule`, not a model output.
 */
export function analyseTrend(series, { higherIsWorse = true, minPoints = 4, minPriorMean = 0 } = {}) {
  const half = Math.floor(series.length / 2);
  const prior = series.slice(0, half).filter((p) => p.value !== null);
  const recent = series.slice(half).filter((p) => p.value !== null);

  if (prior.length < minPoints || recent.length < minPoints) {
    return {
      status: "INSUFFICIENT DATA",
      tier: "NORMAL",
      sufficient: false,
      reason: `Needs at least ${minPoints} days with data in each week; has ${prior.length} and ${recent.length}.`
    };
  }

  const priorMean = mean(prior.map((p) => p.value));
  const recentMean = mean(recent.map((p) => p.value));
  const changePct = priorMean > minPriorMean ? round(((recentMean - priorMean) / priorMean) * 100, 1) : null;
  const harmful = changePct === null ? recentMean - priorMean : higherIsWorse ? changePct : -changePct;

  const withData = series.filter((p) => p.value !== null);
  let consecutive = 0;
  for (let i = withData.length - 1; i > 0; i -= 1) {
    const step = withData[i].value - withData[i - 1].value;
    const worse = higherIsWorse ? step > 0 : step < 0;
    if (!worse) break;
    consecutive += 1;
  }

  const worsening = harmful > 0;
  const size = Math.abs(changePct ?? 0);
  let tier = "NORMAL";
  if (worsening && ((size >= 50 && consecutive >= 3) || size >= 100)) tier = "CRITICAL";
  else if (worsening && (size >= 30 || (size >= 15 && consecutive >= 3))) tier = "WARNING";
  else if (worsening && (size >= 15 || consecutive >= 3)) tier = "WATCH";

  const direction = changePct === null
    ? recentMean > priorMean ? "RISING" : recentMean < priorMean ? "FALLING" : "STABLE"
    : changePct > 2 ? "RISING" : changePct < -2 ? "FALLING" : "STABLE";

  return {
    status: direction,
    tier,
    sufficient: true,
    worsening,
    priorMean: round(priorMean, 2),
    recentMean: round(recentMean, 2),
    changePct,
    consecutive,
    daysWithData: withData.length,
    rule:
      "CRITICAL: worsened ≥50% with 3+ consecutive worse days, or ≥100%. WARNING: ≥30%, or ≥15% with 3+ consecutive. " +
      "WATCH: ≥15% or 3+ consecutive worse days. Last 7 days compared with the 7 before."
  };
}

/** What moved most between two windows, by some grouping key. Pure. */
export function contributors(rows, { dateOf, keyOf, now = new Date(), windowDays = 7 }) {
  const cut = new Date(now).getTime() - windowDays * DAY;
  const floor = cut - windowDays * DAY;
  const counts = new Map();
  for (const row of rows) {
    const t = new Date(dateOf(row)).getTime();
    if (t < floor) continue;
    const key = keyOf(row);
    if (!key) continue;
    const entry = counts.get(key) || { key, recent: 0, prior: 0 };
    if (t >= cut) entry.recent += 1;
    else entry.prior += 1;
    counts.set(key, entry);
  }
  return [...counts.values()]
    .map((e) => ({ ...e, delta: e.recent - e.prior }))
    .sort((a, b) => b.delta - a.delta || b.recent - a.recent);
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

const SIGNAL_META = {
  complaints: { label: "Complaint volume", unit: "complaints/day", higherIsWorse: true, module: "COMPLAINTS" },
  maintenance: { label: "Maintenance complaints", unit: "complaints/day", higherIsWorse: true, module: "MAINTENANCE" },
  messRating: { label: "Mess rating", unit: "avg rating /5", higherIsWorse: false, module: "MESS" },
  messWaste: { label: "Mess food wastage", unit: "% wasted", higherIsWorse: true, module: "MESS" },
  attendance: { label: "Class attendance", unit: "% present", higherIsWorse: false, module: "ATTENDANCE" },
  gatePass: { label: "Gate-pass requests", unit: "requests/day", higherIsWorse: true, module: "GATE PASS" },
  resolution: { label: "Complaint resolution time", unit: "hours", higherIsWorse: true, module: "COMPLAINTS" }
};
export const SIGNALS = Object.keys(SIGNAL_META);
// Fewest records in the 14-day window before a signal's trend is reported.
export const MIN_RECORDS = 5;

/** Builds every signal's series and trend from pre-loaded rows. Pure. */
export function buildSignals(data, { now = new Date(), days = 14 } = {}) {
  const { complaints = [], feedback = [], mess = [], sessions = [], gatePasses = [] } = data;
  const series = {
    complaints: dailySeries(complaints, { dateOf: (r) => r.createdAt, days, now }),
    maintenance: dailySeries(complaints.filter((r) => MAINTENANCE.includes(r.category)), { dateOf: (r) => r.createdAt, days, now }),
    messRating: dailySeries(feedback, { dateOf: (r) => r.date, valueFn: (r) => r.rating, agg: "mean", days, now }),
    messWaste: dailySeries(mess, { dateOf: (r) => r.date, valueFn: (r) => r.waste, agg: "mean", days, now }),
    attendance: dailySeries(sessions, { dateOf: (r) => r.date, valueFn: (r) => (r.attended ? 100 : 0), agg: "mean", days, now }),
    gatePass: dailySeries(gatePasses, { dateOf: (r) => r.createdAt, days, now }),
    resolution: dailySeries(
      complaints.filter((r) => r.resolution?.resolvedAt && r.resolution?.resolutionTimeHours !== undefined),
      { dateOf: (r) => r.resolution.resolvedAt, valueFn: (r) => r.resolution.resolutionTimeHours, agg: "mean", days, now }
    )
  };

  return SIGNALS.map((key) => {
    const meta = SIGNAL_META[key];
    // A count signal where almost nothing happened is "no data", not "stable"
    // and not "rising": one gate pass after a quiet week is not a trend.
    const total = series[key].reduce((t, p) => t + (p.n || 0), 0);
    const trend = total < MIN_RECORDS
      ? {
          status: "INSUFFICIENT DATA",
          tier: "NORMAL",
          sufficient: false,
          reason: total ? `Only ${total} record${total === 1 ? "" : "s"} in the last 14 days — at least ${MIN_RECORDS} are needed to call a trend.` : "No records in the last 14 days."
        }
      : analyseTrend(series[key], { higherIsWorse: meta.higherIsWorse, minPoints: key === "resolution" ? 3 : 4 });
    return { key, ...meta, series: series[key], records: total, trend };
  });
}

/**
 * The evidence behind one signal: what changed, what moved with it, and a
 * possible explanation where the records support one. Says INSUFFICIENT when
 * they do not.
 */
export function explainSignal(signal, data, allSignals = [], { now = new Date() } = {}) {
  const t = signal.trend;
  const facts = [];
  const hypotheses = [];
  const actions = [];

  if (!t.sufficient) {
    return {
      key: signal.key,
      headline: `${signal.label}: ${INSUFFICIENT}`,
      facts: [{ kind: KINDS.DATA, text: t.reason }],
      hypotheses: [],
      actions: [],
      cause: INSUFFICIENT,
      sufficient: false
    };
  }

  const unit = signal.unit;
  facts.push({
    kind: KINDS.DATA,
    text: `Last 7 days averaged ${t.recentMean} ${unit} against ${t.priorMean} the week before${t.changePct === null ? "" : ` (${t.changePct > 0 ? "+" : ""}${t.changePct}%)`}.`
  });
  if (t.consecutive >= 2) {
    facts.push({ kind: KINDS.PATTERN, text: `Worsened ${t.consecutive} days in a row up to the latest day with data.` });
  }

  const complaints = data.complaints || [];
  if (signal.key === "complaints" || signal.key === "maintenance") {
    const scope = signal.key === "maintenance" ? complaints.filter((r) => MAINTENANCE.includes(r.category)) : complaints;
    const byCat = contributors(scope, { dateOf: (r) => r.createdAt, keyOf: (r) => r.category, now });
    const byBuilding = contributors(scope, { dateOf: (r) => r.createdAt, keyOf: (r) => r.building?.name, now });
    if (byCat[0]?.delta > 0) facts.push({ kind: KINDS.DATA, text: `${byCat[0].key} rose most: ${byCat[0].prior} → ${byCat[0].recent} complaints week on week.` });
    if (byBuilding[0]?.delta > 0) facts.push({ kind: KINDS.DATA, text: `${byBuilding[0].key} contributed the largest increase: ${byBuilding[0].prior} → ${byBuilding[0].recent}.` });
    if (byCat[0]?.delta > 0 && byBuilding[0]?.delta > 0) {
      hypotheses.push(`The rise is concentrated in ${byCat[0].key} complaints at ${byBuilding[0].key}; a single underlying fault there would explain more of it than a campus-wide change.`);
      actions.push(`Inspect ${byBuilding[0].key} for the ${byCat[0].key} issue and route to ${departmentFor(byCat[0].key)}.`);
    }
  }

  if (signal.key === "messRating" || signal.key === "messWaste") {
    const cut = new Date(now).getTime() - 7 * DAY;
    const recentNegative = (data.feedback || []).filter((r) => new Date(r.date).getTime() >= cut && r.sentiment === "NEGATIVE");
    const themes = new Map();
    for (const row of recentNegative) for (const th of row.themes || []) themes.set(th, (themes.get(th) || 0) + 1);
    const top = [...themes.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) {
      facts.push({ kind: KINDS.DATA, text: `${recentNegative.length} negative feedback entries this week; the most common theme is ${top[0]} (${top[1]}).` });
      hypotheses.push(`Students' own comments point to ${top[0].toLowerCase()} as the main complaint this week.`);
      actions.push(`Review ${top[0].toLowerCase()} with the mess contractor and check next week's rating.`);
    }
    if (signal.key === "messWaste") {
      const byMeal = new Map();
      for (const r of data.mess || []) {
        const recent = new Date(r.date).getTime() >= cut;
        const e = byMeal.get(r.meal) || { recent: [], prior: [] };
        (recent ? e.recent : e.prior).push(r.waste);
        byMeal.set(r.meal, e);
      }
      const moved = [...byMeal.entries()]
        .filter(([, e]) => e.recent.length && e.prior.length)
        .map(([meal, e]) => ({ meal, delta: round(mean(e.recent) - mean(e.prior), 1) }))
        .sort((a, b) => b.delta - a.delta)[0];
      if (moved && moved.delta > 0) {
        facts.push({ kind: KINDS.DATA, text: `${moved.meal} wastage moved the most: +${moved.delta} percentage points.` });
        actions.push(`Reduce ${moved.meal.toLowerCase()} preparation toward the predicted demand.`);
      }
    }
  }

  if (signal.key === "attendance") {
    const cut = new Date(now).getTime() - 7 * DAY;
    const bySubject = new Map();
    for (const s of data.sessions || []) {
      const e = bySubject.get(s.subject) || { recent: [], prior: [] };
      (new Date(s.date).getTime() >= cut ? e.recent : e.prior).push(s.attended ? 100 : 0);
      bySubject.set(s.subject, e);
    }
    const drop = [...bySubject.entries()]
      .filter(([, e]) => e.recent.length >= 3 && e.prior.length >= 3)
      .map(([subject, e]) => ({ subject, delta: round(mean(e.recent) - mean(e.prior), 1) }))
      .sort((a, b) => a.delta - b.delta)[0];
    if (drop && drop.delta < 0) {
      facts.push({ kind: KINDS.DATA, text: `${drop.subject} fell the most: ${drop.delta} percentage points week on week.` });
      actions.push(`Check the ${drop.subject} timetable and message students trending below 75%.`);
    }
    const maint = allSignals.find((s) => s.key === "maintenance");
    if (maint?.trend?.worsening && maint.trend.tier !== "NORMAL" && t.worsening) {
      hypotheses.push("Maintenance complaints rose in the same fortnight. The two moving together is a co-occurrence, not a proven cause.");
    }
  }

  if (signal.key === "resolution") {
    const cut = new Date(now).getTime() - 7 * DAY;
    const byDept = new Map();
    for (const r of complaints) {
      if (!r.resolution?.resolvedAt) continue;
      const e = byDept.get(r.department || "UNASSIGNED") || { recent: [], prior: [] };
      (new Date(r.resolution.resolvedAt).getTime() >= cut ? e.recent : e.prior).push(r.resolution.resolutionTimeHours);
      byDept.set(r.department || "UNASSIGNED", e);
    }
    const slower = [...byDept.entries()]
      .filter(([, e]) => e.recent.length && e.prior.length)
      .map(([dept, e]) => ({ dept, delta: round(mean(e.recent) - mean(e.prior), 1) }))
      .sort((a, b) => b.delta - a.delta)[0];
    if (slower && slower.delta > 0) {
      facts.push({ kind: KINDS.DATA, text: `${slower.dept} slowed the most: +${slower.delta} hours per resolution.` });
      actions.push(`Rebalance the ${slower.dept} queue or add a shift.`);
    }
  }

  // Other worsening signals in the same window, offered as co-occurrence only.
  const alongside = allSignals.filter((s) => s.key !== signal.key && s.trend?.worsening && s.trend.tier !== "NORMAL").map((s) => s.label);
  if (alongside.length && t.worsening) {
    facts.push({ kind: KINDS.PATTERN, text: `Also worsening in the same fortnight: ${alongside.join(", ")}.` });
  }

  if (!actions.length && t.worsening && t.tier !== "NORMAL") actions.push(`Review ${signal.label.toLowerCase()} with the owning team before it reaches the next tier.`);

  // Below the watch threshold a change is ordinary week-to-week movement; say
  // so rather than dressing it up with a cause.
  const small = t.tier === "NORMAL";
  const cause = !t.worsening
    ? "No harmful change to explain."
    : small
      ? hypotheses[0] ? `Small change, below the watch threshold. ${hypotheses[0]}` : "Within normal week-to-week variation — nothing to explain yet."
      : hypotheses[0] || INSUFFICIENT;
  const verb = t.status === "RISING" ? "rose" : t.status === "FALLING" ? "fell" : "held steady";
  return {
    key: signal.key,
    headline: `${signal.label} ${verb}${t.changePct === null ? "" : ` ${Math.abs(t.changePct)}%`} week on week.`,
    facts,
    hypotheses: hypotheses.map((text) => ({ kind: KINDS.HYPOTHESIS, text })),
    actions: actions.map((text) => ({ kind: KINDS.ACTION, text })),
    cause,
    sufficient: true
  };
}

// ---------------------------------------------------------------------------
// Recurring issue intelligence (feature 1)
// ---------------------------------------------------------------------------

const PRIORITY_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
const RANK_PRIORITY = ["", "LOW", "MEDIUM", "HIGH", "CRITICAL"];

// Candidate explanations by category and spread. Offered as hypotheses only,
// and only when the spread supports them.
const FLOOR_HYPOTHESIS = {
  WATER: "a shared supply line, riser or storage tank serving that floor",
  ELECTRICITY: "a shared distribution board or circuit on that floor",
  "WI-FI": "an access point or switch serving that floor",
  CLEANLINESS: "a gap in the housekeeping roster for that floor"
};
const BUILDING_HYPOTHESIS = {
  WATER: "the building's main supply, pump or tank",
  ELECTRICITY: "the building's incoming supply or main panel",
  "WI-FI": "the building's uplink or core switch",
  CLEANLINESS: "the building's housekeeping schedule",
  MESS: "a menu, supplier or service-time change at the mess"
};

/** Adds rooms, floors, trend, severity, memory, cause and action to one pattern. Pure. */
export function enrichPattern(pattern, rows, memories = [], { now = new Date() } = {}) {
  // A room number only locates the fault inside a hostel. Anywhere else the
  // location carries the reporter's own room, which says nothing about where
  // the problem is, so it is not used.
  const inHostel = rows.some((r) => r.building?.type === "HOSTEL");
  const parsed = rows.map((r) => ({ row: r, where: inHostel ? parseRoom(r.location) : null }));
  const rooms = [...new Set(parsed.map((p) => p.where?.room).filter(Boolean))];
  const floorCounts = new Map();
  for (const p of parsed) if (p.where?.floor !== undefined && p.where?.floor !== null) floorCounts.set(p.where.floor, (floorCounts.get(p.where.floor) || 0) + 1);
  const floors = [...floorCounts.entries()].sort((a, b) => b[1] - a[1]).map(([floor, count]) => ({ floor, count }));
  const located = parsed.filter((p) => p.where?.floor !== undefined && p.where?.floor !== null).length;
  const topFloor = floors[0];
  const floorShare = topFloor && located ? topFloor.count / located : 0;
  const scope = topFloor && topFloor.count >= 3 && floorShare >= 0.6 ? "FLOOR" : "BUILDING";

  const cut = new Date(now).getTime() - 7 * DAY;
  const recent = rows.filter((r) => new Date(r.createdAt).getTime() >= cut).length;
  const prior = rows.filter((r) => {
    const t = new Date(r.createdAt).getTime();
    return t < cut && t >= cut - 7 * DAY;
  }).length;
  const trend = recent > prior ? "INCREASING" : recent < prior ? "DECREASING" : "STEADY";

  const maxRank = Math.max(1, ...rows.map((r) => PRIORITY_RANK[r.priority] || 2));
  // The highest priority any of these complaints was classified at.
  const severity = RANK_PRIORITY[maxRank];

  const previous = memories.map((m) => ({
    reference: m.incidentReference,
    occurredOn: m.occurredOn,
    cause: m.cause,
    resolution: m.resolution,
    resolutionTimeHours: m.resolutionTimeHours
  }));

  // Possible cause: campus memory first (it is what actually happened last
  // time), then the category rule if the spread supports it, else say so.
  let cause = INSUFFICIENT;
  let causeBasis = "No previous incident with a recorded cause, and the spread does not narrow it to a shared asset.";
  if (previous[0]?.cause) {
    cause = `Possibly a repeat of the last incident here (${dayKey(previous[0].occurredOn)}): ${previous[0].cause}.`;
    causeBasis = `Campus memory — ${previous.length} earlier ${pattern.category} incident${previous.length === 1 ? "" : "s"} in ${pattern.building.name} with a recorded cause; the most recent is shown. A match in history is a lead, not a diagnosis.`;
  } else if (scope === "FLOOR" && FLOOR_HYPOTHESIS[pattern.category]) {
    cause = `Possibly ${FLOOR_HYPOTHESIS[pattern.category]} (Floor ${topFloor.floor}).`;
    causeBasis = `${topFloor.count} of ${located} located complaints are on Floor ${topFloor.floor}; a shared asset on that floor fits the spread.`;
  } else if (rooms.length >= 3 && BUILDING_HYPOTHESIS[pattern.category]) {
    cause = `Possibly ${BUILDING_HYPOTHESIS[pattern.category]}.`;
    causeBasis = `${rooms.length} different rooms report it, which points past any one room.`;
  }

  // Confidence that this is one recurring problem (not in the cause).
  const factors = [
    { label: "occurrences", points: Math.min(30, pattern.occurrences * 5) },
    { label: "distinct days", points: Math.min(20, pattern.distinctDays * 4) },
    { label: "wording overlap", points: Math.min(20, Math.round(pattern.textSimilarity / 3)) },
    { label: "same-floor concentration", points: scope === "FLOOR" ? 15 : Math.round(floorShare * 10) },
    { label: "matches campus memory", points: previous.length ? 15 : 0 }
  ];
  const confidence = Math.min(95, factors.reduce((t, f) => t + f.points, 0));

  const dept = departmentFor(pattern.category);
  const where = scope === "FLOOR" ? `Floor ${topFloor.floor} of ${pattern.building.name}` : pattern.building.name;
  const recommendation = `Assign ${dept} to inspect ${where}${pattern.unresolved ? ` and close the ${pattern.unresolved} open complaint${pattern.unresolved === 1 ? "" : "s"} together` : ""}.`;

  return {
    key: pattern.key,
    rooms,
    floors,
    scope,
    location: scope === "FLOOR" ? `${pattern.building.name} · Floor ${topFloor.floor}` : pattern.building.name,
    trend: { direction: trend, last7: recent, prior7: prior },
    severity,
    previousIncidents: previous,
    cause,
    causeBasis,
    causeKind: cause === INSUFFICIENT ? KINDS.DATA : KINDS.HYPOTHESIS,
    confidence,
    confidenceFactors: factors,
    confidenceBasis: "Confidence that these complaints are one recurring problem — not confidence in the cause.",
    recommendation,
    department: dept,
    related: rows
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .map((r) => ({
        id: String(r._id),
        reference: r.reference,
        title: r.title,
        status: r.status,
        priority: r.priority,
        room: parseRoom(r.location)?.room || null,
        createdAt: r.createdAt
      })),
    headline: rooms.length
      ? `${pattern.occurrences} ${pattern.category} complaints from ${rooms.length} room${rooms.length === 1 ? "" : "s"}${scope === "FLOOR" ? ` on Floor ${topFloor.floor}` : ""} of ${pattern.building.name} in ${pattern.periodDays} days.`
      : `${pattern.occurrences} ${pattern.category} complaints at ${pattern.building.name} in ${pattern.periodDays} days.`
  };
}

// ---------------------------------------------------------------------------
// Campus Pulse (feature 8)
// ---------------------------------------------------------------------------

/**
 * A prototype operational indicator. Each component is 0–100 with its formula
 * shown; a component without data is left out and the weights are rescaled,
 * and the response says which were left out. Pure.
 */
export function campusPulse({ attendanceMean, hostelRisks = [], messRatingMean, sla, throughput }) {
  const components = [
    {
      key: "attendance",
      label: "Attendance",
      weight: 25,
      value: attendanceMean === null || attendanceMean === undefined ? null : round(attendanceMean, 1),
      formula: "Mean attendance percentage across every student's subject records.",
      inputs: attendanceMean === null || attendanceMean === undefined ? "No attendance records." : `${round(attendanceMean, 1)}% mean attendance`
    },
    {
      key: "hostel",
      label: "Hostel condition",
      weight: 20,
      value: hostelRisks.length ? round(100 - mean(hostelRisks), 1) : null,
      formula: "100 − the mean current risk score of hostel buildings.",
      inputs: hostelRisks.length ? `${hostelRisks.length} hostels, mean risk ${round(mean(hostelRisks), 1)}` : "No hostel buildings."
    },
    {
      key: "mess",
      label: "Mess satisfaction",
      weight: 20,
      value: messRatingMean === null || messRatingMean === undefined ? null : round(((messRatingMean - 1) / 4) * 100, 1),
      formula: "Mean mess rating in the last 7 days, scaled from 1–5 to 0–100.",
      inputs: messRatingMean === null || messRatingMean === undefined ? "No mess feedback in 7 days." : `mean rating ${round(messRatingMean, 2)}/5`
    },
    {
      key: "resolution",
      label: "Complaint resolution",
      weight: 20,
      value: sla && sla.decided ? round((sla.within / sla.decided) * 100, 1) : null,
      formula: "Share of complaints resolved inside their SLA, counting open complaints already past SLA as misses (last 30 days).",
      inputs: sla && sla.decided ? `${sla.within} of ${sla.decided} within SLA` : "No complaint has reached an SLA outcome yet."
    },
    {
      key: "workload",
      label: "Team workload",
      weight: 15,
      value: throughput && throughput.created ? round(Math.min(1, throughput.resolved / throughput.created) * 100, 1) : null,
      formula: "Complaints resolved ÷ complaints filed in the last 14 days, capped at 100 — is the team keeping up?",
      inputs: throughput && throughput.created ? `${throughput.resolved} resolved vs ${throughput.created} filed` : "No complaints filed in 14 days."
    }
  ];

  const used = components.filter((c) => c.value !== null);
  const weightTotal = used.reduce((t, c) => t + c.weight, 0);
  if (!used.length) {
    return { score: null, band: "INSUFFICIENT DATA", components, missing: components.map((c) => c.label), note: INSUFFICIENT };
  }
  const score = Math.round(used.reduce((t, c) => t + c.value * c.weight, 0) / weightTotal);
  const band = score >= 80 ? "HEALTHY" : score >= 60 ? "STABLE · WATCH ITEMS" : score >= 40 ? "STRAINED" : "CRITICAL";
  const weakest = used.slice().sort((a, b) => a.value - b.value)[0];
  return {
    score,
    band,
    components: components.map((c) => ({
      ...c,
      effectiveWeight: c.value === null ? 0 : round((c.weight / weightTotal) * 100, 1),
      contribution: c.value === null ? null : round((c.value * c.weight) / weightTotal, 1)
    })),
    missing: components.filter((c) => c.value === null).map((c) => c.label),
    weakest: weakest.label,
    formula: `Weighted mean of ${used.length} components (${used.map((c) => `${c.label} ${c.weight}`).join(", ")}), rescaled to the components with data.`,
    label: "PROTOTYPE OPERATIONAL INDICATOR",
    disclaimer: "A transparent summary of the numbers below, not a validated index. Change a weight and the score changes; the components are the real signal."
  };
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

export async function loadWindow({ days = 30, now = new Date() } = {}) {
  const since = new Date(new Date(now).getTime() - days * DAY);
  const [complaints, feedback, mess, attendance, gatePasses] = await Promise.all([
    Complaint.find({ $or: [{ createdAt: { $gte: since } }, { "resolution.resolvedAt": { $gte: since } }] })
      .populate("building", "code name type")
      .select("reference title description category priority status department location building createdAt resolution aiClassification.slaHours")
      .lean(),
    MessFeedback.find({ date: { $gte: since } }).select("date meal rating sentiment themes").lean(),
    MessRecord.find({ date: { $gte: since } }).select("date meal waste demand crowd capacity").lean(),
    Attendance.find().select("student subject sessions attendancePercentage totalClasses attendedClasses semesterPlanned").lean(),
    GatePass.find({ createdAt: { $gte: since } }).select("createdAt status").lean()
  ]);

  const sessions = [];
  for (const record of attendance) {
    for (const s of record.sessions || []) {
      if (new Date(s.date) < since) continue;
      const status = s.status || (s.present ? "PRESENT" : "ABSENT");
      sessions.push({ date: s.date, subject: record.subject, student: String(record.student), attended: status === "PRESENT" || status === "LATE" });
    }
  }
  return { complaints, feedback, mess, attendance, sessions, gatePasses };
}

async function alertStates() {
  const rows = await AlertState.find().lean();
  return new Map(rows.map((r) => [r.key, r]));
}

function withState(alert, states) {
  const state = states.get(alert.key);
  if (!state) return { ...alert, state: { status: "OPEN" } };
  // An alert that was resolved but has since got worse reopens on its own.
  const reopened = state.status === "RESOLVED" && state.tierAtAction && TIERS.indexOf(alert.tier) < TIERS.indexOf(state.tierAtAction);
  return {
    ...alert,
    state: {
      status: reopened ? "REOPENED" : state.status,
      department: state.department,
      by: state.byName,
      at: state.updatedAt,
      note: state.note
    }
  };
}

// CRITICAL: classified CRITICAL with 5+ still open, or 8+ open regardless.
// WARNING: 3+ open, a HIGH/CRITICAL classification, or rising week on week.
export const RECURRING_TIER_RULE =
  "CRITICAL: highest priority CRITICAL with 5+ open, or 8+ open. WARNING: 3+ open, HIGH/CRITICAL priority, or more reports this week than last. Otherwise WATCH.";
export function tierFromRecurring(enriched, pattern) {
  if ((enriched.severity === "CRITICAL" && pattern.unresolved >= 5) || pattern.unresolved >= 8) return "CRITICAL";
  if (pattern.unresolved >= 3 || ["HIGH", "CRITICAL"].includes(enriched.severity) || enriched.trend.direction === "INCREASING") return "WARNING";
  return "WATCH";
}

/** Everything Mission Control's early-warning layer shows, in one read. */
export async function earlyWarning({ now = new Date() } = {}) {
  const data = await loadWindow({ days: 30, now });
  const signals = buildSignals(data, { now });
  const explained = signals.map((s) => ({ ...s, why: explainSignal(s, data, signals, { now }) }));

  const recurring = await findRecurring({ windowDays: 30, limit: 8 });
  const byRef = new Map(data.complaints.map((c) => [c.reference, c]));
  const memoryRows = recurring.patterns.length
    ? await CampusMemory.find({ category: { $in: recurring.patterns.map((p) => p.category) } })
        .populate("building", "code")
        .sort({ occurredOn: -1 })
        .lean()
    : [];
  const recurringIntel = recurring.patterns.map((pattern) => {
    const rows = pattern.references.map((ref) => byRef.get(ref)).filter(Boolean);
    const memories = memoryRows.filter((m) => m.category === pattern.category && m.building?.code === pattern.building.code);
    return { pattern, intel: enrichPattern(pattern, rows, memories, { now }) };
  });

  const states = await alertStates();
  const alerts = [];

  for (const { pattern, intel } of recurringIntel) {
    alerts.push({
      key: `recurring:${pattern.key}`,
      source: "RECURRING ISSUE",
      tier: tierFromRecurring(intel, pattern),
      title: `Recurring ${pattern.category} · ${intel.location}`,
      whatChanged: intel.headline,
      whyDetected: `Recurrence rule: ${pattern.occurrences} complaints on ${pattern.distinctDays} separate days in one building and category (threshold 3 on 2 days); ${pattern.textSimilarity}% wording overlap. Tier: ${RECURRING_TIER_RULE}`,
      affected: intel.rooms.length
        ? `${intel.rooms.length} room${intel.rooms.length === 1 ? "" : "s"} (${intel.rooms.slice(0, 6).join(", ")}${intel.rooms.length > 6 ? "…" : ""}) in ${pattern.building.name}; ${pattern.unresolved} complaint${pattern.unresolved === 1 ? "" : "s"} open`
        : `${pattern.occurrences} reporters at ${pattern.building.name}; ${pattern.unresolved} complaint${pattern.unresolved === 1 ? "" : "s"} open`,
      cause: intel.cause,
      causeKind: intel.causeKind,
      confidence: intel.confidence,
      confidenceBasis: intel.confidenceBasis,
      action: intel.recommendation,
      department: intel.department,
      complaintIds: intel.related.filter((r) => r.status !== "RESOLVED").map((r) => r.id),
      chart: {
        labels: signals[0].series.map((p) => p.date.slice(5)),
        values: dailySeries(pattern.references.map((ref) => byRef.get(ref)).filter(Boolean), { dateOf: (r) => r.createdAt, now }).map((p) => p.value),
        unit: "complaints/day"
      },
      patternKey: pattern.key
    });
  }

  for (const s of explained) {
    if (!s.trend.sufficient || s.trend.tier === "NORMAL") continue;
    alerts.push({
      key: `trend:${s.key}`,
      source: "EARLY WARNING",
      tier: s.trend.tier,
      title: `${s.label} ${s.trend.status === "RISING" ? "rising" : s.trend.status === "FALLING" ? "falling" : "changing"}`,
      whatChanged: s.why.facts[0]?.text || s.why.headline,
      whyDetected: `${s.trend.changePct === null ? "" : `${s.trend.changePct > 0 ? "+" : ""}${s.trend.changePct}% week on week`}${s.trend.consecutive ? `, ${s.trend.consecutive} consecutive worse day${s.trend.consecutive === 1 ? "" : "s"}` : ""}. ${s.trend.rule}`,
      affected: s.module === "ATTENDANCE" ? "Students in the affected subjects" : s.module === "MESS" ? "Everyone eating at the central mess" : "Students filing in the affected area",
      cause: s.why.cause,
      causeKind: s.why.hypotheses.length ? KINDS.HYPOTHESIS : KINDS.DATA,
      confidence: Math.min(90, 40 + s.trend.daysWithData * 2 + Math.min(20, s.trend.consecutive * 5)),
      confidenceBasis: "Confidence that the change is real (days with data and run length), not confidence in any cause.",
      action: s.why.actions[0]?.text || `Review ${s.label.toLowerCase()}.`,
      department: null,
      complaintIds: [],
      chart: { labels: s.series.map((p) => p.date.slice(5)), values: s.series.map((p) => p.value), unit: s.unit },
      signalKey: s.key
    });
  }

  const sla = await slaForecast({ limit: 50 });
  const breached = sla.rows.filter((r) => r.risk === "BREACHED");
  if (breached.length) {
    alerts.push({
      key: "sla:breached",
      source: "SLA",
      tier: breached.length >= 5 ? "CRITICAL" : "WARNING",
      title: `${breached.length} complaint${breached.length === 1 ? "" : "s"} past SLA`,
      whatChanged: `${breached.map((r) => r.reference).slice(0, 6).join(", ")}${breached.length > 6 ? "…" : ""} have run past their SLA clock.`,
      whyDetected: "Measured: age in hours exceeds the SLA set at classification (or the priority policy default).",
      affected: `${breached.length} students waiting on an overdue fix`,
      cause: INSUFFICIENT,
      causeKind: KINDS.DATA,
      confidence: null,
      confidenceBasis: "Measured, not estimated.",
      action: "Escalate the overdue complaints to their department heads.",
      department: null,
      complaintIds: breached.map((r) => r.id),
      chart: null
    });
  }

  const ordered = alerts
    .map((a) => withState(a, states))
    .sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier));

  const counts = TIERS.reduce((acc, t) => ({ ...acc, [t]: ordered.filter((a) => a.tier === t && a.state.status !== "RESOLVED").length }), {});
  counts.NORMAL = explained.filter((s) => s.trend.sufficient && s.trend.tier === "NORMAL").length;

  return {
    generatedAt: new Date(),
    counts,
    alerts: ordered,
    signals: explained.map((s) => ({
      key: s.key,
      label: s.label,
      unit: s.unit,
      module: s.module,
      records: s.records,
      series: s.series,
      trend: s.trend,
      why: s.why
    })),
    recurring: recurringIntel.map(({ intel }) => intel),
    method: "RULE_BASED_TREND_ANALYSIS",
    kinds: KINDS,
    disclaimer:
      "Tiers come from fixed, stated rules over stored records. Causes are hypotheses unless they come from a recorded previous incident; where the data cannot support one, the cause reads “Insufficient data to determine the cause.”"
  };
}

/** Predictive insights: each with the data used, horizon, confidence and action. */
export async function predictiveInsights({ now = new Date() } = {}) {
  const insights = [];

  // 1 · complaint volume tomorrow — the existing forecast, restated.
  const volume = await predictComplaintVolume({ days: 30 });
  insights.push(
    volume.available
      ? {
          key: "complaint-volume",
          title: "Complaint volume tomorrow",
          prediction: `About ${volume.forecast.expected} complaints (range ${volume.forecast.range.low}–${volume.forecast.range.high}); trend ${volume.forecast.trend}.`,
          dataUsed: `${volume.series.reduce((t, p) => t + p.count, 0)} complaints over the last ${volume.windowDays} days, as a daily series (${volume.forecast.basis.sameWeekdayObservations} same-weekday observations).`,
          horizon: "Next 24 hours",
          confidence: volume.forecast.intervalConfidence ?? null,
          action: volume.leadingCategory ? `Keep ${departmentFor(volume.leadingCategory.category)} staffed — ${volume.leadingCategory.category} is ${volume.leadingCategory.sharePct}% of recent volume.` : "Keep the usual staffing.",
          sufficient: true
        }
      : {
          key: "complaint-volume",
          title: "Complaint volume tomorrow",
          prediction: INSUFFICIENT_PREDICTION,
          dataUsed: (volume.sufficiency?.reasons || []).join(" ") || "Too few days with complaints.",
          horizon: "Next 24 hours",
          confidence: null,
          action: null,
          sufficient: false
        }
  );

  // 2 · mess demand tomorrow, per meal — the mess model, not a new one.
  const { days } = await loadMealDays({ days: 28, now });
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  for (const meal of MEAL_ORDER) {
    const p = predictMeal(days, meal, tomorrow);
    if (!p || p.insufficient) {
      insights.push({ key: `mess-${meal}`, title: `${meal} demand tomorrow`, prediction: INSUFFICIENT_PREDICTION, dataUsed: p?.reason || "Fewer than two same-weekday records.", horizon: "Tomorrow", confidence: null, action: null, sufficient: false });
      continue;
    }
    insights.push({
      key: `mess-${meal}`,
      title: `${meal} demand tomorrow`,
      prediction: `About ${p.predicted} meals (${p.low}–${p.high}).`,
      dataUsed: `Up to 4 earlier ${p.weekday.toLowerCase()} ${meal.toLowerCase()} records, weighted by recency, plus the last 7 days' level.`,
      horizon: "Tomorrow",
      confidence: p.confidence ?? null,
      action: `Prepare for about ${p.predicted}; the upper bound ${p.high} covers most days.`,
      sufficient: true
    });
  }

  // 3 · students heading below 75% attendance by semester end.
  const records = await Attendance.find().select("student subject sessions totalClasses attendedClasses semesterPlanned").lean();
  const byStudent = new Map();
  for (const r of records) {
    const e = byStudent.get(String(r.student)) || { attended: 0, total: 0, planned: 0, recentAtt: 0, recentTotal: 0, plannedKnown: true };
    e.attended += r.attendedClasses || 0;
    e.total += r.totalClasses || 0;
    if (r.semesterPlanned) e.planned += r.semesterPlanned;
    else e.plannedKnown = false;
    const cut = new Date(now).getTime() - 14 * DAY;
    for (const s of r.sessions || []) {
      if (new Date(s.date).getTime() < cut) continue;
      const status = s.status || (s.present ? "PRESENT" : "ABSENT");
      e.recentTotal += 1;
      if (status === "PRESENT" || status === "LATE") e.recentAtt += 1;
    }
    byStudent.set(String(r.student), e);
  }
  const projectable = [...byStudent.values()].filter((e) => e.plannedKnown && e.planned > e.total && e.recentTotal >= 5);
  if (projectable.length) {
    const below = projectable.filter((e) => {
      const remaining = e.planned - e.total;
      const projected = (e.attended + remaining * (e.recentAtt / e.recentTotal)) / e.planned;
      return projected < 0.75;
    }).length;
    insights.push({
      key: "attendance-risk",
      title: "Students below 75% by semester end",
      prediction: `${below} of ${projectable.length} students would finish below 75% if their last two weeks continue.`,
      dataUsed: `${projectable.length} students' attendance to date, their last 14 days' rate, and the planned classes left in the semester.`,
      horizon: "End of semester",
      confidence: Math.min(80, 40 + Math.round(projectable.reduce((t, e) => t + e.recentTotal, 0) / projectable.length)),
      action: below ? `Message the ${below} student${below === 1 ? "" : "s"} now, while enough classes remain to recover.` : "No outreach needed on current trends.",
      sufficient: true
    });
  } else {
    insights.push({ key: "attendance-risk", title: "Students below 75% by semester end", prediction: INSUFFICIENT_PREDICTION, dataUsed: "No student has both a planned semester length and 5+ classes in the last 14 days.", horizon: "End of semester", confidence: null, action: null, sufficient: false });
  }

  // 4 · SLA breaches in the next day — the existing SLA forecast.
  const sla = await slaForecast({ limit: 100 });
  const high = sla.rows.filter((r) => r.risk === "HIGH");
  insights.push(
    sla.openExamined
      ? {
          key: "sla-breach",
          title: "Complaints likely to breach SLA",
          prediction: `${high.length} open complaint${high.length === 1 ? "" : "s"} at HIGH risk of breaching; ${sla.counts.BREACHED} already breached.`,
          dataUsed: `${sla.openExamined} open complaints' SLA clocks and ${sla.resolvedHistory} past resolution times.`,
          horizon: "Before each SLA deadline",
          confidence: sla.resolvedHistory >= 5 ? 70 : 45,
          action: high.length ? `Prioritise ${high.slice(0, 3).map((r) => r.reference).join(", ")}.` : "No action needed.",
          sufficient: true
        }
      : { key: "sla-breach", title: "Complaints likely to breach SLA", prediction: INSUFFICIENT_PREDICTION, dataUsed: "No open complaints.", horizon: "—", confidence: null, action: null, sufficient: false }
  );

  // 5 · when each recurring problem is likely to come back.
  const recurring = await findRecurring({ windowDays: 30, limit: 5 });
  const byRef = new Map((await Complaint.find({ reference: { $in: recurring.patterns.flatMap((p) => p.references) } }).select("reference createdAt").lean()).map((c) => [c.reference, c]));
  for (const pattern of recurring.patterns) {
    const times = pattern.references.map((r) => byRef.get(r)?.createdAt).filter(Boolean).map((d) => new Date(d).getTime()).sort((a, b) => a - b);
    const gaps = times.slice(1).map((t, i) => (t - times[i]) / DAY).filter((g) => g > 0.05);
    if (gaps.length < 2) continue;
    const sorted = gaps.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const spread = mean(gaps.map((g) => Math.abs(g - median)));
    const next = new Date(times[times.length - 1] + median * DAY);
    const gapText = `${round(median, 1)} day${round(median, 1) === 1 ? "" : "s"}`;
    const due = next.getTime() <= new Date(now).getTime();
    insights.push({
      key: `recur-${pattern.key}`,
      title: `${pattern.category} at ${pattern.building.name} recurring`,
      prediction: due
        ? `Another report is due now: the typical gap is ${gapText} and the last report was ${round((new Date(now).getTime() - times[times.length - 1]) / DAY, 1)} days ago.`
        : `Next report likely around ${dayKey(next)} (typical gap ${gapText}).`,
      dataUsed: `${times.length} reports of this pattern and the ${gaps.length} gaps between them.`,
      horizon: due ? "Now" : `~${gapText}`,
      confidence: Math.max(30, Math.min(80, Math.round(80 - (spread / Math.max(0.5, median)) * 40))),
      action: due ? "Fix the shared cause now; until then, expect more reports." : `Fix the shared cause before ${dayKey(next)} to break the cycle.`,
      sufficient: true
    });
  }

  return {
    generatedAt: new Date(),
    label: "AI PREDICTION · ESTIMATED · BASED ON RECENT TRENDS",
    insights,
    method: "STATISTICAL_EXTRAPOLATION",
    disclaimer: "Estimates from recent records using the same arithmetic as the rest of the system. They can be wrong; where the records are too thin the insight says so instead of guessing."
  };
}

/** Campus Pulse from live records. */
export async function pulse({ now = new Date() } = {}) {
  const since30 = new Date(new Date(now).getTime() - 30 * DAY);
  const since14 = new Date(new Date(now).getTime() - 14 * DAY);
  const since7 = new Date(new Date(now).getTime() - 7 * DAY);
  const [students, hostels, feedback, complaints] = await Promise.all([
    User.find({ role: "STUDENT" }).select("_id").lean(),
    Building.find({ type: "HOSTEL" }).select("currentRisk").lean(),
    MessFeedback.find({ date: { $gte: since7 } }).select("rating").lean(),
    Complaint.find({ $or: [{ createdAt: { $gte: since30 } }, { "resolution.resolvedAt": { $gte: since30 } }] })
      .select("createdAt status priority resolution aiClassification.slaHours")
      .lean()
  ]);
  const attendance = await Attendance.find({ student: { $in: students.map((s) => s._id) } }).select("attendedClasses totalClasses").lean();
  const attended = attendance.reduce((t, r) => t + (r.attendedClasses || 0), 0);
  const total = attendance.reduce((t, r) => t + (r.totalClasses || 0), 0);

  let within = 0;
  let decided = 0;
  for (const c of complaints) {
    const slaHours = c.aiClassification?.slaHours ?? SLA_BY_PRIORITY[c.priority] ?? SLA_BY_PRIORITY.MEDIUM;
    if (c.status === "RESOLVED" && c.resolution?.resolutionTimeHours !== undefined) {
      decided += 1;
      if (c.resolution.resolutionTimeHours <= slaHours) within += 1;
    } else if (c.status !== "RESOLVED" && (Date.now() - new Date(c.createdAt)) / 36e5 > slaHours) {
      decided += 1;
    }
  }
  const created = complaints.filter((c) => new Date(c.createdAt) >= since14).length;
  const resolved = complaints.filter((c) => c.resolution?.resolvedAt && new Date(c.resolution.resolvedAt) >= since14).length;

  return {
    generatedAt: new Date(),
    ...campusPulse({
      attendanceMean: total ? (attended / total) * 100 : null,
      hostelRisks: hostels.map((h) => h.currentRisk || 0),
      messRatingMean: feedback.length ? mean(feedback.map((f) => f.rating)) : null,
      sla: { within, decided },
      throughput: { created, resolved }
    })
  };
}

/** One WHY? answer for one signal. */
export async function why(metric, { now = new Date() } = {}) {
  const data = await loadWindow({ days: 30, now });
  const signals = buildSignals(data, { now });
  const signal = signals.find((s) => s.key === metric);
  if (!signal) return null;
  return {
    metric,
    label: signal.label,
    unit: signal.unit,
    series: signal.series,
    trend: signal.trend,
    ...explainSignal(signal, data, signals, { now }),
    kinds: KINDS
  };
}
