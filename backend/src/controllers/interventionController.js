import { Building } from "../models/Building.js";
import { Incident } from "../models/Incident.js";
import { Intervention } from "../models/Intervention.js";
import { CATEGORY_DEPARTMENTS } from "../services/classificationService.js";
import {
  compareScenarios,
  recommendAction,
  riskCurves,
  simulateScenario
} from "../services/interventionService.js";
import { investigate } from "../services/investigationService.js";
import { remember } from "../services/memoryService.js";
import { levelFor } from "../services/riskService.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { pageMeta, paginate } from "../utils/pagination.js";
import { created, ok } from "../utils/respond.js";
import { round } from "../utils/text.js";

function shape(intervention) {
  return {
    id: String(intervention._id),
    reference: intervention.reference,
    recommendedAction: intervention.recommendedAction,
    priority: intervention.priority,
    expectedImpact: intervention.expectedImpact,
    estimatedResolutionHours: intervention.estimatedResolutionHours,
    confidence: intervention.confidence,
    owner: intervention.owner,
    affectedStudents: intervention.affectedStudents,
    status: intervention.status,
    decision: intervention.decision,
    projection: intervention.projection,
    outcome: intervention.outcome,
    incident: intervention.incident?.reference
      ? {
          id: String(intervention.incident._id),
          reference: intervention.incident.reference,
          title: intervention.incident.title,
          risk: intervention.incident.risk,
          status: intervention.incident.status
        }
      : intervention.incident
        ? { id: String(intervention.incident) }
        : null,
    building: intervention.building?.code
      ? { id: String(intervention.building._id), code: intervention.building.code, name: intervention.building.name }
      : null,
    createdAt: intervention.createdAt,
    updatedAt: intervention.updatedAt
  };
}

export const listInterventions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = paginate(req.query);
  const filter = {};
  if (req.query.status) filter.status = String(req.query.status).toUpperCase();
  if (req.query.incident) filter.incident = req.query.incident;
  if (req.query.pending === "true") filter.status = "RECOMMENDED";

  const [rows, total] = await Promise.all([
    Intervention.find(filter)
      .populate("incident", "reference title risk status")
      .populate("building", "code name")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Intervention.countDocuments(filter)
  ]);

  return ok(res, { interventions: rows.map(shape), meta: pageMeta(page, limit, total) });
});

/** GET /api/interventions/:id — the recommendation and its what-if comparison. */
export const getIntervention = asyncHandler(async (req, res) => {
  const intervention = await Intervention.findById(req.params.id)
    .populate("incident", "reference title risk status affectedStudents category")
    .populate("building", "code name");

  if (!intervention) throw ApiError.notFound("No intervention with that id");

  const context = {
    currentRisk: intervention.incident?.risk ?? intervention.projection?.riskBefore ?? 50,
    affectedStudents: intervention.affectedStudents || intervention.incident?.affectedStudents || 0,
    confidence: intervention.confidence,
    repairHours: intervention.estimatedResolutionHours
  };

  return ok(res, {
    intervention: shape(intervention),
    comparison: compareScenarios(context),
    curves: riskCurves(context)
  });
});

/** POST /api/interventions — derive a recommendation for an incident. */
export const createIntervention = asyncHandler(async (req, res) => {
  const incident = await Incident.findById(req.body.incident);
  if (!incident) throw ApiError.notFound("No incident with that id");

  const building = incident.building ? await Building.findById(incident.building).lean() : null;
  const investigation = await investigate(incident._id);
  const suggested = recommendAction({ incident, building, investigation });

  const context = {
    currentRisk: incident.risk,
    affectedStudents: incident.affectedStudents,
    confidence: req.body.confidence ?? suggested.confidence,
    repairHours: req.body.estimatedResolutionHours ?? suggested.estimatedResolutionHours
  };
  const repairNow = simulateScenario({ ...context, scenario: "REPAIR_NOW" });

  const intervention = await Intervention.create({
    incident: incident._id,
    building: incident.building,
    recommendedAction: req.body.recommendedAction || suggested.recommendedAction,
    priority: req.body.priority || suggested.priority,
    expectedImpact: suggested.expectedImpact,
    estimatedResolutionHours: context.repairHours,
    confidence: context.confidence,
    owner: req.body.owner || CATEGORY_DEPARTMENTS[incident.category] || CATEGORY_DEPARTMENTS.OTHER,
    affectedStudents: incident.affectedStudents,
    projection: {
      riskBefore: incident.risk,
      riskAfter: repairNow.riskAfter,
      predictedComplaints: repairNow.predictedComplaints,
      affectedStudents: repairNow.affectedStudents
    }
  });

  if (incident.status !== "RESOLVED") {
    incident.status = "INTERVENTION";
    await incident.save();
  }

  const populated = await Intervention.findById(intervention._id)
    .populate("incident", "reference title risk status")
    .populate("building", "code name");

  return created(
    res,
    { intervention: shape(populated), comparison: compareScenarios(context), curves: riskCurves(context) },
    "Intervention recommended"
  );
});

