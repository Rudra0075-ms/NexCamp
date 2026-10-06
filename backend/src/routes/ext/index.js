import { Router } from "express";
import noticeRoutes from "./noticeRoutes.js";
import { documentRouter, verifyRouter } from "./documentRoutes.js";
import { messMenuRouter, timetableRouter } from "./timetableRoutes.js";
import feeRoutes from "./feeRoutes.js";
import requestRoutes from "./requestRoutes.js";
import { adoptionRouter, boardRouter, faqRouter, fixRouter, frictionRouter, smsRouter } from "./phase2Routes.js";

/**
 * Every route added by the PS07 extension pack. Mounted by one hook line in
 * routes/index.js; none of these paths overlaps an existing router.
 */
const router = Router();

router.use("/notices", noticeRoutes);
router.use("/documents", documentRouter);
router.use("/verify", verifyRouter);
router.use("/timetable", timetableRouter);
router.use("/mess-menu", messMenuRouter);
router.use("/fees", feeRoutes);
router.use("/requests", requestRoutes);
router.use("/friction", frictionRouter);
router.use("/sms", smsRouter);
router.use("/fix", fixRouter);
router.use("/faq", faqRouter);
router.use("/board", boardRouter);
router.use("/adoption", adoptionRouter);

export default router;
