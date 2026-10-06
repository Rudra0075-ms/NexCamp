import { Anomaly } from "../models/Anomaly.js";
import { Building } from "../models/Building.js";
import { Complaint } from "../models/Complaint.js";
import { Incident } from "../models/Incident.js";
import { Intervention } from "../models/Intervention.js";
import { relationships } from "../services/intelligenceService.js";
import { campusHealth } from "../services/riskService.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ok } from "../utils/respond.js";
import { round } from "../utils/text.js";
import { medianResponseDays } from "../services/xo/responseStats.js"; // EXCEPTION-ONLY HOOK

/** GET /api/admin/overview — the mission-control KPI strip. */
export const overview = asyncHandler(async (_req, res) => {
  const [buildings, activeIncidents, pendingComplaints, criticalIncidents, resolved, pendingInterventions] =
    await Promise.all([
      Building.find().select("currentRisk code name").lean(),
      Incident.countDocuments({ status: { $ne: "RESOLVED" } }),
      Complaint.countDocuments({ status: { $ne: "RESOLVED" } }),
      Incident.countDocuments({ status: { $ne: "RESOLVED" }, risk: { $gte: 85 } }),
      Incident.find({ "resolution.resolutionTimeHours": { $exists: true } })
        .select("resolution.resolutionTimeHours resolution.studentSatisfaction")
        .lean(),
      Intervention.countDocuments({ status: "RECOMMENDED" })
    ]);

  const health = campusHealth({
    risks: buildings.map((b) => b.currentRisk),
    pendingComplaints,
    activeIncidents
  });

  const averageResolution = resolved.length
    ? round(resolved.reduce((t, i) => t + i.resolution.resolutionTimeHours, 0) / resolved.length, 1)
    : null;
  const averageSatisfaction = resolved.filter((i) => i.resolution.studentSatisfaction).length
    ? round(
        resolved
          .filter((i) => i.resolution.studentSatisfaction)
          .reduce((t, i) => t + i.resolution.studentSatisfaction, 0) /
          resolved.filter((i) => i.resolution.studentSatisfaction).length
      )
    : null;

  const recentFeed = await buildFeed();

  return ok(res, {
    kpis: [
      { key: "CAMPUS HEALTH", value: `${health.health}%`, kind: "ACTUAL DATA" },
      { key: "ACTIVE INCIDENTS", value: String(activeIncidents), kind: "ACTUAL DATA" },
      { key: "CRITICAL PROBLEMS", value: String(criticalIncidents), kind: "ACTUAL DATA" },
      { key: "PENDING COMPLAINTS", value: String(pendingComplaints), kind: "ACTUAL DATA" },
      {
        key: "AVG RESOLUTION",
        value: averageResolution === null ? "—" : `${averageResolution}h`,
        kind: "ACTUAL DATA"
      }
    ],
    campusHealth: health.health,
    worstRisk: health.worstRisk,
    activeIncidents,
    pendingComplaints,
    criticalProblems: criticalIncidents,
    pendingInterventions,
    averageResolutionHours: averageResolution,
    averageSatisfaction,
    feed: recentFeed
  });
});

async function buildFeed(limit = 8) {
  const [complaints, incidents, anomalies] = await Promise.all([
    Complaint.find().sort({ createdAt: -1 }).limit(limit).populate("relatedIncident", "reference").lean(),
    Incident.find().sort({ updatedAt: -1 }).limit(limit).lean(),
    Anomaly.find().sort({ detectedAt: -1 }).limit(limit).populate("building", "code").lean()
  ]);

  const entries = [
    ...complaints.map((c) => ({
      at: c.createdAt,
      text: c.relatedIncident
        ? `${c.reference} merged into ${c.relatedIncident.reference} (${c.duplicateProbability}% overlap)`
        : `${c.reference} filed — ${c.title}`
    })),
    ...incidents.map((i) => ({ at: i.updatedAt, text: `${i.reference} at ${i.status} · risk ${i.risk}%` })),
    ...anomalies.map((a) => ({
      at: a.detectedAt,
      text: `${a.building?.code || "CAMPUS"} ${a.signal} held for day ${a.daysObserved}`
    }))
  ];

  return entries
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, limit)
    .map((entry) => ({
      time: new Date(entry.at).toISOString().slice(11, 16),
      text: entry.text
    }));
}

/**
 * GET /api/admin/action-queue
 * Open incidents and silent anomalies ranked by risk × affected students, each
 * with the action the system would take.
 */
