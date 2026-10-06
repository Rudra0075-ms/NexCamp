import { CATEGORIES, DEPARTMENTS, PRIORITIES, SEVERITIES } from "../config/constants.js";
import { Complaint } from "../models/Complaint.js";
import { clamp, round, similarity } from "../utils/text.js";

/**
 * Deterministic keyword classification.
 *
 * There is no machine-learning model behind this. Every response carries
 * `method: "RULE_BASED_KEYWORD_MATCH"` so the frontend can label it honestly,
 * and `classify()` is the only thing that would need replacing to put a real
 * model behind the same shape.
 */

const CATEGORY_KEYWORDS = {
  WATER: ["water", "tap", "bathroom", "pressure", "tank", "pump", "supply", "leak", "flush", "shower"],
  ELECTRICITY: ["light", "fan", "power", "electric", "socket", "switch", "current", "bulb", "wiring"],
  "WI-FI": ["wifi", "wi-fi", "internet", "network", "router", "connection", "disconnect", "bandwidth", "lan"],
  CLEANLINESS: ["dirty", "clean", "garbage", "waste", "toilet", "sweeper", "dustbin", "smell", "hygiene"],
  MESS: ["mess", "food", "meal", "lunch", "dinner", "breakfast", "queue", "canteen", "menu", "rice"],
  SAFETY: ["unsafe", "theft", "stolen", "harassment", "security", "broken", "fire", "danger", "ragging"],
  ATTENDANCE: ["attendance", "class", "lecture", "absent", "eligibility", "roll"],
  HEALTH: ["sick", "fever", "doctor", "medical", "pain", "clinic", "vomit", "stomach"]
};

const SEVERITY_KEYWORDS = {
  CRITICAL: ["no water", "no power", "since morning", "three days", "whole floor", "entire", "fire", "urgent", "days"],
  MAJOR: ["not working", "repeatedly", "every day", "again", "still", "many"],
  MODERATE: ["slow", "sometimes", "occasionally", "intermittent"]
};

const DEPARTMENT_BY_CATEGORY = {
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

export const SLA_BY_PRIORITY = { CRITICAL: 4, HIGH: 8, MEDIUM: 24, LOW: 72 };

function scoreCategories(text) {
  const haystack = text.toLowerCase();
  const scores = {};
  for (const [category, words] of Object.entries(CATEGORY_KEYWORDS)) {
    scores[category] = words.reduce(
      (total, word) => (haystack.includes(word) ? total + 1 : total),
      0
    );
  }
  return scores;
}

function pickSeverity(text) {
  const haystack = text.toLowerCase();
  for (const level of ["CRITICAL", "MAJOR", "MODERATE"]) {
    if (SEVERITY_KEYWORDS[level].some((word) => haystack.includes(word))) return level;
  }
  return "MINOR";
}

function priorityFor(severity, category, duplicateProbability) {
  const base =
    severity === "CRITICAL" ? 3 : severity === "MAJOR" ? 2 : severity === "MODERATE" ? 1 : 0;
  // A large duplicate cluster means many students, so it escalates on its own.
  const clusterBump = duplicateProbability >= 70 ? 1 : 0;
  const domainBump = ["WATER", "ELECTRICITY", "SAFETY"].includes(category) ? 1 : 0;
  return PRIORITIES[clamp(base + clusterBump + domainBump, 0, PRIORITIES.length - 1)];
}

/**
 * Finds how much this complaint overlaps with recent ones in the same building.
 * Pure keyword overlap (Jaccard on content words) — no embeddings.
 */
export async function findDuplicates(complaint, { windowDays = 21, limit = 50 } = {}) {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const filter = { createdAt: { $gte: since }, _id: { $ne: complaint._id } };
  if (complaint.building) filter.building = complaint.building;

  const recent = await Complaint.find(filter)
    .select("reference title description category building relatedIncident createdAt")
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  const text = `${complaint.title} ${complaint.description}`;
  const scored = recent
    .map((other) => {
      const overlap = similarity(text, `${other.title} ${other.description}`);
      const sameCategory = other.category === complaint.category ? 0.12 : 0;
      return { complaint: other, score: clamp(overlap + sameCategory, 0, 1) };
    })
    .filter((row) => row.score > 0.2)
    .sort((a, b) => b.score - a.score);

  return scored;
}

/**
 * Classifies a complaint. Returns the classification block only — persisting it
 * is the controller's job.
 */
export async function classify(complaint, { building } = {}) {
  const text = `${complaint.title} ${complaint.description}`;
  const scores = scoreCategories(text);
  const [topCategory, topScore] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];

  // Trust the student's own choice unless the text clearly says otherwise.
  const studentCategory = CATEGORIES.includes(complaint.category) ? complaint.category : null;
  const category =
    topScore >= 2 && topCategory !== studentCategory
      ? topCategory
      : studentCategory || (topScore > 0 ? topCategory : "OTHER");

  const duplicates = await findDuplicates(complaint);
  const duplicateProbability = duplicates.length ? round(duplicates[0].score * 100) : 0;

  const severity = pickSeverity(text);
  const priority = priorityFor(severity, category, duplicateProbability);
  const routedTo = DEPARTMENT_BY_CATEGORY[category] || DEPARTMENT_BY_CATEGORY.OTHER;

  // Confidence is a readable sum of the signals that fired, not a model output.
  const confidence = clamp(
    38 +
      Math.min(24, topScore * 8) +
      (duplicateProbability >= 60 ? 18 : duplicateProbability >= 30 ? 9 : 0) +
      (building ? 10 : 0) +
      (severity === "CRITICAL" ? 6 : 0),
    30,
    96
  );

  const reasons = [
    topScore
      ? `${topScore} ${category.toLowerCase()} keyword${topScore === 1 ? "" : "s"} matched in the description`
      : "no category keyword matched — routed as OTHER",
    duplicates.length
      ? `${duplicates.length} recent complaint${duplicates.length === 1 ? "" : "s"} in the same building overlap, best match ${duplicateProbability}%`
      : "no overlapping complaint in the last 21 days",
    `severity read as ${severity} from the wording`,
    building ? `location resolved to ${building.name}` : "no building resolved from the location"
  ];

  return {
    classification: {
      category,
      subCategory: complaint.subCategory || undefined,
      priority,
      severity,
      duplicateProbability,
      affectedArea: complaint.location || building?.name,
      routedTo,
      slaHours: SLA_BY_PRIORITY[priority],
      confidence: round(confidence),
      method: "RULE_BASED_KEYWORD_MATCH",
      reasons,
      classifiedAt: new Date()
    },
    duplicates
  };
}

export const CATEGORY_DEPARTMENTS = DEPARTMENT_BY_CATEGORY;
export const SEVERITY_ORDER = SEVERITIES;
export const DEPARTMENT_LIST = DEPARTMENTS;
