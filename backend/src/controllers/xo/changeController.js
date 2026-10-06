import { asyncHandler } from "../../utils/asyncHandler.js";
import { created, ok } from "../../utils/respond.js";
import { changesFor, listChanges, planShutdown } from "../../services/xo/changeService.js";

export const list = asyncHandler(async (_req, res) => ok(res, await listChanges()));
export const mine = asyncHandler(async (req, res) => ok(res, await changesFor(req.user)));
export const shutdown = asyncHandler(async (req, res) => {
  const event = await planShutdown(req.user, req.body);
  return created(res, { reference: event.reference, title: event.title, window: event.window, notice: event.notice }, `${event.reference}: ${event.title} — notice ${event.notice.reference} to ${event.notice.reach}`);
});
