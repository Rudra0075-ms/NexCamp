import { Router } from "express";
import rateLimit from "express-rate-limit";
import { ROLES } from "../config/constants.js";
import { aiConfigured } from "../config/env.js";
import {
  copilot,
  copilotQuestions,
  getAnomalies,
  getAudit,
  getGatePassRisk,
  getNotifications,
  getPredictions,
  getRecurring,
  getRootCause,
  getStatus,
  getStudentGatePassRisk,
  getSummary,
  getTimeline,
  getCorrelations,
  getDataQuality,
  getDigitalTwin,
  getDigitalTwinNode,
  getFeedbackIntel,
  getSla,
  getWorkload,
  runSimulation
} from "../controllers/aiController.js";
import { actOnAlert, getEarlyWarning, getPredictive, getPulse, getWhy } from "../controllers/earlyWarningController.js";
import { authenticate, authorize, authorizeStaff } from "../middleware/auth.js";
import { cacheable, lite, noStore } from "../middleware/bandwidth.js";
import { validate } from "../middleware/validate.js";
import { alertActionSchema, copilotSchema, simulationSchema, timelineParamSchema, whyQuerySchema } from "../validations/index.js";

const router = Router();

// Anything that can reach a paid provider gets its own budget, well under the
// app-wide limiter, so one signed-in account cannot spend the AI quota.
//
// With no provider configured there is no quota to protect, so the budget is
// skipped and only the app-wide limiter applies — a Mission Control load reads
// several of these at once and must not trip itself.
const modelLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  skip: () => !aiConfigured(),
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many AI requests — slow down for a moment" }
});

// Every AI surface needs an account. Nothing here is public.
router.use(authenticate);

// Feature 12: ?lite=1 trims the evidence arrays out of the analysis reads, for
// a device on a bad connection. Applied per route, never globally: the audit
// chain and the gate-pass records must always arrive complete, because a
// trimmed audit chain cannot be verified and trimmed records cannot be reviewed.

// Readable by any signed-in user: the interface has to be able to say whether
// the AI service is configured. Reports the provider and model only, never a key.
router.get("/status", cacheable(60), getStatus);

// The caller's own notifications, graded by priority.
router.get("/notifications", noStore, lite, getNotifications);

// A student may read the timeline of their own complaint or gate pass; the
// controller enforces ownership on top of this.
router.get("/timeline/:kind/:id", validate(timelineParamSchema, "params"), getTimeline);

// ---- staff only -----------------------------------------------------------
// Campus-wide intelligence. A student reaching any of these gets a 403.
router.get("/recurring", authorizeStaff, cacheable(60), lite, getRecurring);
router.get("/root-cause/:buildingCode/:category", authorizeStaff, cacheable(120), modelLimiter, getRootCause);
router.get("/summary", authorizeStaff, cacheable(45), lite, modelLimiter, getSummary);
router.get("/anomalies", authorizeStaff, cacheable(60), lite, modelLimiter, getAnomalies);
router.get("/predictions", authorizeStaff, cacheable(300), lite, modelLimiter, getPredictions);

router.get("/copilot/questions", authorizeStaff, cacheable(600), copilotQuestions);
router.post("/copilot", authorizeStaff, modelLimiter, validate(copilotSchema), copilot);

// Gate-pass risk signals are a warden/administrator surface.
router.get("/gatepass-risk", authorize(ROLES.WARDEN, ROLES.ADMIN, ROLES.COUNSELLOR), noStore, modelLimiter, getGatePassRisk);
router.get("/gatepass-risk/:studentId", authorize(ROLES.WARDEN, ROLES.ADMIN, ROLES.COUNSELLOR), noStore, modelLimiter, getStudentGatePassRisk);

// Operational intelligence (Features 8, 9, 10, 11, 17).
// ?lite=1 trims only the row lists; every count is computed before trimming.
router.get("/sla", authorizeStaff, cacheable(60), lite, modelLimiter, getSla);
router.get("/workload", authorizeStaff, cacheable(60), lite, modelLimiter, getWorkload);
router.get("/digital-twin", authorizeStaff, cacheable(30), getDigitalTwin);
router.get("/digital-twin/:code", authorizeStaff, cacheable(30), getDigitalTwinNode);
router.get("/correlations", authorizeStaff, cacheable(120), modelLimiter, getCorrelations);
router.get("/feedback", authorizeStaff, cacheable(60), modelLimiter, getFeedbackIntel);

// ---- administrators only --------------------------------------------------
// The audit chain names who did what; only an administrator reads it.
router.get("/audit", authorize(ROLES.ADMIN), noStore, getAudit);
// Feature 12: the what-if simulator, and Feature 15: the data quality guardian.
router.post("/simulate", authorize(ROLES.ADMIN), noStore, modelLimiter, validate(simulationSchema), runSimulation);
// PS07: early warning, predictive insights, Campus Pulse and WHY? explanations.
// Rule-based over stored records, so no model budget is spent.
router.get("/early-warning", authorizeStaff, noStore, getEarlyWarning);
router.post("/early-warning/act", authorizeStaff, noStore, validate(alertActionSchema), actOnAlert);
router.get("/predictive", authorizeStaff, noStore, getPredictive);
router.get("/pulse", authorizeStaff, noStore, getPulse);
router.get("/why", authorizeStaff, noStore, validate(whyQuerySchema, "query"), getWhy);
router.get("/data-quality", authorize(ROLES.ADMIN), noStore, modelLimiter, getDataQuality);

export default router;
