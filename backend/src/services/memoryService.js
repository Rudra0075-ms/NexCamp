import { CampusMemory } from "../models/CampusMemory.js";
import { clamp, round, sharedTerms, similarity, tokenize } from "../utils/text.js";

/**
 * Campus memory: what previous incidents looked like, and whether the one in
 * front of us matches any of them.
 *
 * Similarity is a weighted sum of same-building, same-category and keyword
 * overlap. Deterministic — `method` says so on every response, and only
 * `scoreMatch()` would change if an ML similarity model replaced it.
 */

const WEIGHTS = { building: 34, category: 26, keywords: 30, recency: 10 };

function scoreMatch(incident, memory, { incidentText }) {
  const sameBuilding = String(incident.building || "") === String(memory.building || "");
  const sameCategory = incident.category === memory.category;

  const memoryText = [memory.incidentType, memory.cause, memory.resolution, ...(memory.signatures || [])].join(" ");
  const overlap = similarity(incidentText, memoryText);

  const monthsAgo = (Date.now() - new Date(memory.occurredOn)) / (30 * 864e5);
  const recency = clamp(1 - monthsAgo / 24, 0, 1);

  const score =
    (sameBuilding ? WEIGHTS.building : 0) +
    (sameCategory ? WEIGHTS.category : 0) +
    overlap * WEIGHTS.keywords +
    recency * WEIGHTS.recency;

  const matchingFactors = [];
  if (sameBuilding) matchingFactors.push({ factor: "Same building", weight: WEIGHTS.building });
  if (sameCategory) matchingFactors.push({ factor: `Same category (${memory.category})`, weight: WEIGHTS.category });
  if (overlap > 0.05) {
    matchingFactors.push({
      factor: `Shared terms: ${sharedTerms(incidentText, memoryText, 4).join(", ") || "none"}`,
      weight: round(overlap * WEIGHTS.keywords, 1)
    });
  }
  matchingFactors.push({
    factor: `Occurred ${round(monthsAgo, 1)} months ago`,
    weight: round(recency * WEIGHTS.recency, 1)
  });

  return { similarity: round(clamp(score, 0, 100)), matchingFactors };
}

export async function findMatches(incident, { limit = 4 } = {}) {
  const query = {};
  // Look wider than the exact building so a repeat pattern elsewhere is visible.
  if (incident.building || incident.category) {
    query.$or = [];
    if (incident.building) query.$or.push({ building: incident.building });
    if (incident.category) query.$or.push({ category: incident.category });
  }

  const memories = await CampusMemory.find(query)
    .populate("building", "code name")
    .sort({ occurredOn: -1 })
    .limit(40)
    .lean();

  const incidentText = [incident.title, incident.description, ...(incident.possibleCauses || []).map((c) => c.cause)]
    .filter(Boolean)
    .join(" ");

  return memories
    .map((memory) => ({
      memory: {
        id: String(memory._id),
        occurredOn: memory.occurredOn,
        incidentType: memory.incidentType,
        category: memory.category,
        building: memory.building ? { code: memory.building.code, name: memory.building.name } : null,
        buildingName: memory.buildingName,
        cause: memory.cause,
        resolution: memory.resolution,
        resolutionTimeHours: memory.resolutionTimeHours,
        outcome: memory.outcome,
        riskBefore: memory.riskBefore,
        riskAfter: memory.riskAfter,
        recurrence: memory.recurrence,
        signatures: memory.signatures
      },
      ...scoreMatch(incident, memory, { incidentText })
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

export async function bestMatch(incident) {
  const [top] = await findMatches(incident, { limit: 1 });
  if (!top) return null;
  return {
    matchedIncident: top.memory,
    similarity: top.similarity,
    matchingFactors: top.matchingFactors,
    evidence: [
      {
        label: "SAME BUILDING",
        value: top.memory.building?.name || top.memory.buildingName || "—",
        kind: "ACTUAL DATA"
      },
      { label: "PREVIOUS CAUSE", value: top.memory.cause || "—", kind: "ACTUAL DATA" },
      {
        label: "PREVIOUS RESOLUTION",
        value: `${top.memory.resolution || "—"} · ${top.memory.resolutionTimeHours ?? "—"}h`,
        kind: "ACTUAL DATA"
      },
      {
        label: "RISK MOVEMENT THEN",
        value: `${top.memory.riskBefore ?? "—"}% → ${top.memory.riskAfter ?? "—"}%`,
        kind: "ACTUAL DATA"
      },
      {
        label: "SIMILARITY",
        value: `${top.similarity}% (keyword and location match, not a learned model)`,
        kind: "AI PREDICTION"
      }
    ],
    method: "WEIGHTED_DETERMINISTIC_SIMILARITY"
  };
}

/**
 * Writes a resolved incident into campus memory. Called once resolution
 * information exists, so a pattern is only stored with its outcome.
 */
export async function remember(incident, { building, resolution } = {}) {
  const res = resolution || incident.resolution || {};
  const keywords = [
    ...new Set(
      tokenize(
        [incident.title, incident.description, ...(incident.possibleCauses || []).map((c) => c.cause)]
          .filter(Boolean)
          .join(" ")
      )
    )
  ].slice(0, 24);

  const priorCount = await CampusMemory.countDocuments({
    building: incident.building,
    category: incident.category
  });

  const signatures = [
    (incident.possibleCauses || [])[0]?.cause,
    `${incident.complaints?.length || 0}-complaint cluster`,
    res.resolutionTimeHours ? `Resolved in ${res.resolutionTimeHours}h` : null,
    priorCount ? `Recurrence ${priorCount + 1} in this building` : "First of its kind here"
  ].filter(Boolean);

  const doc = await CampusMemory.findOneAndUpdate(
    { incident: incident._id },
    {
      incident: incident._id,
      incidentReference: incident.reference,
      occurredOn: res.resolvedAt || new Date(),
      incidentType: incident.title,
      category: incident.category,
      building: incident.building,
      buildingName: building?.name,
      cause: (incident.possibleCauses || [])[0]?.cause,
      resolution: res.resolutionDescription,
      resolutionTimeHours: res.resolutionTimeHours,
      outcome: res.recurrence === "None" ? "STABLE" : "MONITORING",
      riskBefore: res.riskBefore ?? incident.risk,
      riskAfter: res.riskAfter,
      studentSatisfaction: res.studentSatisfaction,
      recurrence: res.recurrence,
      recurrenceCount: priorCount,
      signatures,
      keywords
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return doc;
}
