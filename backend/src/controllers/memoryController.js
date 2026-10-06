import { CampusMemory } from "../models/CampusMemory.js";
import { Incident } from "../models/Incident.js";
import { findMatches } from "../services/memoryService.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { pageMeta, paginate } from "../utils/pagination.js";
import { ok } from "../utils/respond.js";

function shape(memory) {
  return {
    id: String(memory._id),
    incidentReference: memory.incidentReference,
    occurredOn: memory.occurredOn,
    incidentType: memory.incidentType,
    category: memory.category,
    building: memory.building?.code
      ? { id: String(memory.building._id), code: memory.building.code, name: memory.building.name }
      : null,
    buildingName: memory.buildingName,
    cause: memory.cause,
    resolution: memory.resolution,
    resolutionTimeHours: memory.resolutionTimeHours,
    outcome: memory.outcome,
    riskBefore: memory.riskBefore,
    riskAfter: memory.riskAfter,
    studentSatisfaction: memory.studentSatisfaction,
    recurrence: memory.recurrence,
    recurrenceCount: memory.recurrenceCount,
    signatures: memory.signatures
  };
}

/** GET /api/memory — everything the campus remembers. */
export const listMemory = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = {};
  if (req.query.category) filter.category = String(req.query.category).toUpperCase();
  if (req.query.buildingCode) {
    const { Building } = await import("../models/Building.js");
    const building = await Building.findOne({ code: String(req.query.buildingCode).toUpperCase() }).lean();
    filter.building = building?._id ?? null;
  }

  const [rows, total] = await Promise.all([
    CampusMemory.find(filter).populate("building", "code name").sort({ occurredOn: -1 }).skip(skip).limit(limit).lean(),
    CampusMemory.countDocuments(filter)
  ]);

  return ok(res, { memory: rows.map(shape), meta: pageMeta(page, limit, total) });
});

/**
 * GET /api/memory/matches?incident=<id>
 * Historical incidents similar to the one given, with the factors behind each
 * similarity score.
 */
export const getMatches = asyncHandler(async (req, res) => {
  const { incident: incidentId, category, buildingCode, title } = req.query;

  let incident;
  if (incidentId) {
    incident = await Incident.findById(incidentId).lean();
    if (!incident) throw ApiError.notFound("No incident with that id");
  } else if (category || title) {
    const { Building } = await import("../models/Building.js");
    const building = buildingCode
      ? await Building.findOne({ code: String(buildingCode).toUpperCase() }).lean()
      : null;
    incident = {
      title: title || "",
      description: "",
      category: category ? String(category).toUpperCase() : undefined,
      building: building?._id
    };
  } else {
    throw ApiError.badRequest("Pass either ?incident=<id> or ?category= and/or ?title=");
  }

  const matches = await findMatches(incident, { limit: Number(req.query.limit) || 4 });

  return ok(res, {
    matches,
    method: "WEIGHTED_DETERMINISTIC_SIMILARITY",
    disclaimer:
      "Similarity is a weighted sum of same-building, same-category, keyword overlap and recency. " +
      "It is not a learned embedding distance."
  });
});
