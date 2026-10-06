import { Anomaly } from "../models/Anomaly.js";
import { Building } from "../models/Building.js";
import { Complaint } from "../models/Complaint.js";
import { GatePass } from "../models/GatePass.js";
import { Incident } from "../models/Incident.js";
import { round, tokenize } from "../utils/text.js";
import { feedbackAnalysis } from "./feedbackService.js";
import { slaForecast } from "./operationsIntelligenceService.js";
import { findRecurring, RECURRENCE_THRESHOLDS } from "./recurrenceService.js";

/**
 * The grounding layer under the admin copilot.
 *
 * Every question is matched to an intent, the intent runs a real aggregation
 * against the database, and the result is returned as three things:
 *
 *   facts    plain sentences containing only counted numbers
 *   records  the rows those numbers came from, for the interface to display
 *   answer   a deterministic sentence, used verbatim when no model is configured
 *
 * The model in aiService.generateAdminAnswer() receives `facts` and nothing
 * else. It has no database access and cannot widen the query, so it cannot
 * invent a statistic that is not in the list — and if it does, the records
 * shown beside the answer contradict it.
 */

const INTENTS = [
  {
    id: "UNRESOLVED_COMPLAINTS",
    keywords: ["unresolved", "pending", "open", "outstanding", "backlog"],
    weight: 2
  },
  { id: "WORST_BUILDING", keywords: ["which", "hostel", "building", "block", "most", "worst", "highest"] },
  { id: "TOP_CATEGORIES", keywords: ["category", "categories", "common", "kind", "type", "month"] },
  { id: "HIGH_PRIORITY", keywords: ["priority", "high", "critical", "urgent", "severe"] },
  { id: "DEPARTMENT_LOAD", keywords: ["department", "workload", "team", "assigned", "pending"] },
  { id: "RECURRING", keywords: ["recurring", "repeat", "repeated", "again", "pattern", "recurrence"] },
  { id: "TODAY_SUMMARY", keywords: ["today", "summarize", "summary", "summarise", "overview", "happening", "brief"] },
  { id: "GATE_PASS", keywords: ["gate", "pass", "gatepass", "overdue", "outside", "returned"] },
  { id: "ANOMALY", keywords: ["anomaly", "unusual", "spike", "abnormal", "strange", "silent"] },
  { id: "SLA_RISK", keywords: ["sla", "breach", "breaching", "deadline", "delayed", "late"], weight: 2 },
  { id: "FEEDBACK", keywords: ["feedback", "rating", "ratings", "satisfaction", "satisfied", "sentiment", "rated"], weight: 2 }
];

/** Scores the question against every intent and returns the best match. */
export function detectIntent(question) {
  const words = new Set(tokenize(question));
  let best = { intent: null, score: 0 };
  for (const intent of INTENTS) {
    const hits = intent.keywords.filter((keyword) => words.has(keyword)).length;
    const score = hits * (intent.weight || 1);
    if (score > best.score) best = { intent, score, hits };
  }
  return {
    intent: best.intent?.id || "UNKNOWN",
    matchedKeywords: best.intent ? best.intent.keywords.filter((keyword) => words.has(keyword)) : [],
    // How well the question matched a known shape — not a model confidence.
    matchStrength: best.score ? Math.min(95, 45 + best.score * 15) : 0
  };
}

const complaintRecord = (row) => ({
  id: String(row._id),
  reference: row.reference,
  title: row.title,
  category: row.category,
  priority: row.priority,
  status: row.status,
  department: row.department,
  building: row.building?.code || null,
  createdAt: row.createdAt
});

