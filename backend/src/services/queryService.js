import { Anomaly } from "../models/Anomaly.js";
import { Building } from "../models/Building.js";
import { Complaint } from "../models/Complaint.js";
import { Incident } from "../models/Incident.js";
import { Relationship } from "../models/Relationship.js";
import { round, tokenize } from "../utils/text.js";

/**
 * Natural-language campus query.
 *
 * This is intent matching over a fixed set of question shapes, then a real
 * database query for the answer. No language model is involved; every response
 * carries `method: "RULE_BASED_INTENT_MATCH"` and the UI labels it accordingly.
 * Replacing `detectIntent()` with an LLM call is the only change needed to make
 * this genuinely conversational.
 */

const INTENTS = [
  {
    id: "WHY_DECLINE",
    keywords: ["why", "falling", "declining", "drop", "dropping", "decline", "down"],
    needsEntity: true
  },
  { id: "BIGGEST_PROBLEMS", keywords: ["biggest", "worst", "today", "problems", "issues", "critical"] },
  { id: "WILL_WORSEN", keywords: ["worse", "escalate", "week", "predict", "next", "spreading", "future"] },
  { id: "BUILDING_STATUS", keywords: ["status", "risk", "how", "hostel", "block", "mess", "library"], needsEntity: true },
  { id: "SILENT", keywords: ["silent", "hidden", "unreported", "before", "nobody", "undetected"] }
];

function detectIntent(question) {
  const words = new Set(tokenize(question));
  let best = { intent: null, score: 0 };
  for (const intent of INTENTS) {
    const score = intent.keywords.reduce((total, keyword) => (words.has(keyword) ? total + 1 : total), 0);
    if (score > best.score) best = { intent, score };
  }
  return best.intent ? { ...best, confidence: Math.min(92, 40 + best.score * 14) } : { intent: null, score: 0, confidence: 25 };
}

async function resolveEntity(question) {
  const buildings = await Building.find().select("code name mapId type").lean();
  const haystack = question.toLowerCase();
  // Longest name first, so "hostel b" wins over "hostel".
  const sorted = [...buildings].sort((a, b) => b.name.length - a.name.length);
  for (const building of sorted) {
    if (haystack.includes(building.name.toLowerCase()) || haystack.includes(building.code.toLowerCase())) {
      return building;
    }
  }
  // "hostel b" / "block a" style shorthand.
  const short = haystack.match(/\b(hostel|block|zone)\s+([a-z])\b/);
  if (short) {
    const needle = `${short[1]} ${short[2]}`.toLowerCase();
    return sorted.find((building) => building.name.toLowerCase().includes(needle)) || null;
  }
  return null;
}

function chainFrom(edges) {
  if (!edges.length) return [];
  const labels = [edges[0].fromLabel];
  for (const edge of edges) labels.push(edge.toLabel);
  return labels;
}

