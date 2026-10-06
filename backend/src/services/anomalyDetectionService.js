import { Anomaly } from "../models/Anomaly.js";
import { Building } from "../models/Building.js";
import { CampusMemory } from "../models/CampusMemory.js";
import { Complaint } from "../models/Complaint.js";
import { clamp, round } from "../utils/text.js";

/**
 * Silent problem detection: a metric moving the way it moved before a previous
 * failure, while nobody has complained yet.
 *
 * Rule-based thresholds over a metric series plus a campus-memory lookup. There
 * is no learned model here, and `method: "RULE_BASED_THRESHOLD"` is returned on
 * every anomaly so the UI never presents this as machine learning.
 */

const RULES = [
  { metric: "WATER_DRAW", direction: "DOWN", changeThreshold: 15, category: "WATER", weight: 1.0 },
  { metric: "WIFI_SESSION_SUCCESS", direction: "DOWN", changeThreshold: 12, category: "WI-FI", weight: 0.9 },
  { metric: "MESS_SLOT_LOAD", direction: "UP", changeThreshold: 18, category: "MESS", weight: 0.75 },
  { metric: "MEDICAL_WALKINS", direction: "UP", changeThreshold: 15, category: "HEALTH", weight: 0.7 },
  { metric: "ATTENDANCE_0800", direction: "DOWN", changeThreshold: 8, category: "ATTENDANCE", weight: 0.85 }
];

export function ruleFor(metric) {
  return RULES.find((rule) => rule.metric === metric) || null;
}

/**
 * Evaluates one metric reading against its rule and against campus memory.
 * Returns an anomaly payload, or null when nothing crossed a threshold.
 */
export async function evaluate({ building, metric, baseline, current, daysObserved = 0, signalLabel }) {
  const rule = ruleFor(metric);
  if (!rule || !baseline) return null;

  const changePercentage = round(((current - baseline) / baseline) * 100, 1);
  const movedWrongWay =
    (rule.direction === "DOWN" && changePercentage <= -rule.changeThreshold) ||
    (rule.direction === "UP" && changePercentage >= rule.changeThreshold);

  if (!movedWrongWay) return null;

  const history = await CampusMemory.find({ building: building._id, category: rule.category })
    .sort({ occurredOn: -1 })
    .limit(5)
    .lean();

  const complaintsSoFar = await Complaint.countDocuments({
    building: building._id,
    category: rule.category,
    createdAt: { $gte: new Date(Date.now() - daysObserved * 864e5 || Date.now() - 14 * 864e5) }
  });

  // Magnitude + how long it has held + whether this happened here before.
  const magnitude = clamp(Math.abs(changePercentage) / rule.changeThreshold, 0, 3);
  const persistence = clamp(daysObserved / 14, 0, 1);
  const memoryWeight = clamp(history.length / 3, 0, 1);

  const predictedRisk = round(
    clamp((magnitude * 22 + persistence * 28 + memoryWeight * 26) * rule.weight, 0, 96)
  );
  const confidence = round(
    clamp(34 + magnitude * 12 + persistence * 18 + memoryWeight * 20, 30, 92)
  );

  return {
    building: building._id,
    metric,
    signal: signalLabel || `${metric.replace(/_/g, " ").toLowerCase()} ${changePercentage > 0 ? "up" : "down"} ${Math.abs(changePercentage)}%`,
    baseline,
    current,
    changePercentage,
    direction: changePercentage > 0 ? "UP" : "DOWN",
    historicalPattern: history.length
      ? `Matches ${history.length} previous ${rule.category.toLowerCase()} incident${history.length === 1 ? "" : "s"} in this building, closest ${new Date(history[0].occurredOn).toISOString().slice(0, 10)}`
      : "No comparable incident in campus memory",
    matchedMemory: history[0]?._id,
    predictedRisk,
    confidence,
    complaintsSoFar,
    daysObserved,
    recommendedAction:
      complaintsSoFar === 0
        ? `Inspect ${building.name} before students report it`
        : `Escalate ${building.name} — ${complaintsSoFar} complaints already filed`,
    method: "RULE_BASED_THRESHOLD",
    status: "OPEN"
  };
}

/** Upserts an evaluated anomaly so repeated runs do not duplicate rows. */
export async function record(payload) {
  if (!payload) return null;
  return Anomaly.findOneAndUpdate(
    { building: payload.building, metric: payload.metric, status: { $in: ["OPEN", "ACKNOWLEDGED"] } },
    { ...payload, detectedAt: new Date() },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
}

export async function listOpen({ limit = 20 } = {}) {
  const rows = await Anomaly.find({ status: { $in: ["OPEN", "ACKNOWLEDGED", "CONFIRMED"] } })
    .populate("building", "code name type")
    .sort({ predictedRisk: -1 })
    .limit(limit)
    .lean();

  return rows.map((row) => ({
    id: String(row._id),
    building: row.building ? { id: String(row.building._id), code: row.building.code, name: row.building.name } : null,
    metric: row.metric,
    signal: row.signal,
    change: `${row.changePercentage > 0 ? "+" : ""}${row.changePercentage}%`,
    changePercentage: row.changePercentage,
    historicalPattern: row.historicalPattern,
    predictedRisk: row.predictedRisk,
    confidence: row.confidence,
    complaintsSoFar: row.complaintsSoFar,
    daysObserved: row.daysObserved,
    recommendedAction: row.recommendedAction,
    status: row.status,
    method: row.method,
    detectedAt: row.detectedAt
  }));
}

/** Re-evaluates every building that carries a stored metric series. */
export async function sweep(readings = []) {
  const buildings = await Building.find().lean();
  const byCode = new Map(buildings.map((b) => [b.code, b]));
  const results = [];
  for (const reading of readings) {
    const building = byCode.get(reading.buildingCode);
    if (!building) continue;
    const anomaly = await evaluate({ ...reading, building });
    if (anomaly) results.push(await record(anomaly));
  }
  return results;
}

export const ANOMALY_RULES = RULES;