async function unresolvedComplaints() {
  const [total, rows, byStatus] = await Promise.all([
    Complaint.countDocuments({ status: { $ne: "RESOLVED" } }),
    Complaint.find({ status: { $ne: "RESOLVED" } })
      .populate("building", "code")
      .sort({ createdAt: -1 })
      .limit(15)
      .lean(),
    Complaint.aggregate([
      { $match: { status: { $ne: "RESOLVED" } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ])
  ]);

  const breakdown = byStatus.map((row) => `${row.count} at ${row._id}`).join(", ");

  return {
    facts: [
      `${total} complaints are not yet resolved.`,
      breakdown ? `By workflow status: ${breakdown}.` : "No unresolved complaints to break down."
    ],
    records: { label: "Unresolved complaints (most recent 15)", rows: rows.map(complaintRecord) },
    answer: total
      ? `There are ${total} unresolved complaints${breakdown ? ` — ${breakdown}` : ""}.`
      : "Every complaint on record is resolved."
  };
}

async function worstBuilding() {
  const rows = await Complaint.aggregate([
    { $match: { building: { $ne: null } } },
    { $group: { _id: "$building", total: { $sum: 1 }, unresolved: { $sum: { $cond: [{ $ne: ["$status", "RESOLVED"] }, 1, 0] } } } },
    { $sort: { total: -1 } },
    { $limit: 8 }
  ]);

  const buildings = await Building.find({ _id: { $in: rows.map((row) => row._id) } })
    .select("code name currentRisk")
    .lean();
  const byId = new Map(buildings.map((building) => [String(building._id), building]));

  const ranked = rows.map((row) => {
    const building = byId.get(String(row._id));
    return {
      code: building?.code || "UNKNOWN",
      name: building?.name || "Unknown building",
      risk: building?.currentRisk ?? null,
      complaints: row.total,
      unresolved: row.unresolved
    };
  });

  const lead = ranked[0];

  return {
    facts: ranked.length
      ? [
          `Complaint totals by building: ${ranked.map((row) => `${row.name} ${row.complaints}`).join(", ")}.`,
          lead ? `${lead.name} leads with ${lead.complaints} complaints, ${lead.unresolved} of them unresolved.` : ""
        ].filter(Boolean)
      : ["No complaints are associated with a building."],
    records: { label: "Complaints by building", rows: ranked },
    answer: lead
      ? `${lead.name} has the most complaints — ${lead.complaints} in total, ${lead.unresolved} still unresolved.`
      : "No complaint on record is linked to a building."
  };
}

async function topCategories() {
  const since = new Date();
  since.setUTCDate(1);
  since.setUTCHours(0, 0, 0, 0);

  const rows = await Complaint.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: "$category", count: { $sum: 1 } } },
    { $sort: { count: -1 } }
  ]);

  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const ranked = rows.map((row) => ({
    category: row._id,
    count: row.count,
    sharePct: total ? round((row.count / total) * 100) : 0
  }));

  return {
    facts: [
      `${total} complaints have been filed since ${since.toISOString().slice(0, 10)}.`,
      ranked.length ? `By category: ${ranked.map((row) => `${row.category} ${row.count} (${row.sharePct}%)`).join(", ")}.` : "No complaints this month."
    ],
    records: { label: `Complaint categories since ${since.toISOString().slice(0, 10)}`, rows: ranked },
    answer: ranked.length
      ? `This month's ${total} complaints are led by ${ranked[0].category} with ${ranked[0].count} (${ranked[0].sharePct}%).`
      : "No complaints have been filed this month."
  };
}

async function highPriority() {
  const filter = { status: { $ne: "RESOLVED" }, priority: { $in: ["HIGH", "CRITICAL"] } };
  const [total, rows] = await Promise.all([
    Complaint.countDocuments(filter),
    Complaint.find(filter).populate("building", "code").sort({ priority: 1, createdAt: -1 }).limit(15).lean()
  ]);

  const critical = rows.filter((row) => row.priority === "CRITICAL").length;

  return {
    facts: [
      `${total} unresolved complaints are at HIGH or CRITICAL priority.`,
      `${critical} of the ${rows.length} most recent of those are CRITICAL.`
    ],
    records: { label: "High and critical unresolved complaints", rows: rows.map(complaintRecord) },
    answer: total
      ? `${total} unresolved complaints sit at HIGH or CRITICAL priority. The most recent are listed below.`
      : "No unresolved complaint is at HIGH or CRITICAL priority."
  };
}

async function departmentLoad() {
  const rows = await Complaint.aggregate([
    { $match: { status: { $ne: "RESOLVED" }, department: { $ne: null } } },
    { $group: { _id: "$department", pending: { $sum: 1 } } },
    { $sort: { pending: -1 } }
  ]);

  const ranked = rows.map((row) => ({ department: row._id, pending: row.pending }));
  const lead = ranked[0];

  return {
    facts: ranked.length
      ? [`Pending complaints by department: ${ranked.map((row) => `${row.department} ${row.pending}`).join(", ")}.`]
      : ["No unresolved complaint is assigned to a department."],
    records: { label: "Pending workload by department", rows: ranked },
    answer: lead
      ? `${lead.department} carries the largest pending workload with ${lead.pending} unresolved complaints.`
      : "No unresolved complaint currently has a department assigned."
  };
}

