import { Anomaly } from "../models/Anomaly.js";
import { Building } from "../models/Building.js";
import { Complaint } from "../models/Complaint.js";
import { Incident } from "../models/Incident.js";
import { Risk } from "../models/Risk.js";
import { listOpen } from "../services/anomalyDetectionService.js";
import { campusHealth, levelFor } from "../services/riskService.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ok } from "../utils/respond.js";
import { round } from "../utils/text.js";

/** GET /api/risk — latest snapshot per building, plus domain rollups. */
export const listRisk = asyncHandler(async (_req, res) => {
  const buildings = await Building.find().sort({ currentRisk: -1 }).lean();

  const byDomain = new Map();
  for (const building of buildings) {
    const key = building.domain || building.type;
    const entry = byDomain.get(key) || { domain: key, total: 0, count: 0, worst: 0 };
    entry.total += building.currentRisk;
    entry.count += 1;
    entry.worst = Math.max(entry.worst, building.currentRisk);
    byDomain.set(key, entry);
  }

  const [pendingComplaints, activeIncidents] = await Promise.all([
    Complaint.countDocuments({ status: { $ne: "RESOLVED" } }),
    Incident.countDocuments({ status: { $ne: "RESOLVED" } })
  ]);

  const health = campusHealth({
    risks: buildings.map((b) => b.currentRisk),
    pendingComplaints,
    activeIncidents
  });

  const domains = [...byDomain.values()]
    .map((entry) => ({
      domain: entry.domain,
      riskScore: round(entry.worst),
      averageRisk: round(entry.total / entry.count),
      riskLevel: levelFor(entry.worst)
    }))
    .sort((a, b) => b.riskScore - a.riskScore);

  return ok(res, {
    campusRisk: health.worstRisk,
    campusHealth: health.health,
    campusRiskLevel: levelFor(health.worstRisk),
    domains: [
      { domain: "CAMPUS OVERALL", riskScore: health.worstRisk, riskLevel: levelFor(health.worstRisk) },
      ...domains
    ],
    buildings: buildings.map((building) => ({
      id: String(building._id),
      code: building.code,
      mapId: building.mapId,
      name: building.name,
      riskScore: building.currentRisk,
      riskLevel: building.riskLevel,
      affectedStudents: building.affectedStudents,
      activeProblems: building.activeProblems
    })),
    method: health.method
  });
});

/** GET /api/risk/campus — the campus-level number and how it moved. */
export const campusRisk = asyncHandler(async (_req, res) => {
  const buildings = await Building.find().select("currentRisk code name").lean();
  const [pendingComplaints, activeIncidents] = await Promise.all([
    Complaint.countDocuments({ status: { $ne: "RESOLVED" } }),
    Incident.countDocuments({ status: { $ne: "RESOLVED" } })
  ]);

  const health = campusHealth({
    risks: buildings.map((b) => b.currentRisk),
    pendingComplaints,
    activeIncidents
  });

  const history = await Risk.find({ scope: "CAMPUS" }).sort({ timestamp: -1 }).limit(14).lean();

  return ok(res, {
    ...health,
    riskLevel: levelFor(health.worstRisk),
    activeIncidents,
    pendingComplaints,
    worstBuilding: buildings.sort((a, b) => b.currentRisk - a.currentRisk)[0] || null,
    history: history
      .reverse()
      .map((row) => ({ timestamp: row.timestamp, riskScore: row.riskScore, riskLevel: row.riskLevel }))
  });
});

/** GET /api/risk/building/:id */
export const buildingRisk = asyncHandler(async (req, res) => {
  const key = req.params.id;
  const building =
    (await Building.findById(key).lean().catch(() => null)) ||
    (await Building.findOne({ $or: [{ code: key.toUpperCase() }, { mapId: key.toLowerCase() }] }).lean());

  if (!building) throw ApiError.notFound("No building with that id or code");

  const [incidents, history, anomalies] = await Promise.all([
    Incident.find({ building: building._id, status: { $ne: "RESOLVED" } }).sort({ risk: -1 }).lean(),
    Risk.find({ building: building._id }).sort({ timestamp: -1 }).limit(14).lean(),
    Anomaly.find({ building: building._id, status: { $ne: "DISMISSED" } }).sort({ predictedRisk: -1 }).lean()
  ]);

  const lead = incidents[0];

  return ok(res, {
    building: {
      id: String(building._id),
      code: building.code,
      mapId: building.mapId,
      name: building.name,
      domain: building.domain,
      riskScore: building.currentRisk,
      riskLevel: building.riskLevel,
      affectedStudents: building.affectedStudents,
      activeProblems: building.activeProblems,
      historicalProblems: building.historicalProblems
    },
    leadingIncident: lead
      ? {
          id: String(lead._id),
          reference: lead.reference,
          title: lead.title,
          status: lead.status,
          risk: lead.risk,
          confidence: lead.confidence,
          cause: lead.possibleCauses?.[0]?.cause || "—",
          affectedStudents: lead.affectedStudents
        }
      : null,
    // The escalation ladder the UI lights up, level by level.
    levels: ["LOW", "EMERGING", "ELEVATED", "HIGH", "CRITICAL"].map((level, index) => ({
      level,
      reached: index <= ["LOW", "EMERGING", "ELEVATED", "HIGH", "CRITICAL"].indexOf(levelFor(building.currentRisk))
    })),
    anomalies: anomalies.map((anomaly) => ({
      id: String(anomaly._id),
      signal: anomaly.signal,
      metric: anomaly.metric,
      change: `${anomaly.changePercentage > 0 ? "+" : ""}${anomaly.changePercentage}%`,
      historicalPattern: anomaly.historicalPattern,
      predictedRisk: anomaly.predictedRisk,
      complaintsSoFar: anomaly.complaintsSoFar,
      recommendedAction: anomaly.recommendedAction,
      daysObserved: anomaly.daysObserved,
      method: anomaly.method
    })),
    history: history
      .reverse()
      .map((row) => ({ timestamp: row.timestamp, riskScore: row.riskScore, riskLevel: row.riskLevel }))
  });
});

/** GET /api/risk/anomalies — silent problems, ranked. */
export const listAnomalies = asyncHandler(async (req, res) => {
  const anomalies = await listOpen({ limit: Number(req.query.limit) || 20 });
  return ok(res, {
    anomalies,
    silent: anomalies.filter((anomaly) => anomaly.complaintsSoFar === 0),
    method: "RULE_BASED_THRESHOLD",
    disclaimer:
      "Anomalies are produced by fixed thresholds over metric series and a campus-memory lookup. " +
      "No model is trained or inferred from."
  });
});
