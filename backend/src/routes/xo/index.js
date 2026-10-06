import { Router } from "express";
import { authenticate, authorize, authorizeStaff, optionalAuth } from "../../middleware/auth.js";
import { noStore } from "../../middleware/bandwidth.js";
import * as events from "../../controllers/xo/eventController.js";
import * as policy from "../../controllers/xo/policyController.js";
import * as insight from "../../controllers/xo/insightController.js";
import * as reach from "../../controllers/xo/reachController.js";
import * as changes from "../../controllers/xo/changeController.js";
import * as imports from "../../controllers/xo/importController.js";
import * as sms from "../../controllers/xo/smsController.js";
import * as tuesday from "../../controllers/xo/tuesdayController.js";
import * as reel from "../../controllers/xo/reelController.js"; // REEL HOOK (see CHANGES-REEL.md)
import { noticeCreateSchema } from "../ext/validators.js";
import { validate } from "../../middleware/validate.js";
import { arrayOf, integer, oneOf, optional, required, schema, string } from "../../validations/rules.js";
import { idParamSchema } from "../../validations/index.js";

/**
 * Every route added by the Exception-Only Campus, under /api/xo. Mounted by one
 * hook line in routes/index.js after every existing router; nothing here
 * overlaps an existing path.
 */
const router = Router();

// Public, aggregate only (no names): the landing page's measured Friction Map.
router.get("/ledger/public", insight.ledgerPublic);

router.use(authenticate, noStore);

// Phase 1 — campus event log
router.get("/events", authorizeStaff, events.listEvents);
router.get("/events/summary", authorizeStaff, events.eventSummary);
router.post("/events/backfill", authorize("ADMIN"), events.runBackfill);
router.get("/events/:subjectType/:subjectId", events.subjectEvents);

// Phase 2 — Touchless Lane
const conditionShape = (value, field) => (value && typeof value === "object" && typeof value.field === "string" && typeof value.op === "string" ? { value } : { error: `${field} must be {field, op, value}` });
router.get("/policy/rules", policy.rules);
router.post(
  "/policy/rules",
  authorize("ADMIN"),
  validate(schema({ key: [optional, string(60)], requestType: [required, oneOf(["BONAFIDE_CERTIFICATE", "GATE_PASS", "FEE_RECEIPT_COPY"])], title: [optional, string(160)], action: [required, oneOf(["AUTO_APPROVE", "ROUTE_TO_HUMAN"])], conditions: [required, arrayOf(conditionShape, 12)], citation: [required], notes: [optional, string(600)] })),
  policy.draftRule
);
router.post("/policy/rules/:id/activate", authorize("ADMIN"), validate(idParamSchema, "params"), policy.activate);
router.post("/policy/preview", validate(schema({ type: [required, oneOf(["BONAFIDE_CERTIFICATE", "GATE_PASS", "FEE_RECEIPT_COPY"])], purpose: [optional, string(300)], receipt: [optional, string(40)], leaveAt: [optional, string(40)], expectedReturnAt: [optional, string(40)] })), policy.previewDecision);
router.post("/policy/undo/:kind/:id", authorizeStaff, validate(schema({ reason: [required, string(400)] })), policy.undo);
router.get("/policy/exceptions", authorizeStaff, policy.exceptions);
router.get("/policy/touchless-rate", authorizeStaff, policy.rate);
router.get("/services", policy.services);
router.post("/services", validate(schema({ type: [optional, oneOf(["FEE_RECEIPT_COPY"])], receipt: [required, string(40)], purpose: [optional, string(300)] })), policy.requestService);
// Phase 3 — Friction Ledger
router.get("/ledger", authorizeStaff, insight.ledger);
router.get("/ledger/me", insight.ledgerMine);
router.get("/board/impact", insight.impact);

// Phase 4 — report smarter
router.post("/report/similar", validate(schema({ text: [required, string(2000)], category: [optional, string(20)], location: [optional, string(160)], buildingCode: [optional, string(20)] })), insight.similar);
router.post("/incidents/:id/follow", validate(idParamSchema, "params"), validate(schema({ note: [optional, string(400)], room: [optional, string(60)] })), insight.follow);
router.get("/incidents/followed", insight.follows);
router.get("/incidents/signals", insight.incidentSignals);
router.get("/eta", insight.eta);
router.get("/closures", authorizeStaff, insight.closures);
router.get("/assets", insight.assets);