async function recurring() {
  const result = await findRecurring({ windowDays: 30, limit: 5 });
  const patterns = result.patterns;

  return {
    facts: patterns.length
      ? [
          `${patterns.length} recurring patterns detected in the last 30 days across ${result.complaintsExamined} complaints.`,
          ...patterns.map(
            (pattern) =>
              `${pattern.building.name}: ${pattern.occurrences} ${pattern.category} complaints over ${pattern.distinctDays} days, ${pattern.textSimilarity}% wording overlap.`
          )
        ]
      : [
          `No pattern in the last 30 days reached the detection threshold of ` +
            `${RECURRENCE_THRESHOLDS.minOccurrences} complaints on ` +
            `${RECURRENCE_THRESHOLDS.minDistinctDays} or more separate days.`
        ],
    records: { label: "Recurring patterns (last 30 days)", rows: patterns },
    answer: patterns.length
      ? `Yes — ${patterns.length} recurring pattern${patterns.length === 1 ? "" : "s"}. The strongest is ${patterns[0].occurrences} ${patterns[0].category} complaints in ${patterns[0].building.name}.`
      : "No recurring pattern in the last 30 days clears the detection threshold."
  };
}

async function todaySummary() {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const [filedToday, unresolved, criticalOpen, incidentsOpen, activePasses, overduePasses] = await Promise.all([
    Complaint.countDocuments({ createdAt: { $gte: dayStart } }),
    Complaint.countDocuments({ status: { $ne: "RESOLVED" } }),
    Complaint.countDocuments({ status: { $ne: "RESOLVED" }, priority: "CRITICAL" }),
    Incident.countDocuments({ status: { $ne: "RESOLVED" } }),
    GatePass.countDocuments({ status: "ACTIVE" }),
    GatePass.countDocuments({ status: "OVERDUE" })
  ]);

  const rows = await Complaint.find({ createdAt: { $gte: dayStart } })
    .populate("building", "code")
    .sort({ createdAt: -1 })
    .limit(15)
    .lean();

  return {
    facts: [
      `${filedToday} complaints were filed today.`,
      `${unresolved} complaints are unresolved in total, ${criticalOpen} of them CRITICAL.`,
      `${incidentsOpen} incidents are open.`,
      `${activePasses} gate passes are active and ${overduePasses} are overdue.`
    ],
    records: { label: "Complaints filed today", rows: rows.map(complaintRecord) },
    answer:
      `Today: ${filedToday} new complaints, ${unresolved} unresolved overall (${criticalOpen} critical), ` +
      `${incidentsOpen} open incidents, ${activePasses} active gate passes and ${overduePasses} overdue.`
  };
}

async function gatePassState() {
  const rows = await GatePass.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }, { $sort: { count: -1 } }]);
  const overdue = await GatePass.find({ status: "OVERDUE" })
    .populate("student", "name studentId")
    .select("reference status expectedReturnAt overdueMinutes hostelName student")
    .limit(15)
    .lean();

  const breakdown = rows.map((row) => `${row.count} ${row._id}`).join(", ");

  return {
    facts: [
      breakdown ? `Gate passes by status: ${breakdown}.` : "No gate passes on record.",
      `${overdue.length} passes are currently OVERDUE.`
    ],
    records: {
      label: "Overdue gate passes",
      rows: overdue.map((row) => ({
        reference: row.reference,
        student: row.student?.name || "unknown",
        studentId: row.student?.studentId || null,
        hostel: row.hostelName,
        expectedReturnAt: row.expectedReturnAt,
        overdueMinutes: row.overdueMinutes || 0
      }))
    },
    answer: breakdown ? `Gate passes by status: ${breakdown}.` : "No gate passes are on record."
  };
}

async function anomalies() {
  const rows = await Anomaly.find({ status: { $in: ["OPEN", "ACKNOWLEDGED", "CONFIRMED"] } })
    .populate("building", "code name")
    .sort({ predictedRisk: -1 })
    .limit(10)
    .lean();

  return {
    facts: rows.length
      ? [
          `${rows.length} metric anomalies are open.`,
          ...rows.slice(0, 5).map((row) => `${row.building?.name || "Campus"}: ${row.signal}, ${row.complaintsSoFar} complaints so far.`)
        ]
      : ["No metric anomaly is currently open."],
    records: {
      label: "Open metric anomalies",
      rows: rows.map((row) => ({
        building: row.building?.name || "Campus",
        signal: row.signal,
        predictedRisk: row.predictedRisk,
        complaintsSoFar: row.complaintsSoFar,
        status: row.status,
        method: row.method
      }))
    },
    answer: rows.length
      ? `${rows.length} anomalies are open. The highest predicted risk is ${rows[0].predictedRisk}% on ${rows[0].building?.name || "campus"}.`
      : "No metric anomaly is currently open."
  };
}