export const updateIntervention = asyncHandler(async (req, res) => {
  const intervention = await Intervention.findById(req.params.id);
  if (!intervention) throw ApiError.notFound("No intervention with that id");

  const { resolutionTimeHours, studentSatisfaction, recurrence, status, ...rest } = req.body;
  Object.assign(intervention, rest);
  if (status) intervention.status = status;

  if (status === "COMPLETED") {
    const incident = await Intervention.findById(intervention._id).then((i) => Incident.findById(i.incident));
    const riskBefore = intervention.projection?.riskBefore ?? incident?.risk ?? 0;
    const riskAfter = intervention.projection?.riskAfter ?? Math.round(riskBefore * 0.24);

    intervention.outcome = {
      resolutionTimeHours: resolutionTimeHours ?? intervention.estimatedResolutionHours,
      studentSatisfaction,
      riskBefore,
      riskAfter,
      recurrence: recurrence || "None in 14 days",
      complaintsAfterFix: 0,
      completedAt: new Date()
    };

    if (incident) {
      incident.status = "RESOLVED";
      incident.risk = riskAfter;
      incident.riskLevel = "MITIGATED";
      incident.resolution = {
        resolutionTimeHours: intervention.outcome.resolutionTimeHours,
        resolvedBy: req.user._id,
        resolutionDescription: intervention.decision?.modifiedAction || intervention.recommendedAction,
        studentSatisfaction,
        riskBefore,
        riskAfter,
        recurrence: intervention.outcome.recurrence,
        complaintsAfterFix: 0,
        resolvedAt: new Date()
      };
      await incident.save();

      const building = incident.building ? await Building.findById(incident.building) : null;
      // Outcome recorded -> campus memory updated -> pattern stored.
      await remember(incident, { building, resolution: incident.resolution });
      if (building) {
        building.currentRisk = riskAfter;
        building.riskLevel = levelFor(riskAfter);
        building.activeProblems = Math.max(0, building.activeProblems - 1);
        building.historicalProblems += 1;
        await building.save();
      }
    }
  }

  await intervention.save();

  const populated = await Intervention.findById(intervention._id)
    .populate("incident", "reference title risk status")
    .populate("building", "code name");

  return ok(res, { intervention: shape(populated) }, "Intervention updated");
});

/**
 * POST /api/interventions/:id/decision
 * ACCEPT / MODIFY / REJECT. The human's answer is stored next to the AI's
 * recommendation rather than replacing it, including the reason for a refusal.
 */
