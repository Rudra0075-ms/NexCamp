import { Building } from "../models/Building.js";
import { Complaint } from "../models/Complaint.js";
import { Incident } from "../models/Incident.js";
import { clusterComplaints } from "../services/incidentClusteringService.js";
import { investigate } from "../services/investigationService.js";
import { bestMatch, findMatches, remember } from "../services/memoryService.js";
import { levelFor, scoreIncident } from "../services/riskService.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { pageMeta, paginate } from "../utils/pagination.js";
import { created, ok } from "../utils/respond.js";
import { round } from "../utils/text.js";

function shape(incident) {
  return {
    id: String(incident._id),
    reference: incident.reference,
    title: incident.title,
    description: incident.description,
    category: incident.category,
    status: incident.status,
    risk: incident.risk,
    riskLevel: incident.riskLevel,
    severity: incident.severity,
    confidence: incident.confidence,
    complaintCount: incident.complaints?.length || 0,
    affectedStudents: incident.affectedStudents,
    predictedImpact: incident.predictedImpact,
    possibleCauses: incident.possibleCauses,
    evidence: incident.evidence,
    building: incident.building?.code
      ? { id: String(incident.building._id), code: incident.building.code, name: incident.building.name }
      : null,
    detectedAt: incident.detectedAt,
    firstComplaintAt: incident.firstComplaintAt,
    resolution: incident.resolution,
    createdAt: incident.createdAt,
    updatedAt: incident.updatedAt
  };
}

export const listIncidents = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = {};
  if (req.query.status) filter.status = String(req.query.status).toUpperCase();
  if (req.query.category) filter.category = String(req.query.category).toUpperCase();
  if (req.query.open === "true") filter.status = { $ne: "RESOLVED" };
  if (req.query.buildingCode) {
    const building = await Building.findOne({ code: String(req.query.buildingCode).toUpperCase() }).lean();
    filter.building = building?._id ?? null;
  }

  const [rows, total] = await Promise.all([
    Incident.find(filter).populate("building", "code name").sort({ risk: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
    Incident.countDocuments(filter)
  ]);

  return ok(res, { incidents: rows.map(shape), meta: pageMeta(page, limit, total) });
});

export const getIncident = asyncHandler(async (req, res) => {
  const incident = await Incident.findById(req.params.id).populate("building", "code name").lean();
  if (!incident) throw ApiError.notFound("No incident with that id");

  const complaints = await Complaint.find({ _id: { $in: incident.complaints || [] } })
    .select("reference title description status createdAt severity")
    .sort({ createdAt: 1 })
    .lean();

  return ok(res, {
    incident: shape(incident),
    complaints: complaints.map((c) => ({
      id: String(c._id),
      reference: c.reference,
      title: c.title,
      description: c.description,
      status: c.status,
      createdAt: c.createdAt
    }))
  });
});

/** GET /api/incidents/:id/complaints */
export const getIncidentComplaints = asyncHandler(async (req, res) => {
  const incident = await Incident.findById(req.params.id).select("complaints reference").lean();
  if (!incident) throw ApiError.notFound("No incident with that id");

  const complaints = await Complaint.find({
    $or: [{ _id: { $in: incident.complaints || [] } }, { relatedIncident: incident._id }]
  })
    .populate("student", "name studentId")
    .sort({ createdAt: 1 })
    .lean();

  return ok(res, {
    incident: { id: String(incident._id), reference: incident.reference },
    complaints: complaints.map((c) => ({
      id: String(c._id),
      reference: c.reference,
      title: c.title,
      description: c.description,
      status: c.status,
      severity: c.severity,
      createdAt: c.createdAt,
      student: c.student ? { name: c.student.name, studentId: c.student.studentId } : null
    }))
  });
});

export const createIncident = asyncHandler(async (req, res) => {
  const { buildingCode, building: buildingId, complaints = [], ...rest } = req.body;

  const building = buildingId
    ? await Building.findById(buildingId)
    : buildingCode
      ? await Building.findOne({ code: String(buildingCode).toUpperCase() })
      : null;

  const members = complaints.length
    ? await Complaint.find({ _id: { $in: complaints } }).select("createdAt severity").lean()
    : [];

  const firstComplaintAt = members.length
    ? members.map((c) => new Date(c.createdAt)).sort((a, b) => a - b)[0]
    : new Date();

  const incident = new Incident({
    ...rest,
    building: building?._id,
    complaints,
    firstComplaintAt,
    affectedStudents: rest.affectedStudents ?? Math.round((building?.occupancy || 0) * 0.42)
  });

  const risk = scoreIncident({
    complaintCount: complaints.length,
    ageDays: (Date.now() - firstComplaintAt) / 864e5,
    affectedStudents: incident.affectedStudents,
    severity: members[0]?.severity || "MODERATE",
    historicalCount: building?.historicalProblems || 0
  });
  incident.risk = rest.risk ?? risk.riskScore;
  incident.riskLevel = levelFor(incident.risk);

  const matches = await findMatches(incident, { limit: 4 });
  incident.historicalMatches = matches.map((match) => match.memory.id);
  incident.confidence = matches.length ? Math.max(incident.confidence || 0, matches[0].similarity) : incident.confidence;

  await incident.save();

  if (complaints.length) {
    await Complaint.updateMany({ _id: { $in: complaints } }, { relatedIncident: incident._id, status: "ASSIGNED" });
  }
  if (building) {
    building.currentRisk = Math.max(building.currentRisk, incident.risk);
    building.riskLevel = levelFor(building.currentRisk);
    await building.save();
  }

  const populated = await Incident.findById(incident._id).populate("building", "code name").lean();
  return created(res, { incident: shape(populated), riskFactors: risk.factors, historicalMatches: matches }, "Incident created");
});

