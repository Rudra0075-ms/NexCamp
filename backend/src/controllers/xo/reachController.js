import { asyncHandler } from "../../utils/asyncHandler.js";
import { created, ok } from "../../utils/respond.js";
import { phoneFor } from "../../services/ext/extMonitor.js";
import { classRepList, createReachNotice, hygiene, kioskList, markReadAtKiosk, reachFunnel, reachSweep } from "../../services/xo/reachService.js";

export const noticeHygiene = asyncHandler(async (req, res) => ok(res, await hygiene(req.body)));
export const createNotice = asyncHandler(async (req, res) => {
  const notice = await createReachNotice(req.body, req.user);
  return created(res, { id: String(notice._id), reference: notice.reference, status: notice.status, reach: notice.reach, releaseAt: notice.releaseAt || null, scheduledFor: notice.scheduledFor || null, reachTarget: notice.reachTarget || null, supersedes: notice.supersedes || null, quietHoursOverride: notice.quietHoursOverride || null }, `${notice.reference} ${notice.status.toLowerCase().replace(/_/g, " ")}`);
});
export const funnel = asyncHandler(async (req, res) => ok(res, await reachFunnel(req.params.id)));
export const sweep = asyncHandler(async (_req, res) => ok(res, await reachSweep({ phoneFor }), "Reach ladder swept"));
export const kiosk = asyncHandler(async (_req, res) => ok(res, await kioskList()));
export const kioskRead = asyncHandler(async (req, res) => ok(res, await markReadAtKiosk(req.user, req.body.reference, req.body.studentId), "Marked read at the kiosk"));
export const classRep = asyncHandler(async (req, res) => ok(res, await classRepList(req.user)));
