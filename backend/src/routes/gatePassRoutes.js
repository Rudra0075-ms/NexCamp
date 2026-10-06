import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  approveGatePass,
  cancelGatePass,
  createGatePass,
  gatePassConfig,
  gatePassSummary,
  getGatePass,
  getGatePassQr,
  getGatePassStatus,
  listGatePassNotifications,
  listGatePasses,
  readGatePassNotification,
  rejectGatePass,
  scanGatePass,
  sendGatePassOtp,
  verifyGatePassOtp
} from "../controllers/gatePassController.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { GATE_PASS_APPROVER_ROLES, STAFF_ROLES } from "../config/constants.js";
import {
  createGatePassSchema,
  gatePassDecisionSchema,
  idParamSchema,
  scanGatePassSchema,
  verifyOtpSchema
} from "../validations/index.js";

const router = Router();

// Every gate-pass surface needs an account. Role checks happen per route and,
// for ownership, again inside the controller.
router.use(authenticate);

// One-time codes get their own budget, tighter than the app-wide limiter.
const otpLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 12,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many verification attempts — wait a few minutes" }
});

const scanLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many scans — slow down for a moment" }
});

router.get("/config", gatePassConfig);
router.get("/notifications", listGatePassNotifications);
router.post("/notifications/:id/read", validate(idParamSchema, "params"), readGatePassNotification);
router.get("/summary", authorize(STAFF_ROLES), gatePassSummary);

router.post("/", validate(createGatePassSchema), createGatePass);
router.get("/", listGatePasses);

// Declared before "/:id" so the literal path is not swallowed by the parameter.
router.post("/scan", scanLimiter, validate(scanGatePassSchema), scanGatePass);

router.get("/:id", validate(idParamSchema, "params"), getGatePass);
router.get("/:id/status", validate(idParamSchema, "params"), getGatePassStatus);
router.get("/:id/qr", validate(idParamSchema, "params"), getGatePassQr);

router.post("/:id/send-otp", otpLimiter, validate(idParamSchema, "params"), sendGatePassOtp);
router.post("/:id/verify-otp", otpLimiter, validate(idParamSchema, "params"), validate(verifyOtpSchema), verifyGatePassOtp);
router.post("/:id/cancel", validate(idParamSchema, "params"), cancelGatePass);

router.post(
  "/:id/approve",
  authorize(GATE_PASS_APPROVER_ROLES),
  validate(idParamSchema, "params"),
  validate(gatePassDecisionSchema),
  approveGatePass
);
router.post(
  "/:id/reject",
  authorize(GATE_PASS_APPROVER_ROLES),
  validate(idParamSchema, "params"),
  validate(gatePassDecisionSchema),
  rejectGatePass
);

export default router;
