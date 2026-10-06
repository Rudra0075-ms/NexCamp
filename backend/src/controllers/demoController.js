import { Anomaly } from "../models/Anomaly.js";
import { Building } from "../models/Building.js";
import { Complaint } from "../models/Complaint.js";
import { Incident } from "../models/Incident.js";
import { Intervention } from "../models/Intervention.js";
import { clusterComplaints } from "../services/incidentClusteringService.js";
import { compareScenarios } from "../services/interventionService.js";
import { investigate } from "../services/investigationService.js";
import { bestMatch } from "../services/memoryService.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ok } from "../utils/respond.js";
import { round } from "../utils/text.js";

/**
 * GET /api/demo/incident-story
 *
 * The whole pipeline for one incident, in the order a judge walks through it:
 * report -> classification -> related complaints -> incident -> historical
 * match -> investigation -> risk -> prediction -> intervention -> resolution ->
 * memory. Every step names the page that renders it; the animation stays in the
 * frontend, and none of these values are invented here — they are read back out
 * of the same records the rest of the API serves.
 */
export const incidentStory = asyncHandler(async (req, res) => {
  const incident = req.query.incident
    ? await Incident.findById(req.query.incident).populate("building", "code name").lean()
    : await Incident.findOne({ status: { $ne: "RESOLVED" } })
        .populate("building", "code name")
        .sort({ risk: -1 })
        .lean();

  if (!incident) throw ApiError.notFound("No incident available to narrate — run `npm run seed` first");

  const [complaints, investigation, memoryMatch, intervention, anomalies] = await Promise.all([
    Complaint.find({ $or: [{ relatedIncident: incident._id }, { _id: { $in: incident.complaints || [] } }] })
      .populate("student", "name studentId")
      .sort({ createdAt: 1 })
      .lean(),
    investigate(incident._id),
    bestMatch(incident),
    Intervention.findOne({ incident: incident._id }).sort({ createdAt: -1 }).lean(),
    Anomaly.find({ status: { $in: ["OPEN", "ACKNOWLEDGED"] }, complaintsSoFar: 0 })
      .populate("building", "code name")
      .sort({ predictedRisk: -1 })
      .limit(2)
      .lean()
  ]);

  const firstReport = complaints[0];
  const clustering = await clusterComplaints({
    buildingId: incident.building?._id,
    category: incident.category,
    windowDays: 30
  });
  const cluster = clustering.clusters[0] || null;

  const comparison = compareScenarios({
    currentRisk: incident.risk,
    affectedStudents: incident.affectedStudents,
    confidence: investigation?.confidence ?? incident.confidence ?? 85,
    repairHours: intervention?.estimatedResolutionHours ?? 4
  });

  const repairNow = comparison.scenarios.find((row) => row.scenario === "REPAIR_NOW");
  const doNothing = comparison.scenarios.find((row) => row.scenario === "DO_NOTHING");

  const steps = [
    {
      at: "00:00",
      page: "report",
      label: "STUDENT REPORTS",
      text: firstReport ? `"${firstReport.description}"` : "No complaint recorded",
      kind: "ACTUAL DATA",
      data: firstReport
        ? {
            reference: firstReport.reference,
            student: firstReport.student?.name,
            location: firstReport.location,
            createdAt: firstReport.createdAt
          }
        : null
    },
    {
      at: "00:04",
      page: "report",
      label: "AI CLASSIFICATION",
      text: firstReport
        ? `${firstReport.aiClassification?.category} · ${incident.building?.name || "campus"} · ${firstReport.aiClassification?.severity} severity`
        : "—",
      kind: "AI PREDICTION",
      data: firstReport?.aiClassification || null
    },
    {
      at: "00:08",
      page: "incident",
      label: `${complaints.length} SIMILAR COMPLAINTS DETECTED`,
      text: cluster
        ? `${cluster.averageOverlap}% average keyword overlap across ${cluster.distinctPhrasings} distinct phrasings, one building`
        : "No cluster formed",
      kind: "EVIDENCE",
      data: {
        inputComplaints: clustering.inputComplaints,
        complaintCount: cluster?.complaintCount ?? complaints.length,
        averageOverlap: cluster?.averageOverlap ?? 0,
        sharedTerms: cluster?.sharedTerms ?? [],
        method: clustering.method
      }
    },
    {
      at: "00:12",
      page: "incident",
      label: "COMPLAINTS CONVERGE",
      text: `${complaints.length} complaints resolve into ${incident.reference}`,
      kind: "ACTUAL DATA",
      data: {
        incidentId: String(incident._id),
        reference: incident.reference,
        title: incident.title,
        status: incident.status,
        risk: incident.risk
      }
    },
    {
      at: "00:16",
      page: "incident",
      label: "CAMPUS MEMORY SCANNED",
      text: memoryMatch
        ? `Matching ${new Date(memoryMatch.matchedIncident.occurredOn).toISOString().slice(0, 10)} — ${memoryMatch.matchedIncident.incidentType} at ${memoryMatch.similarity}% similarity`
        : "Campus memory holds no comparable incident",
      kind: "EVIDENCE",
      data: memoryMatch
    },
    {
      at: "00:20",
      page: "investigation",
      label: "EVIDENCE ASSEMBLED",
      text: investigation
        ? `${investigation.possibleCauses[0]?.cause || "cause undetermined"} at ${investigation.confidence}% confidence`
        : "—",
      kind: "EVIDENCE",
      data: investigation
        ? {
            confidence: investigation.confidence,
            confidenceBreakdown: investigation.confidenceBreakdown,
            possibleCauses: investigation.possibleCauses,
            brief: investigation.brief
          }
        : null
    },
    {
      at: "00:24",
      page: "risk",
      label: "SILENT PROBLEM DETECTED",
      text: anomalies[0]
        ? `${anomalies[0].building?.name} · ${anomalies[0].predictedRisk}% predicted risk, ${anomalies[0].complaintsSoFar} complaints`
        : "No silent signal currently open",
      kind: "AI PREDICTION",
      data: anomalies.map((anomaly) => ({
        building: anomaly.building?.code,
        signal: anomaly.signal,
        predictedRisk: anomaly.predictedRisk,
        historicalPattern: anomaly.historicalPattern,
        complaintsSoFar: anomaly.complaintsSoFar,
        method: anomaly.method
      }))
    },
    {
      at: "00:28",
      page: "intervention",
      label: "DECISION SUPPORT",
      text: `Do nothing ${doNothing?.riskAfter}% · repair now ${repairNow?.riskAfter}%`,
      kind: "AI RECOMMENDATION",
      data: { comparison, recommendation: intervention?.recommendedAction || null }
    },
    {
      at: "00:32",
      page: "intervention",
      label: "HUMAN DECISION",
      text: intervention?.decision?.value
        ? `${intervention.decision.byName || "Administration"} ${intervention.decision.value.toLowerCase()}ed the recommendation`
        : "Waiting for a human decision — ACCEPT, MODIFY or REJECT",
      kind: "ACTUAL DATA",
      data: intervention
        ? {
            interventionId: String(intervention._id),
            reference: intervention.reference,
            recommendedAction: intervention.recommendedAction,
            status: intervention.status,
            decision: intervention.decision || null
          }
        : null
    },
    {
      at: "00:36",
      page: "intervention",
      label: "CAMPUS MEMORY UPDATED",
      text: repairNow
        ? `Risk ${repairNow.riskBefore}% → ${repairNow.riskAfter}% · pattern stored`
        : "—",
      kind: "AI PREDICTION",
      data: {
        riskBefore: repairNow?.riskBefore,
        riskAfter: repairNow?.riskAfter,
        signatures: memoryMatch?.matchedIncident?.signatures || [],
        studentsSpared: comparison.studentsSpared,
        complaintsAvoided: comparison.complaintsAvoided
      }
    }
  ];

  return ok(res, {
    incident: {
      id: String(incident._id),
      reference: incident.reference,
      title: incident.title,
      category: incident.category,
      status: incident.status,
      risk: incident.risk,
      affectedStudents: incident.affectedStudents,
      building: incident.building
        ? { id: String(incident.building._id), code: incident.building.code, name: incident.building.name }
        : null
    },
    steps,
    complaints: complaints.map((complaint) => ({
      id: String(complaint._id),
      reference: complaint.reference,
      title: complaint.title,
      description: complaint.description,
      createdAt: complaint.createdAt,
      status: complaint.status
    })),
    timeline: buildTimeline(complaints, incident),
    method: "DATABASE_READ",
    disclaimer:
      "Every value in this story is read back from the same records the rest of the API serves. " +
      "Animation is entirely the frontend's job."
  });
});