async function slaRisk() {
  const forecast = await slaForecast({ limit: 15 });
  const { BREACHED, HIGH, MEDIUM, LOW } = forecast.counts;
  const risky = forecast.rows.filter((row) => row.risk === "BREACHED" || row.risk === "HIGH");
  return {
    facts: [
      `${forecast.openExamined} open complaints examined against their SLA.`,
      `${BREACHED} have already breached SLA; ${HIGH} are predicted HIGH risk, ${MEDIUM} MEDIUM and ${LOW} LOW.`,
      `${forecast.resolvedHistory} resolved complaints are available as resolution-time history.`,
      ...risky.slice(0, 6).map((row) => `${row.reference} (${row.category}, ${row.status}) is ${row.ageHours}h old against a ${row.slaHours}h SLA — ${row.risk}.`)
    ],
    records: {
      label: "Open complaints by SLA risk",
      rows: forecast.rows.map((row) => ({ reference: row.reference, risk: row.risk, category: row.category, status: row.status, ageHours: row.ageHours, slaHours: row.slaHours }))
    },
    answer: BREACHED || HIGH
      ? `${BREACHED} complaint${BREACHED === 1 ? " has" : "s have"} breached SLA and ${HIGH} ${HIGH === 1 ? "is" : "are"} predicted at high risk${risky[0] ? `, led by ${risky[0].reference}` : ""}.`
      : `No open complaint has breached SLA or is at high risk; ${MEDIUM} need watching.`
  };
}

async function feedbackSummary() {
  const analysis = await feedbackAnalysis();
  if (!analysis.available) {
    return { facts: [analysis.note], records: { label: "Feedback", rows: [] }, answer: analysis.note };
  }
  return {
    facts: [
      `${analysis.total} ratings recorded, average ${analysis.averageRating} out of 5.`,
      `Sentiment: ${analysis.sentiment.POSITIVE} positive, ${analysis.sentiment.NEUTRAL} neutral, ${analysis.sentiment.NEGATIVE} negative (lexicon + star rating).`,
      ...analysis.byCategory.map((row) => `${row.key}: average ${row.averageRating}/5 over ${row.count} ratings.`)
    ],
    records: { label: "Most recent ratings", rows: analysis.recent.map((row) => ({ reference: row.reference, rating: row.rating, sentiment: row.sentiment, category: row.category, comment: row.comment })) },
    answer: `${analysis.total} ratings, average ${analysis.averageRating}/5. Lowest-rated category: ${analysis.byCategory[0].key} at ${analysis.byCategory[0].averageRating}/5.`
  };
}

const HANDLERS = {
  UNRESOLVED_COMPLAINTS: unresolvedComplaints,
  WORST_BUILDING: worstBuilding,
  TOP_CATEGORIES: topCategories,
  HIGH_PRIORITY: highPriority,
  DEPARTMENT_LOAD: departmentLoad,
  RECURRING: recurring,
  TODAY_SUMMARY: todaySummary,
  GATE_PASS: gatePassState,
  ANOMALY: anomalies,
  SLA_RISK: slaRisk,
  FEEDBACK: feedbackSummary
};

/**
 * Runs the matched intent and returns the grounding bundle.
 * An unrecognised question gets today's summary as context plus an honest note
 * that the shape was not recognised — never a guessed answer.
 */
export async function ground(question) {
  const { intent, matchedKeywords, matchStrength } = detectIntent(question);

  if (intent === "UNKNOWN" || !HANDLERS[intent]) {
    const fallback = await todaySummary();
    return {
      intent: "UNKNOWN",
      matchedKeywords,
      matchStrength,
      recognised: false,
      facts: fallback.facts,
      records: fallback.records,
      answer:
        "That question does not match a query this system knows how to run against the database. " +
        "Here is the current campus state instead. " +
        `Supported: ${SUPPORTED_ADMIN_QUESTIONS.slice(0, 4).join(" · ")}`,
      method: "RULE_BASED_INTENT_MATCH"
    };
  }

  const result = await HANDLERS[intent]();
  return {
    intent,
    matchedKeywords,
    matchStrength,
    recognised: true,
    ...result,
    method: "RULE_BASED_INTENT_MATCH + DATABASE_AGGREGATION"
  };
}

export const SUPPORTED_ADMIN_QUESTIONS = [
  "How many unresolved complaints are there?",
  "Which hostel has the most complaints?",
  "What are the most common complaint categories this month?",
  "Show high-priority unresolved complaints.",
  "Which department has the largest pending workload?",
  "Are there recurring problems?",
  "Summarise today's campus issues.",
  "How many gate passes are overdue?",
  "What anomalies are open right now?",
  "Which complaints may breach their SLA?",
  "What does student feedback say?"
];