export async function answer(question) {
  const { intent, confidence } = detectIntent(question);
  const building = await resolveEntity(question);

  const base = {
    question,
    intent: intent?.id || "UNKNOWN",
    confidence,
    method: "RULE_BASED_INTENT_MATCH",
    disclaimer:
      "Answered by matching the question against known query shapes and running a database query. " +
      "No language model is used."
  };

  if (!intent) {
    return {
      ...base,
      chain: [],
      nodes: [],
      edges: [],
      answer:
        "That question does not match a supported query shape yet. Try asking why a block's attendance is " +
        "falling, what the biggest problems on campus are, or which problems will get worse this week.",
      supporting: []
    };
  }

  if (intent.id === "WHY_DECLINE" || intent.id === "BUILDING_STATUS") {
    const target = building;
    if (!target) {
      return { ...base, chain: [], nodes: [], edges: [], answer: "Name a block and I can trace it — for example 'Why is Hostel B attendance falling?'", supporting: [] };
    }

    const incidents = await Incident.find({ building: target._id, status: { $ne: "RESOLVED" } })
      .sort({ risk: -1 })
      .limit(3)
      .lean();
    const complaintCount = await Complaint.countDocuments({ building: target._id });
    const edges = await Relationship.find({ entityType: "Building", entityId: target._id })
      .sort({ order: 1 })
      .lean();

    const fallbackEdges = edges.length
      ? edges
      : await Relationship.find({ chain: incidents[0]?.category === "WATER" ? "HOSTEL_WATER" : "GENERIC" })
          .sort({ order: 1 })
          .lean();

    const chain = chainFrom(fallbackEdges);
    const lead = incidents[0];

    return {
      ...base,
      entity: { id: String(target._id), code: target.code, name: target.name },
      chain: chain.length ? chain : [target.name, lead?.title || "no active incident"],
      nodes: (chain.length ? chain : [target.name]).map((label, index) => ({ id: `n${index}`, label, order: index })),
      edges: fallbackEdges.map((edge, index) => ({
        from: `n${index}`,
        to: `n${index + 1}`,
        relation: edge.relation,
        confidence: edge.confidence,
        basis: edge.basis
      })),
      answer: lead
        ? `${target.name} is carrying ${incidents.length} open incident${incidents.length === 1 ? "" : "s"}, led by ` +
          `${lead.title} at ${lead.risk}% risk across ${lead.affectedStudents} students. ` +
          `${complaintCount} complaints have been filed against this block in total. The chain above is inferred from ` +
          `complaint timestamps, building occupancy and attendance records.`
        : `${target.name} has no open incident. ${complaintCount} complaints are on record historically.`,
      supporting: incidents.map((incident) => ({
        id: String(incident._id),
        reference: incident.reference,
        title: incident.title,
        risk: incident.risk,
        status: incident.status
      }))
    };
  }

  if (intent.id === "BIGGEST_PROBLEMS") {
    const incidents = await Incident.find({ status: { $ne: "RESOLVED" } })
      .populate("building", "code name")
      .sort({ risk: -1 })
      .limit(5)
      .lean();

    const ranked = incidents.map((incident) => ({
      id: String(incident._id),
      reference: incident.reference,
      label: `${incident.building?.code || "CAMPUS"} ${incident.category} ${incident.risk}%`,
      title: incident.title,
      risk: incident.risk,
      affectedStudents: incident.affectedStudents,
      // Risk alone under-ranks a small problem that touches everyone.
      score: round((incident.risk / 100) * incident.affectedStudents)
    }));

    return {
      ...base,
      chain: ranked.map((row) => row.label),
      nodes: ranked.map((row, index) => ({ id: `n${index}`, label: row.label, order: index })),
      edges: [],
      answer:
        ranked.length
          ? `Ranked by risk × affected students. ${ranked[0].title} leads: ${ranked[0].affectedStudents} students at ` +
            `${ranked[0].risk}% risk. ${ranked.length} open incidents in total.`
          : "No open incidents on campus right now.",
      supporting: ranked
    };
  }

  if (intent.id === "WILL_WORSEN" || intent.id === "SILENT") {
    const anomalies = await Anomaly.find({ status: { $in: ["OPEN", "ACKNOWLEDGED"] } })
      .populate("building", "code name")
      .sort({ predictedRisk: -1 })
      .limit(5)
      .lean();

    const rows = anomalies.map((row) => ({
      id: String(row._id),
      label: `${row.building?.code || "CAMPUS"} ${row.predictedRisk}%`,
      signal: row.signal,
      predictedRisk: row.predictedRisk,
      complaintsSoFar: row.complaintsSoFar,
      daysObserved: row.daysObserved
    }));

    const silent = rows.filter((row) => row.complaintsSoFar === 0);

    return {
      ...base,
      chain: rows.map((row) => row.label),
      nodes: rows.map((row, index) => ({ id: `n${index}`, label: row.label, order: index })),
      edges: [],
      answer: rows.length
        ? `${rows.length} signal${rows.length === 1 ? "" : "s"} crossed their rule thresholds, ` +
          `${silent.length} of them with zero complaints so far. Highest is ${rows[0].signal} at ` +
          `${rows[0].predictedRisk}% predicted risk after ${rows[0].daysObserved} days.`
        : "No metric has crossed its threshold in the current window.",
      supporting: rows
    };
  }

  return { ...base, chain: [], nodes: [], edges: [], answer: "No answer available for that question yet.", supporting: [] };
}

export const SUPPORTED_QUESTIONS = [
  "Why is Hostel B attendance falling?",
  "What are the biggest problems on campus today?",
  "Which problems will get worse this week?",
  "What is happening in Hostel C right now?"
];
