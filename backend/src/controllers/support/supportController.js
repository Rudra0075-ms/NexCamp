import { asyncHandler } from "../../utils/asyncHandler.js";
import { created, ok } from "../../utils/respond.js";
import { ApiError } from "../../utils/ApiError.js";
import { supportResources } from "../../services/support/supportConfig.js";
import * as support from "../../services/support/supportService.js";

/**
 * Silent Support System controllers. Thin on purpose: every privacy rule is in
 * services/support/supportService.js, and the route layer decides who may call
 * what (routes/support/index.js).
 */

export const me = asyncHandler(async (req, res) => ok(res, await support.studentState(req.user)));

export const checkIn = asyncHandler(async (req, res) => {
  const { unsafe, ...answers } = req.body;
  if (!unsafe && !Object.keys(answers).length) throw ApiError.badRequest("Answer at least one question, or skip the check-in.");
  return created(res, await support.recordCheckIn(req.user, { answers, unsafe: Boolean(unsafe) }));
});

export const request = asyncHandler(async (req, res) => {
  const result = await support.createRequest(req.user, req.body);
  return (result.existing ? ok : created)(res, result, result.existing ? "You already have an open support request." : "Your private support request has been received.");
});

export const checkLater = asyncHandler(async (req, res) =>
  created(res, await support.createRequest(req.user, { preference: "CHECK_LATER", followUpDays: req.body.days }), "We'll check on you later.")
);

export const withdraw = asyncHandler(async (req, res) => ok(res, await support.withdrawRequest(req.user, req.params.id)));

export const resources = asyncHandler(async (_req, res) => ok(res, supportResources()));

export const queue = asyncHandler(async (req, res) =>
  ok(res, await support.teamQueue(req.user, { includeClosed: req.query.closed === true || req.query.closed === "true" }))
);

export const move = asyncHandler(async (req, res) => ok(res, await support.moveCase(req.user, req.params.id, req.body)));

export const overview = asyncHandler(async (req, res) => ok(res, await support.overview(req.user, { days: req.query.days || 30 })));
