import { asyncHandler } from "../../utils/asyncHandler.js";
import { ok } from "../../utils/respond.js";
import { outbox as listOutbox, staffPhones as listStaffPhones } from "../../services/xo/smsStaffService.js";

/** GET /api/xo/sms/outbox — campus-initiated SMS (a student sees only their own). */
export const outbox = asyncHandler(async (req, res) => ok(res, await listOutbox({ user: req.user })));

/** GET /api/xo/sms/staff-phones — registered staff numbers for the page-18 demo. */
export const staffPhones = asyncHandler(async (_req, res) => ok(res, { phones: await listStaffPhones(), note: "Demo numbers in an unallocated placeholder range." }));
