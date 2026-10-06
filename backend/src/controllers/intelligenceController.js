import { forEntity, relationships } from "../services/intelligenceService.js";
import { answer, SUPPORTED_QUESTIONS } from "../services/queryService.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ok } from "../utils/respond.js";

/** GET /api/intelligence/relationships */
export const getRelationships = asyncHandler(async (req, res) => {
  const graph = await relationships({ chain: req.query.chain });
  return ok(res, graph);
});

/** GET /api/intelligence/:entityType/:entityId */
export const getEntityIntelligence = asyncHandler(async (req, res) => {
  const { entityType, entityId } = req.params;
  const allowed = ["Building", "Incident", "Complaint", "Student"];
  const normalised = allowed.find((item) => item.toLowerCase() === entityType.toLowerCase());
  if (!normalised) throw ApiError.badRequest(`entityType must be one of: ${allowed.join(", ")}`);

  const result = await forEntity(normalised, entityId);
  if (!result) throw ApiError.notFound("No such entity");
  return ok(res, result);
});

/** POST /api/intelligence/query — the campus command bar. */
export const query = asyncHandler(async (req, res) => {
  const result = await answer(req.body.question);
  return ok(res, { ...result, supportedQuestions: SUPPORTED_QUESTIONS });
});

/** GET /api/intelligence/questions — what the query service can actually answer. */
export const listQuestions = asyncHandler(async (_req, res) =>
  ok(res, {
    questions: SUPPORTED_QUESTIONS,
    method: "RULE_BASED_INTENT_MATCH",
    disclaimer: "These are the question shapes the rule-based matcher recognises today."
  })
);
