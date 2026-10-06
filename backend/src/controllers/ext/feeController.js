import { asyncHandler } from "../../utils/asyncHandler.js";
import { ok } from "../../utils/respond.js";
import { duesSummary, myFees, sendFeeReminders } from "../../services/ext/feeService.js";

/** Fee & dues status (PS07 extension 1D). Read-only. */

export const mine = asyncHandler(async (req, res) => ok(res, await myFees(req.user)));
export const summary = asyncHandler(async (_req, res) => ok(res, await duesSummary()));
export const reminders = asyncHandler(async (req, res) => ok(res, { sent: await sendFeeReminders({ actor: req.user }) }));