export const updateIncident = asyncHandler(async (req, res) => {
  const incident = await Incident.findById(req.params.id);
  if (!incident) throw ApiError.notFound("No incident with that id");

  const { status, resolutionDescription, studentSatisfaction, recurrence, ...rest } = req.body;
  Object.assign(incident, rest);
  if (rest.risk !== undefined) incident.riskLevel = levelFor(rest.risk);

  if (status && status !== incident.status) incident.status = status;

  if (status === "RESOLVED") {
    const riskBefore = incident.risk;
    const openedAt = new Date(incident.firstComplaintAt || incident.createdAt);
    const hours = round((Date.now() - openedAt) / 36e5, 1);
    const complaintsAfterFix = await Complaint.countDocuments({
      relatedIncident: incident._id,
      createdAt: { $gte: new Date(Date.now() - 24 * 36e5) }
    });

    incident.resolution = {
      resolutionTimeHours: hours,
      resolvedBy: req.user._id,
      resolutionDescription,
      studentSatisfaction,
      riskBefore,
      riskAfter: Math.max(5, Math.round(riskBefore * 0.24)),
      recurrence: recurrence || "None in 14 days",
      complaintsAfterFix,
      resolvedAt: new Date()
    };
    incident.risk = incident.resolution.riskAfter;
    incident.riskLevel = "MITIGATED";

    await Complaint.updateMany(
      { relatedIncident: incident._id, status: { $ne: "RESOLVED" } },
      { status: "RESOLVED" }
    );

    const building = incident.building ? await Building.findById(incident.building) : null;
    // Resolution is the point at which the campus learns something.
    await remember(incident, { building, resolution: incident.resolution });

    if (building) {
      building.currentRisk = incident.risk;
      building.riskLevel = levelFor(building.currentRisk);
      building.historicalProblems += 1;
      building.activeProblems = Math.max(0, building.activeProblems - 1);
      await building.save();
    }
  }

  await incident.save();
  const populated = await Incident.findById(incident._id).populate("building", "code name").lean();
  return ok(res, { incident: shape(populated) }, "Incident updated");
});

/** GET /api/incidents/:id/investigation */
export const getInvestigation = asyncHandler(async (req, res) => {
  const report = await investigate(req.params.id);
  if (!report) throw ApiError.notFound("No incident with that id");
  return ok(res, report);
});

/** GET /api/incidents/:id/memory-match */
export const getMemoryMatch = asyncHandler(async (req, res) => {
  const incident = await Incident.findById(req.params.id).lean();
  if (!incident) throw ApiError.notFound("No incident with that id");

  const match = await bestMatch(incident);
  if (!match) {
    return ok(res, {
      matchedIncident: null,
      similarity: 0,
      matchingFactors: [],
      evidence: [],
      method: "WEIGHTED_DETERMINISTIC_SIMILARITY",
      message: "Campus memory holds no comparable incident yet"
    });
  }
  return ok(res, match);
});

/**
 * POST /api/incidents/cluster
 * Runs clustering over the complaint window. With `commit: true` it also writes
 * the clusters out as incidents; otherwise it is a dry run the UI can animate.
 */
export const runClustering = asyncHandler(async (req, res) => {
  const { buildingCode, category, windowDays, threshold, commit } = req.body;

  const building = buildingCode ? await Building.findOne({ code: buildingCode.toUpperCase() }).lean() : null;

  const result = await clusterComplaints({
    buildingId: building?._id,
    category,
    windowDays,
    threshold
  });

  if (!commit) return ok(res, { ...result, committed: false });

  const createdIncidents = [];
  for (const cluster of result.clusters) {
    const ids = cluster.complaints.map((c) => c.id);
    const existing = await Incident.findOne({ complaints: { $in: ids }, status: { $ne: "RESOLVED" } });
    if (existing) continue;

    const incident = await Incident.create({
      title: cluster.title,
      category: cluster.category,
      building: cluster.building?.id,
      complaints: ids,
      status: "CLUSTERED",
      risk: cluster.riskScore,
      riskLevel: cluster.riskLevel,
      confidence: cluster.averageOverlap,
      affectedStudents: cluster.affectedStudents,
      firstComplaintAt: cluster.firstComplaintAt,
      clusteredAt: new Date()
    });
    await Complaint.updateMany({ _id: { $in: ids } }, { relatedIncident: incident._id, status: "ASSIGNED" });
    createdIncidents.push({ id: String(incident._id), reference: incident.reference, title: incident.title });
  }

  return ok(res, { ...result, committed: true, createdIncidents });
});
