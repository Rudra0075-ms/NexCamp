import { MessFeedback } from "../models/MessFeedback.js";
import { MessRecord } from "../models/MessRecord.js";
import { analytics, demandCurve, staggerProjection } from "../services/messService.js";
import { classifyFeedback, dateKey, messIntelligence, simulateScenario, startOfDay } from "../services/messIntelligenceService.js";
import { ApiError } from "../utils/ApiError.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { created, ok } from "../utils/respond.js";

/** GET /api/mess — today's slots, or ?date=YYYY-MM-DD. */
export const getMess = asyncHandler(async (req, res) => {
  const curve = await demandCurve(req.query.date ? new Date(req.query.date) : new Date());
  return ok(res, curve);
});

/** GET /api/mess/demand — the curve plus the staggering recommendation. */
export const getDemand = asyncHandler(async (req, res) => {
  const curve = await demandCurve(req.query.date ? new Date(req.query.date) : new Date());
  return ok(res, {
    ...curve,
    recommendation: staggerProjection(curve),
    kind: "AI RECOMMENDATION"
  });
});

/** GET /api/mess/analytics — rolling averages across the last N days. */
export const getAnalytics = asyncHandler(async (req, res) => {
  const days = Math.min(60, Math.max(1, Number(req.query.days) || 7));
  return ok(res, await analytics({ days }));
});

/** POST /api/mess — mess staff record one slot. */
export const createMessRecord = asyncHandler(async (req, res) => {
  const date = req.body.date || new Date();
  date.setHours?.(0, 0, 0, 0);

  const record = await MessRecord.findOneAndUpdate(
    { date, time: req.body.time },
    { ...req.body, date, demand: req.body.crowd },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
  );

  clearMessIntelCache();
  return created(res, { record }, "Mess record saved");
});

// The intelligence read is a few hundred rows folded in memory. A short cache
// keeps the dashboard and the Mess page from recomputing it back to back; any
// write below clears it.
const intelCache = new Map();
const INTEL_TTL_MS = 15000;
export function clearMessIntelCache() {
  intelCache.clear();
}

const MEALS = ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"];

/**
 * GET /api/mess/intelligence?meal=&date=&days=&feedbackMeal=&feedbackTheme=
 * Today's meals with demand classes, a prediction for the chosen meal and
 * date, feedback themes and rising patterns, popularity and availability.
 */
export const getIntelligence = asyncHandler(async (req, res) => {
  const meal = MEALS.includes(String(req.query.meal || "").toUpperCase()) ? String(req.query.meal).toUpperCase() : null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date || "")) ? String(req.query.date) : null;
  const days = [7, 14, 28].includes(Number(req.query.days)) ? Number(req.query.days) : 28;
  const feedbackMeal = MEALS.includes(String(req.query.feedbackMeal || "").toUpperCase()) ? String(req.query.feedbackMeal).toUpperCase() : null;
  const feedbackTheme = /^[A-Z]{3,14}$/.test(String(req.query.feedbackTheme || "").toUpperCase()) ? String(req.query.feedbackTheme).toUpperCase() : null;

  const key = JSON.stringify({ meal, date, days, feedbackMeal, feedbackTheme, day: dateKey(new Date()) });
  const hit = intelCache.get(key);
  if (hit && Date.now() - hit.at < INTEL_TTL_MS) return ok(res, hit.data);

  const data = await messIntelligence({ meal, date, days, feedbackMeal, feedbackTheme });
  intelCache.set(key, { at: Date.now(), data });
  return ok(res, data);
});

/** POST /api/mess/simulate — a what-if for one meal. Writes nothing. */
export const simulateMess = asyncHandler(async (req, res) => {
  const date = req.body.date ? dateKey(new Date(req.body.date)) : undefined;
  return ok(res, await simulateScenario({ ...req.body, date }));
});

/** POST /api/mess/feedback — a student rates one meal. One rating per meal per day. */
export const submitMessFeedback = asyncHandler(async (req, res) => {
  const { meal, rating, comment } = req.body;
  const date = startOfDay(req.body.date ? new Date(req.body.date) : new Date());
  if (date.getTime() > Date.now()) throw ApiError.badRequest("You can only rate a meal that has been served");
  const { themes, sentiment, method } = classifyFeedback({ comment, rating });
  const feedback = await MessFeedback.findOneAndUpdate(
    { student: req.user._id, date, meal },
    { student: req.user._id, date, meal, rating, comment: comment || undefined, themes, sentiment, method },
    { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true }
  ).lean();
  clearMessIntelCache();
  return created(res, {
    feedback: { id: String(feedback._id), date: dateKey(feedback.date), meal, rating, comment: feedback.comment || null, themes, sentiment, method }
  }, "Thanks — your rating is recorded");
});
