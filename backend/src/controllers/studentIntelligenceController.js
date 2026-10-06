import { answerQuestion, studentSummary } from "../services/studentIntelligenceService.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ok } from "../utils/respond.js";

/**
 * GET /api/students/me/intelligence?window=14
 * The dashboard's intelligence summary for the signed-in student.
 */
export const myIntelligence = asyncHandler(async (req, res) => {
  const windowDays = [7, 14, 30].includes(Number(req.query.window)) ? Number(req.query.window) : 14;
  return ok(res, await studentSummary(req.user, { windowDays }));
});

/**
 * POST /api/students/me/query { question, domain? }
 * A natural-language question about the student's own attendance or the mess.
 */
export const askQuestion = asyncHandler(async (req, res) => {
  const domainHint = ["ATTENDANCE", "MESS"].includes(req.body.domain) ? req.body.domain : null;
  return ok(res, await answerQuestion(req.user, req.body.question, { domainHint }));
});
