import { asyncHandler } from "../../utils/asyncHandler.js";
import { ok } from "../../utils/respond.js";
import { reachSummary, tuesdayCompare } from "../../services/xo/tuesdayService.js";

/** POST /api/xo/tuesday/compare — this run's stopwatch and event log against the ledger's old paths. */
export const compareRun = asyncHandler(async (req, res) => ok(res, await tuesdayCompare(req.body.steps)));

/** GET /api/xo/tuesday/reach/:id — a notice's reach funnel, counts only. */
export const reach = asyncHandler(async (req, res) => ok(res, await reachSummary(req.user, req.params.id)));
