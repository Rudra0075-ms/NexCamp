import { Building } from "../models/Building.js";
import { Complaint } from "../models/Complaint.js";
import { Incident } from "../models/Incident.js";
import { listOpen } from "../services/anomalyDetectionService.js";
import { campusHealth } from "../services/riskService.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ok } from "../utils/respond.js";

function shape(building, extras = {}) {
  return {
    id: String(building._id),
    code: building.code,
    mapId: building.mapId,
    name: building.name,
    type: building.type,
    domain: building.domain,
    location: building.location,
    capacity: building.capacity,
    occupancy: building.occupancy,
    currentRisk: building.currentRisk,
    riskLevel: building.riskLevel,
    activeProblems: building.activeProblems,
    historicalProblems: building.historicalProblems,
    affectedStudents: building.affectedStudents,
    departments: building.departments,
    geometry: building.geometry,
    ...extras
  };
}

/**
 * GET /api/campus
 * One read that gives the campus map everything it draws: every block, its
 * current risk, its leading incident and the campus-wide headline figures.
 */
export const getCampus = asyncHandler(async (_req, res) => {
  const buildings = await Building.find().sort({ code: 1 }).lean();

  const leading = await Incident.aggregate([
    { $match: { status: { $ne: "RESOLVED" } } },
    { $sort: { risk: -1 } },
    {
      $group: {
        _id: "$building",
        incidentId: { $first: "$_id" },
        reference: { $first: "$reference" },
        title: { $first: "$title" },
        risk: { $first: "$risk" },
        status: { $first: "$status" },
        confidence: { $first: "$confidence" },
        affectedStudents: { $first: "$affectedStudents" },
        cause: { $first: { $arrayElemAt: ["$possibleCauses.cause", 0] } },
        openCount: { $sum: 1 }
      }
    }
  ]);
  const byBuilding = new Map(leading.map((row) => [String(row._id), row]));

  const complaintCounts = await Complaint.aggregate([
    { $group: { _id: "$building", total: { $sum: 1 }, open: { $sum: { $cond: [{ $ne: ["$status", "RESOLVED"] }, 1, 0] } } } }
  ]);
  const countsByBuilding = new Map(complaintCounts.map((row) => [String(row._id), row]));

  const [pendingComplaints, activeIncidents, anomalies] = await Promise.all([
    Complaint.countDocuments({ status: { $ne: "RESOLVED" } }),
    Incident.countDocuments({ status: { $ne: "RESOLVED" } }),
    listOpen({ limit: 10 })
  ]);

  const health = campusHealth({
    risks: buildings.map((b) => b.currentRisk),
    pendingComplaints,
    activeIncidents
  });

  const resolved = await Incident.find({ "resolution.resolutionTimeHours": { $exists: true } })
    .select("resolution.resolutionTimeHours")
    .lean();
  const averageResolutionHours = resolved.length
    ? Math.round((resolved.reduce((t, i) => t + i.resolution.resolutionTimeHours, 0) / resolved.length) * 10) / 10
    : null;

  return ok(res, {
    campus: {
      name: "BPUT CAMPUS · ROURKELA",
      students: buildings.reduce((total, b) => total + (b.occupancy || 0), 0),
      blocks: buildings.length,
      health: health.health,
      worstRisk: health.worstRisk,
      activeIncidents,
      pendingComplaints,
      criticalProblems: buildings.filter((b) => b.currentRisk >= 85).length,
      averageResolutionHours,
      method: health.method
    },
    buildings: buildings.map((building) => {
      const lead = byBuilding.get(String(building._id));
      const counts = countsByBuilding.get(String(building._id));
      return shape(building, {
        incident: lead?.title || "No active incident",
        incidentId: lead?.incidentId ? String(lead.incidentId) : null,
        incidentReference: lead?.reference || null,
        openIncidents: lead?.openCount || 0,
        complaints: counts?.total || 0,
        openComplaints: counts?.open || 0,
        affected: lead?.affectedStudents || building.affectedStudents || 0,
        confidence: lead?.confidence || 0,
        cause: lead?.cause || "—"
      });
    }),
    anomalies
  });
});

export const listBuildings = asyncHandler(async (_req, res) => {
  const buildings = await Building.find().sort({ code: 1 }).lean();
  return ok(res, { buildings: buildings.map((b) => shape(b)) });
});

/** GET /api/buildings/:id — accepts an ObjectId, a code or a map id. */
export const getBuilding = asyncHandler(async (req, res) => {
  const key = req.params.id;
  const building =
    (await Building.findById(key).lean().catch(() => null)) ||
    (await Building.findOne({ $or: [{ code: key.toUpperCase() }, { mapId: key.toLowerCase() }] }).lean());

  if (!building) throw ApiError.notFound("No building with that id or code");

  const [incidents, complaints] = await Promise.all([
    Incident.find({ building: building._id }).sort({ risk: -1 }).limit(10).lean(),
    Complaint.countDocuments({ building: building._id })
  ]);

  return ok(res, {
    building: shape(building, { complaints }),
    incidents: incidents.map((incident) => ({
      id: String(incident._id),
      reference: incident.reference,
      title: incident.title,
      status: incident.status,
      risk: incident.risk,
      complaintCount: incident.complaints?.length || 0,
      affectedStudents: incident.affectedStudents
    }))
  });
});
