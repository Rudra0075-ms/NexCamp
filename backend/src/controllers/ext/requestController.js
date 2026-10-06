import { asyncHandler } from "../../utils/asyncHandler.js";
import { ok } from "../../utils/respond.js";
import { myRequests, pendingQueue } from "../../services/ext/requestTrackerService.js";

/** Unified request tracker (PS07 extension 1E). Read-only. */

export const mine = asyncHandler(async (req, res) => ok(res, await myRequests(req.user)));
export const pending = asyncHandler(async (req, res) => ok(res, await pendingQueue(req.query)));
