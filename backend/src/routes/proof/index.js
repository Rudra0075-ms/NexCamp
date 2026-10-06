import { Router } from "express";
import * as c from "../../controllers/proof/proofController.js";
import { authenticate, authorize, authorizeStaff } from "../../middleware/auth.js";
import { ROLES, STAFF_ROLES } from "../../config/constants.js";
import { lite, noStore } from "../../middleware/bandwidth.js";
import { validate } from "../../middleware/validate.js";
import { idParamSchema } from "../../validations/index.js";
import { arrayOf, integer, number, oneOf, optional, required, schema, string } from "../../validations/rules.js";

/**
 * Round 3 routes (see CHANGES-ROUND3.md). Mounted by one hook line in
 * routes/index.js after every existing router. Each path below is one no
 * existing route matches (checked against the /admin, /interventions,
 * /notices, /mess, /attendance, /requests and /risk routers), so nothing
 * existing is shadowed.
 */
const router = Router();

const dateKey = (v, f) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? { value: String(v) } : { error: `${f} must be YYYY-MM-DD` });
const hhmm = (v, f) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v)) ? { value: String(v) } : { error: `${f} must be HH:MM` });
const objectId = (v, f) => (/^[0-9a-f]{24}$/i.test(String(v)) ? { value: String(v) } : { error: `${f} must be an id` });
const meals = ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"];

// F1 — process mining (page 10)
router.get(
  "/admin/process-mining",
  authenticate,
  authorizeStaff,
  noStore,
  validate(schema({ workflow: [optional, oneOf(["complaint", "gatepass", "certificate"])], days: [optional, integer(7, 365)] }), "query"),
  c.mining
);
// F8 — service equity (pages 21 and 10)
router.get("/admin/equity", authenticate, authorize([...STAFF_ROLES, ROLES.COUNSELLOR]), noStore, lite, validate(schema({ days: [optional, integer(30, 730)] }), "query"), c.equity);

// F2 — did it work? (pages 09 and 20)
router.get("/interventions/:id/impact", authenticate, authorizeStaff, noStore, validate(idParamSchema, "params"), validate(schema({ window: [optional, integer(7, 42)] }), "query"), c.impact);
router.get("/board/proof", authenticate, noStore, lite, c.badges);
// F7 — repair portfolio (page 09): read-only computation
router.post("/interventions/portfolio", authenticate, authorizeStaff, noStore, validate(schema({ hours: [optional, number(1, 400)], trade: [optional, string(40)] })), c.optimise);

// F3 — pre-flight (page 15): writes nothing
const preflightSchema = (input) => {
  if (String(input.kind || "CLASS").toUpperCase() === "MENU") {
    return schema({ kind: [required, oneOf(["MENU"])], date: [required, dateKey], meal: [required, oneOf(meals)], items: [required, arrayOf(string(80), 12)], hostels: [optional, arrayOf(string(40), 10)] })(input);
  }
  return schema({ kind: [optional, oneOf(["CLASS"])], scheduleId: [required, objectId], sessionDate: [required, dateKey], type: [required, oneOf(["CANCEL", "RESCHEDULE", "ROOM"])], newDate: [optional, dateKey], newStartTime: [optional, hhmm], newRoom: [optional, string(40)], reason: [optional, string(300)] })(input);
};
const preflightRoles = (req, res, next) => (String(req.body?.kind || "").toUpperCase() === "MENU" ? authorize("ADMIN", "MESS_MANAGER") : authorize("ADMIN"))(req, res, next);
router.post("/changes/preview", authenticate, noStore, preflightRoles, validate(preflightSchema), c.preflight);

// F4 — notice lint (page 13): pure, writes nothing
router.post(
  "/notices/lint",
  authenticate,
  authorizeStaff,
  noStore,
  validate(schema({ title: [optional, string(160)], body: [optional, string(2000)], audience: [optional], priority: [optional, oneOf(["INFO", "NORMAL", "HIGH", "CRITICAL"])], scheduledFor: [optional, string(40)] })),
  c.lint
);

// F5 — presence-aware forecast (page 04) and best slot (page 02)
const mealQuery = validate(schema({ meal: [optional, oneOf(meals)], date: [optional, dateKey] }), "query");
router.get("/mess/presence-forecast", authenticate, noStore, mealQuery, c.presence);
router.get("/mess/best-slot", authenticate, authorize("STUDENT"), noStore, mealQuery, c.bestSlot);
router.post("/mess/best-slot/accept", authenticate, authorize("STUDENT"), validate(schema({ meal: [required, oneOf(meals)], date: [optional, dateKey], slot: [required, hhmm], peakSlot: [optional, hhmm], queueMinutes: [optional, number(0, 240)] })), c.acceptBestSlot);

// F6 — attendance (page 03). Two-segment paths so /attendance/:studentId never captures them.
router.get("/attendance/me/point-of-no-return", authenticate, authorize("STUDENT"), noStore, c.pointOfNoReturn);
router.get("/attendance/sections/analysis", authenticate, authorize("ADMIN", "WARDEN"), noStore, c.sections);

// F9 — unblock path (page 17)
router.get("/requests/unblock", authenticate, authorize("STUDENT"), noStore, c.unblock);

// F10 — asset reliability (page 08)
router.get("/risk/reliability", authenticate, noStore, lite, validate(schema({ building: [optional, string(20)] }), "query"), c.reliability);

export default router;