// Phase 5 — guaranteed reach
const reachShape = (value, field) => {
  if (!value || typeof value !== "object") return { error: `${field} must be {pct, deadline}` };
  const pct = Number(value.pct ?? 100);
  const deadline = new Date(value.deadline);
  if (!(pct >= 1 && pct <= 100)) return { error: `${field}.pct must be 1–100` };
  if (Number.isNaN(deadline.getTime())) return { error: `${field}.deadline must be a date` };
  return { value: { pct, deadline } };
};
const flag = (value) => ({ value: value === true || value === "true" });
const reachExtras = schema({ reachTarget: [optional, reachShape], supersedes: [optional, string(40)], overrideQuietHours: [optional, flag], overrideReason: [optional, string(200)] });
const reachNoticeSchema = (input) => {
  const base = noticeCreateSchema(input);
  const extra = reachExtras(input);
  return { value: { ...base.value, ...extra.value }, errors: { ...base.errors, ...extra.errors } };
};
router.post("/notices/hygiene", authorizeStaff, validate(schema({ title: [optional, string(160)], body: [optional, string(2000)], audience: [optional], priority: [optional, string(12)], scheduledFor: [optional, string(40)] })), reach.noticeHygiene);
router.post("/notices", authorizeStaff, validate(reachNoticeSchema), reach.createNotice);
router.get("/notices/:id/reach", authorizeStaff, validate(idParamSchema, "params"), reach.funnel);
router.post("/reach/sweep", authorize("ADMIN"), reach.sweep);
router.get("/reach/kiosk-list", authorizeStaff, reach.kiosk);
router.post("/reach/kiosk-read", authorizeStaff, validate(schema({ reference: [required, string(40)], studentId: [required, string(40)] })), reach.kioskRead);
router.get("/reach/class-rep", reach.classRep);

// Phase 6 — change propagation
router.get("/changes", authorizeStaff, changes.list);
router.get("/changes/mine", changes.mine);
router.post("/changes/shutdown", authorize("ADMIN", "FACILITY_MANAGER"), validate(schema({ buildingCode: [required, string(20)], utility: [required, oneOf(["WATER", "ELECTRICITY", "WI-FI"])], from: [required, string(40)], to: [required, string(40)], reason: [optional, string(300)] })), changes.shutdown);

// Phase 7 — chaos import
router.post("/import/whatsapp", authorize("ADMIN"), validate(schema({ text: [optional, string(200_000)], csv: [optional, string(100_000)], name: [optional, string(120)], convert: [optional, flag], sample: [optional, flag] })), imports.whatsapp);
router.get("/faq/drafts", authorizeStaff, imports.drafts);

// Phase 8 — policy what-if (writes nothing)
router.post("/policy/replay", authorizeStaff, validate(schema({ days: [optional, integer(1, 180)], edits: [optional, arrayOf((v, f) => (v && typeof v === "object" ? { value: v } : { error: `${f} must be rule objects` }), 6)] })), policy.replayRules);

router.post("/services/:id/decide", authorizeStaff, validate(idParamSchema, "params"), validate(schema({ decision: [required, oneOf(["FULFILL", "REJECT"])], reason: [optional, string(400)] })), policy.decideService);

// Phase 9: the SMS work loop (staff DONE / NEED PART, student YES / NO) — outbox and staff numbers for the demo.
router.get("/sms/outbox", sms.outbox);
router.get("/sms/staff-phones", optionalAuth, sms.staffPhones);

// Phase 10: the Tuesday Test — old vs new for the errands just run, and a notice's reach in counts.
const tuesdayStep = (value, field) => {
  if (!value || typeof value !== "object") return { error: `${field} must be an object` };
  const workflow = String(value.workflow || "").toUpperCase();
  const seconds = Number(value.seconds);
  if (!/^[A-Z_]{3,30}$/.test(workflow)) return { error: `${field}.workflow is not valid` };
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400) return { error: `${field}.seconds must be 0–86400` };
  const subjectType = ["Complaint", "GatePass", "DocumentRequest", "ServiceRequest", "Incident"].includes(value.subjectType) ? value.subjectType : undefined;
  const subjectId = /^[0-9a-f]{24}$/i.test(String(value.subjectId || "")) ? String(value.subjectId) : undefined;
  return { value: { key: String(value.key || "").slice(0, 30) || undefined, workflow, seconds, actions: Number.isFinite(Number(value.actions)) ? Math.min(50, Math.max(0, Number(value.actions))) : 1, label: String(value.label || "").slice(0, 80) || undefined, channel: value.channel === "SMS" ? "SMS" : "APP", reference: String(value.reference || "").slice(0, 40) || undefined, subjectType, subjectId, noStaffWork: value.noStaffWork === true } };
};
router.post("/tuesday/compare", validate(schema({ steps: [required, arrayOf(tuesdayStep, 10)] })), tuesday.compareRun);
router.get("/tuesday/reach/:id", validate(idParamSchema, "params"), tuesday.reach);

// REEL HOOK (see CHANGES-REEL.md): the 30-second proof — one read-only aggregate of ten scenes (staff).
router.get("/reel", authorizeStaff, reel.reel); // REEL HOOK (see CHANGES-REEL.md)

export default router;
