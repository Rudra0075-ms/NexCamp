import { STAFF_ROLES } from "../../config/constants.js";
import { ApiError } from "../../utils/ApiError.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { ok } from "../../utils/respond.js";
import { CampusEvent } from "../../models/xo/CampusEvent.js";
import { backfillEvents } from "../../services/xo/backfillService.js";
import { eventsFor, recentEvents } from "../../services/xo/eventService.js";

/** GET /api/xo/events — the latest campus events (staff). */
export const listEvents = asyncHandler(async (req, res) =>
  ok(res, await recentEvents({ type: req.query.type, subjectType: req.query.subjectType, channel: req.query.channel, limit: Number(req.query.limit) || 50 }))
);

/** GET /api/xo/events/:subjectType/:subjectId — one record's events (its owner or staff). */
export const subjectEvents = asyncHandler(async (req, res) => {
  const events = await eventsFor(req.params.subjectType, req.params.subjectId);
  const staff = STAFF_ROLES.includes(req.user.role);
  if (!staff && events.some((e) => e.studentId && String(e.studentId) !== String(req.user._id))) throw ApiError.forbidden("Not your record");
  return ok(res, { events, method: "CAMPUS_EVENT_LOG", kind: "ACTUAL DATA" });
});

/** POST /api/xo/events/backfill — derive events for older records (admin). */
export const runBackfill = asyncHandler(async (req, res) => ok(res, await backfillEvents({ actor: req.user }), "Events backfilled"));

/** GET /api/xo/events/summary — counts by type and origin (staff). */
export const eventSummary = asyncHandler(async (_req, res) => {
  const rows = await CampusEvent.aggregate([{ $group: { _id: { type: "$type", channel: "$channel", origin: "$origin" }, n: { $sum: 1 }, touches: { $sum: { $cond: ["$humanTouch", 1, 0] } } } }]);
  return ok(res, { rows: rows.map((r) => ({ ...r._id, count: r.n, humanTouches: r.touches })), method: "CAMPUS_EVENT_LOG", kind: "ACTUAL DATA" });
});