export const actionQueue = asyncHandler(async (_req, res) => {
  const [incidents, anomalies] = await Promise.all([
    Incident.find({ status: { $ne: "RESOLVED" } })
      .populate("building", "code name")
      .sort({ risk: -1 })
      .limit(10)
      .lean(),
    Anomaly.find({ status: { $in: ["OPEN", "ACKNOWLEDGED"] } })
      .populate("building", "code name")
      .sort({ predictedRisk: -1 })
      .limit(10)
      .lean()
  ]);

  const interventions = await Intervention.find({
    incident: { $in: incidents.map((i) => i._id) },
    status: { $in: ["RECOMMENDED", "ACCEPTED", "MODIFIED", "IN_PROGRESS"] }
  }).lean();
  const byIncident = new Map(interventions.map((row) => [String(row.incident), row]));

  const rows = [
    ...incidents.map((incident) => {
      const intervention = byIncident.get(String(incident._id));
      return {
        kind: "INCIDENT",
        id: String(incident._id),
        reference: incident.reference,
        name: `${incident.building?.code || "CAMPUS"} · ${incident.title}`,
        risk: incident.risk,
        affectedStudents: incident.affectedStudents,
        action: intervention
          ? `${intervention.recommendedAction} · ${intervention.estimatedResolutionHours}h`
          : `Open an intervention for ${incident.building?.name || "this block"}`,
        interventionId: intervention ? String(intervention._id) : null,
        status: incident.status,
        // Risk alone under-ranks a moderate problem that touches everyone.
        score: round((incident.risk / 100) * incident.affectedStudents)
      };
    }),
    ...anomalies.map((anomaly) => ({
      kind: "ANOMALY",
      id: String(anomaly._id),
      reference: null,
      name: `${anomaly.building?.code || "CAMPUS"} · ${anomaly.signal}`,
      risk: anomaly.predictedRisk,
      affectedStudents: 0,
      action: anomaly.recommendedAction,
      interventionId: null,
      status: anomaly.complaintsSoFar === 0 ? "SILENT" : anomaly.status,
      score: round((anomaly.predictedRisk / 100) * 60)
    }))
  ]
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((row, index) => ({ rank: index + 1, ...row }));

  return ok(res, { queue: rows, method: "RISK_TIMES_REACH_RANKING" });
});

/**
 * GET /api/admin/briefing
 * The daily briefing. Every line carries its own provenance label so the
 * interface never presents a prediction as a measurement.
 */
export const briefing = asyncHandler(async (_req, res) => {
  const [incidents, anomalies, pendingComplaints, buildings] = await Promise.all([
    Incident.find({ status: { $ne: "RESOLVED" } }).populate("building", "code name").sort({ risk: -1 }).limit(5).lean(),
    Anomaly.find({ status: { $in: ["OPEN", "ACKNOWLEDGED"] } }).populate("building", "code name").sort({ predictedRisk: -1 }).limit(5).lean(),
    Complaint.countDocuments({ status: { $ne: "RESOLVED" } }),
    Building.find().select("currentRisk").lean()
  ]);

  const highPriority = incidents.filter((incident) => incident.risk >= 70);
  const silent = anomalies.filter((anomaly) => anomaly.complaintsSoFar === 0);
  const affected = incidents.reduce((total, incident) => total + (incident.affectedStudents || 0), 0);
  const health = campusHealth({ risks: buildings.map((b) => b.currentRisk), pendingComplaints, activeIncidents: incidents.length });

  const lines = [];

  lines.push({
    kind: "ACTUAL DATA",
    text: `${highPriority.length} high-priority incident${highPriority.length === 1 ? "" : "s"} require attention today, ` +
      `across ${affected} students. Campus health stands at ${health.health}%.`
  });

  if (incidents[0]) {
    const lead = incidents[0];
    const ageDays = round((Date.now() - new Date(lead.firstComplaintAt || lead.createdAt)) / 864e5, 1);
    // EXCEPTION-ONLY HOOK: the median is computed from resolved history; 3.8 only as a labelled assumption.
    const medianStat = await medianResponseDays({ category: lead.category });
    lines.push({
      kind: "ACTUAL DATA",
      text: `${lead.building?.name || "Campus"} — ${lead.title} is ${ageDays} days old against a ${medianStat.days}-day median${medianStat.kind === "ASSUMPTION" ? " (assumed — too little resolved history)" : ` (${medianStat.samples} resolved)`}. ` +
        `At ${lead.risk}% this is the largest single risk on campus.`
    });
  }

  if (silent[0]) {
    lines.push({
      kind: "AI PREDICTION",
      text: `${silent[0].building?.name || "One block"} has no complaints and a ${silent[0].predictedRisk}% predicted risk ` +
        `from ${silent[0].signal}. Inspecting it today is the cheapest action available.`
    });
  }

  lines.push({
    kind: "AI RECOMMENDATION",
    text: incidents[0]
      ? `Prioritise ${incidents[0].building?.code || "the leading incident"} first, then work down the action queue by risk × reach.`
      : "No open incidents — hold the current inspection schedule."
  });

  return ok(res, {
    generatedAt: new Date(),
    lines,
    highPriorityIncidents: incidents.map((incident) => ({
      id: String(incident._id),
      reference: incident.reference,
      title: incident.title,
      building: incident.building?.code,
      risk: incident.risk,
      affectedStudents: incident.affectedStudents,
      status: incident.status
    })),
    risk: { campusHealth: health.health, worstRisk: health.worstRisk },
    affectedStudents: affected,
    recommendedPriorities: incidents.slice(0, 3).map((incident, index) => ({
      rank: index + 1,
      reference: incident.reference,
      title: incident.title,
      risk: incident.risk
    })),
    method: "RULE_BASED_SUMMARY",
    // EXCEPTION-ONLY HOOK: who wrote the text. No model writes this briefing, so the
    // interface labels it "from live counts" and never "AI-generated".
    writtenBy: "DETERMINISTIC",
    disclaimer:
      "Assembled from database aggregates and rule-based thresholds. No language model writes this briefing."
  });
});

/** GET /api/admin/cross-domain — the chain strip on mission control. */
export const crossDomain = asyncHandler(async (_req, res) => {
  const graph = await relationships();
  return ok(res, graph);
});
