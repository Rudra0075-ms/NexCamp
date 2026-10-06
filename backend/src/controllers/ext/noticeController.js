import { ApiError } from "../../utils/ApiError.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { created, ok } from "../../utils/respond.js";
import {
  cancelNotice,
  createNotice,
  dashboard,
  duplicateCheck,
  feedFor,
  listForStaff,
  markReceipt,
  quietHoursRule,
  reachPreview
} from "../../services/ext/noticeService.js";
import { runSweep } from "../../services/ext/extMonitor.js";

/** Notice Center (PS07 extension 1A). */

export const listNotices = asyncHandler(async (_req, res) => ok(res, await listForStaff()));

export const previewNotice = asyncHandler(async (req, res) => {
  const reach = await reachPreview(req.body.audience || {});
  const duplicates = req.body.title || req.body.body ? await duplicateCheck({ ...req.body, audience: reach.audience }) : { duplicates: [] };
  return ok(res, { ...reach, duplicateCheck: duplicates });
});

export const createNoticeHandler = asyncHandler(async (req, res) => {
  const dup = await duplicateCheck(req.body);
  if (dup.duplicates.length && !req.body.confirmDuplicate) {
    throw new ApiError(409, "A similar notice went to an overlapping audience in the last 7 days. Send again with confirmDuplicate: true to publish anyway.", dup);
  }
  const notice = await createNotice(req.body, req.user);
  return created(
    res,
    { id: String(notice._id), reference: notice.reference, status: notice.status, reach: notice.reach, releaseAt: notice.releaseAt || null, scheduledFor: notice.scheduledFor || null, duplicateOverride: dup.duplicates.length > 0 },
    notice.status === "HELD_QUIET_HOURS" ? "Held for quiet hours — goes out in the 07:30 morning digest" : notice.status === "SCHEDULED" ? "Scheduled" : "Published"
  );
});

export const noticeDashboard = asyncHandler(async (req, res) => ok(res, await dashboard(req.params.id)));

export const cancelNoticeHandler = asyncHandler(async (req, res) => ok(res, await cancelNotice(req.params.id, req.user, req.body.reason)));

export const myFeed = asyncHandler(async (req, res) => ok(res, await feedFor(req.user)));

export const markStep = (step) =>
  asyncHandler(async (req, res) => ok(res, await markReceipt(req.user, req.params.id, step)));

export const rules = asyncHandler(async (_req, res) => ok(res, quietHoursRule()));

export const sweepNow = asyncHandler(async (req, res) => ok(res, await runSweep({ actor: req.user })));