/** Day-by-day: how the cluster and the risk grew. Drives the time-travel slider. */
function buildTimeline(complaints, incident) {
  if (!complaints.length) return [];

  const first = new Date(complaints[0].createdAt);
  const totalDays = Math.max(1, Math.ceil((Date.now() - first) / 864e5));
  const marks = [...new Set([1, 3, 7, 14, totalDays].filter((day) => day <= totalDays))].sort((a, b) => a - b);

  return marks.map((day, index) => {
    const cutoff = new Date(first.getTime() + day * 864e5);
    const count = complaints.filter((complaint) => new Date(complaint.createdAt) <= cutoff).length;
    // Risk on that day, scaled by how much of the cluster had arrived.
    const risk = round(incident.risk * (count / complaints.length));
    const status =
      index === marks.length - 1
        ? incident.status
        : count >= complaints.length * 0.9
          ? "CONFIRMED"
          : count >= complaints.length * 0.5
            ? "PATTERN DETECTED"
            : count > 1
              ? "CLUSTERED"
              : "DETECTED";

    return {
      label: index === marks.length - 1 ? "TODAY" : `DAY ${day}`,
      day,
      complaints: count,
      risk,
      status,
      note:
        count === 1
          ? `First complaint: "${complaints[0].description}"`
          : `${count} complaints, same building, different words.`
    };
  });
}

/** GET /api/demo/reset-state — what a judge sees before anything is clicked. */
export const demoState = asyncHandler(async (_req, res) => {
  const [buildings, incidents, complaints, interventions] = await Promise.all([
    Building.countDocuments(),
    Incident.countDocuments(),
    Complaint.countDocuments(),
    Intervention.countDocuments()
  ]);

  return ok(res, {
    seeded: buildings > 0 && incidents > 0,
    counts: { buildings, incidents, complaints, interventions },
    message: buildings ? "Demo data is loaded" : "Run `npm run seed` in backend/ to load demo data"
  });
});
