import { Router } from "express";
import { authenticate, authorize, authorizeStaff } from "../../middleware/auth.js";
import { lite, noStore } from "../../middleware/bandwidth.js";
import { validate } from "../../middleware/validate.js";
import { idParamSchema } from "../../validations/index.js";
import * as c from "../../controllers/ext/noticeController.js";
import { noticeCreateSchema, noticePreviewSchema, reasonSchema } from "./validators.js";

const router = Router();
router.use(authenticate, noStore);

// Recipients (any signed-in account).
router.get("/feed", lite, c.myFeed);
router.get("/rules", c.rules);
router.post("/:id/read", validate(idParamSchema, "params"), c.markStep("read"));
router.post("/:id/ack", validate(idParamSchema, "params"), c.markStep("ack"));
router.post("/:id/done", validate(idParamSchema, "params"), c.markStep("done"));

// Staff.
router.get("/", authorizeStaff, lite, c.listNotices);
router.post("/preview", authorizeStaff, validate(noticePreviewSchema), c.previewNotice);
router.post("/", authorizeStaff, validate(noticeCreateSchema), c.createNoticeHandler);
router.post("/sweep", authorize("ADMIN"), c.sweepNow);
router.get("/:id/dashboard", authorizeStaff, validate(idParamSchema, "params"), lite, c.noticeDashboard);
router.post("/:id/cancel", authorizeStaff, validate(idParamSchema, "params"), validate(reasonSchema), c.cancelNoticeHandler);

export default router;
