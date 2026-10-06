import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate, authorize, authorizeStaff, optionalAuth } from "../../middleware/auth.js";
import { lite, noStore } from "../../middleware/bandwidth.js";
import { validate } from "../../middleware/validate.js";
import { ApiError } from "../../utils/ApiError.js";
import { idParamSchema } from "../../validations/index.js";
import { arrayOf, integer, number, oneOf, optional, required, schema, string } from "../../validations/rules.js";
import * as c from "../../controllers/ext/phase2Controller.js";

const limiter = (limit, message) => rateLimit({ windowMs: 60 * 1000, limit, standardHeaders: "draft-7", legacyHeaders: false, message: { success: false, message } });

const stepShape = (value, field) => {
  if (!value || typeof value !== "object") return { error: `${field} must be an object` };
  const workflow = String(value.workflow || "").toUpperCase();
  const seconds = Number(value.seconds);
  if (!/^[A-Z_]{3,30}$/.test(workflow)) return { error: `${field}.workflow is not valid` };
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400) return { error: `${field}.seconds must be 0–86400` };
  return { value: { workflow, seconds, actions: Number.isFinite(Number(value.actions)) ? Math.min(50, Math.max(0, Number(value.actions))) : 1, label: String(value.label || "").slice(0, 80) || undefined, channel: value.channel === "SMS" ? "SMS" : "APP", reference: String(value.reference || "").slice(0, 40) || undefined } };
};

// ---- 2A Friction Ledger --------------------------------------------------------------
export const frictionRouter = Router();
frictionRouter.use(authenticate, noStore);
frictionRouter.get("/", authorizeStaff, lite, c.frictionLedger);
frictionRouter.patch(
  "/baselines/:workflow",
  authorize("ADMIN"),
  validate(schema({ hours: [optional, number(0, 2000)], studentActions: [optional, integer(0, 50)], studentMinutes: [optional, number(0, 10000)], source: [optional, string(400)], oldProcess: [optional, string(200)] })),
  c.frictionBaseline
);
frictionRouter.post("/compare", validate(schema({ steps: [required, arrayOf(stepShape, 20)] })), c.frictionCompare);

// ---- 2B SMS keyword channel ------------------------------------------------------------
export const smsRouter = Router();
// The provider webhook authenticates with a shared secret, not a user session.
smsRouter.post("/inbound", limiter(60, "Too many inbound messages"), c.smsInbound);
smsRouter.use(noStore);
smsRouter.post("/simulate", optionalAuth, limiter(40, "Too many simulated messages — wait a moment"), validate(schema({ from: [required, string(20)], text: [required, string(480)] })), c.smsSimulate);
smsRouter.get("/phones", optionalAuth, c.smsPhones);
smsRouter.get("/activity", authenticate, authorizeStaff, lite, c.smsActivity);

// ---- 2C Proof of fix and confirmation ------------------------------------------------
export const fixRouter = Router();
fixRouter.use(authenticate, noStore);
fixRouter.get("/mine", c.fixMine);
fixRouter.get("/metrics", authorizeStaff, lite, c.fixMetricsHandler);
fixRouter.get("/resolved", authorizeStaff, lite, c.fixResolved);
fixRouter.post("/reopen/:id", authorizeStaff, validate(idParamSchema, "params"), validate(schema({ status: [required, oneOf(["ACKNOWLEDGED", "CLOSED"])], note: [optional, string(400)] })), c.fixReopen);
fixRouter.get("/:id/proof", validate(idParamSchema, "params"), c.fixProofs);
fixRouter.post("/:id/proof", authorizeStaff, validate(idParamSchema, "params"), validate(schema({ note: [optional, string(600)], photo: [optional, string(150000)] })), c.fixAttach);
fixRouter.post("/:id/confirm", authorize("STUDENT"), validate(idParamSchema, "params"), validate(schema({ response: [required, oneOf(["YES", "NOT_FIXED"])], comment: [optional, string(400)] })), c.fixConfirm);

// ---- 2D Office FAQ -----------------------------------------------------------------------
export const faqRouter = Router();
faqRouter.use(authenticate, noStore);
faqRouter.post("/ask", limiter(30, "Too many questions — wait a moment"), validate(schema({ question: [required, string(300)], lang: [optional, oneOf(["EN", "OR", "HI"])] })), c.faqAsk);
faqRouter.post("/request", validate(schema({ queryId: [optional, string(40)], question: [optional, string(300)] })), c.faqRequest);
faqRouter.get("/sections", lite, c.faqSections);
faqRouter.get("/stats", authorizeStaff, c.faqStatsHandler);
faqRouter.put(
  "/sections/:key",
  authorize("ADMIN"),
  (req, _res, next) => (/^[A-Z0-9-]{3,40}$/.test(req.params.key) ? next() : next(ApiError.badRequest("key must be 3–40 capital letters, digits or dashes"))),
  validate(schema({ title: [optional, string(160)], category: [optional, oneOf(["HOSTEL", "FEES", "LEAVE", "CERTIFICATE", "MESS", "ACADEMIC"])], body: [optional, string(3000)], keywords: [optional, arrayOf(string(40), 30)], source: [optional, string(200)] })),
  c.faqSave
);

// ---- 2E Board -------------------------------------------------------------------------------
export const boardRouter = Router();
boardRouter.use(authenticate);
boardRouter.get("/", lite, validate(schema({ hostel: [optional, string(20)], lite: [optional, string(5)] }), "query"), c.boardHandler);

// ---- 2H Adoption extension ----------------------------------------------------------------
export const adoptionRouter = Router();
adoptionRouter.use(authenticate, authorize("ADMIN"), noStore);
const datasetParam = (req, _res, next) => (/^(students|rooms|timetable|fees|staff|policy)$/.test(req.params.dataset) ? next() : next(ApiError.notFound("Unknown dataset")));
adoptionRouter.get("/datasets", c.adoptionDatasets);
adoptionRouter.get("/templates/:dataset", datasetParam, c.adoptionTemplate);
adoptionRouter.post("/validate/:dataset", datasetParam, validate(schema({ csv: [required, string(180000)] })), c.adoptionValidate);