export const decide = asyncHandler(async (req, res) => {
  const intervention = await Intervention.findById(req.params.id).populate("incident", "reference title risk affectedStudents");
  if (!intervention) throw ApiError.notFound("No intervention with that id");
  if (intervention.decision?.value) {
    throw ApiError.conflict(`This intervention was already ${intervention.decision.value.toLowerCase()}ed`);
  }

  const { decision, reason, modifiedAction, modifiedWindowHours } = req.body;

  if (decision === "REJECT" && !reason) {
    throw ApiError.badRequest("A rejection needs a reason — the campus learns from refusals too");
  }
  if (decision === "MODIFY" && !modifiedAction && modifiedWindowHours === undefined) {
    throw ApiError.badRequest("A modification needs either a modified action or a modified window");
  }

  intervention.decision = {
    value: decision,
    by: req.user._id,
    byName: req.user.name,
    at: new Date(),
    reason,
    modifiedAction,
    modifiedWindowHours
  };

  const windowHours = modifiedWindowHours ?? intervention.estimatedResolutionHours;
  const context = {
    currentRisk: intervention.incident?.risk ?? intervention.projection?.riskBefore ?? 50,
    affectedStudents: intervention.affectedStudents,
    confidence: intervention.confidence,
    repairHours: windowHours
  };

  let projection;
  if (decision === "REJECT") {
    intervention.status = "REJECTED";
    projection = simulateScenario({ ...context, scenario: "DO_NOTHING" });
  } else {
    intervention.status = decision === "MODIFY" ? "MODIFIED" : "ACCEPTED";
    if (decision === "MODIFY" && modifiedWindowHours !== undefined) {
      intervention.estimatedResolutionHours = modifiedWindowHours;
    }
    projection = simulateScenario({ ...context, scenario: "REPAIR_NOW", repairHours: windowHours });
    intervention.status = "IN_PROGRESS";
  }

  intervention.projection = {
    riskBefore: projection.riskBefore,
    riskAfter: projection.riskAfter,
    predictedComplaints: projection.predictedComplaints,
    affectedStudents: projection.affectedStudents
  };

  await intervention.save();

  // The chain the frontend animates: recommendation -> decision -> action -> outcome.
  const chain =
    decision === "REJECT"
      ? ["AI RECOMMENDATION", "HUMAN DECISION", "REJECTED", "CONTINUED MONITORING"]
      : decision === "MODIFY"
        ? ["AI RECOMMENDATION", "ADMIN MODIFIED", "INTERVENTION STARTED", "PREDICTED IMPACT"]
        : ["AI RECOMMENDATION", "ADMIN ACCEPTED", "INTERVENTION STARTED", "PREDICTED IMPACT"];

  const populated = await Intervention.findById(intervention._id)
    .populate("incident", "reference title risk status")
    .populate("building", "code name");

  return ok(
    res,
    {
      intervention: shape(populated),
      decision: intervention.decision,
      chain,
      projection,
      note:
        decision === "REJECT"
          ? `Rejected — "${reason}" recorded against ${intervention.incident?.reference || "this incident"}. The signal stays under monitoring.`
          : decision === "MODIFY"
            ? `Window modified to ${windowHours} hours. Projected risk ${projection.riskAfter}%.`
            : `Intervention started · ${intervention.owner || "owner unassigned"} · ${windowHours}h window. Projected risk ${projection.riskBefore}% → ${projection.riskAfter}%.`
    },
    "Decision recorded"
  );
});

/**
 * POST /api/interventions/simulate
 * Scenario comparison. Pass an incident id to run against live values, or pass
 * currentRisk/affectedStudents directly.
 */
export const simulate = asyncHandler(async (req, res) => {
  let { currentRisk, affectedStudents } = req.body;
  let incident = null;

  if (req.body.incident) {
    incident = await Incident.findById(req.body.incident).lean();
    if (!incident) throw ApiError.notFound("No incident with that id");
    currentRisk = currentRisk ?? incident.risk;
    affectedStudents = affectedStudents ?? incident.affectedStudents;
  }

  if (currentRisk === undefined) throw ApiError.badRequest("Pass either an incident id or a currentRisk");

  const context = {
    currentRisk,
    affectedStudents: affectedStudents ?? 0,
    confidence: incident?.confidence || 85,
    repairHours: 4
  };

  const comparison = compareScenarios(context);
  const requested = req.body.scenario
    ? simulateScenario({ ...context, scenario: req.body.scenario, delayHours: req.body.delayHours })
    : null;

  return ok(res, {
    incident: incident ? { id: String(incident._id), reference: incident.reference, title: incident.title } : null,
    ...comparison,
    requested,
    curves: riskCurves(context),
    kind: "AI PREDICTION"
  });
});

/** GET /api/interventions/:id/quality — resolution quality, not just RESOLVED. */
export const getQuality = asyncHandler(async (req, res) => {
  const intervention = await Intervention.findById(req.params.id).populate("incident", "reference title resolution risk");
  if (!intervention) throw ApiError.notFound("No intervention with that id");

  const outcome = intervention.outcome || intervention.incident?.resolution || {};

  return ok(res, {
    resolutionTimeHours: outcome.resolutionTimeHours ?? null,
    studentSatisfaction: outcome.studentSatisfaction ?? null,
    riskBefore: outcome.riskBefore ?? intervention.projection?.riskBefore ?? null,
    riskAfter: outcome.riskAfter ?? intervention.projection?.riskAfter ?? null,
    riskReduction:
      outcome.riskBefore && outcome.riskAfter !== undefined
        ? round(outcome.riskBefore - outcome.riskAfter)
        : null,
    recurrence: outcome.recurrence ?? null,
    complaintsAfterFix: outcome.complaintsAfterFix ?? null,
    completed: Boolean(outcome.completedAt || outcome.resolvedAt),
    note: "A status of RESOLVED is not evidence of resolution — every intervention is scored on time, satisfaction, risk reduction and recurrence."
  });
});
