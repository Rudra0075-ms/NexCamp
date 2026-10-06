import { Router } from "express";
import rateLimit from "express-rate-limit";
import { ROLES, SUPPORT_CONTACT_TIMES, SUPPORT_OUTCOMES, SUPPORT_OVERVIEW_ROLES, SUPPORT_STATUS, SUPPORT_TEAM_ROLES } from "../../config/constants.js";
import * as c from "../../controllers/support/supportController.js";
import { authenticate, authorize } from "../../middleware/auth.js";
import { noStore } from "../../middleware/bandwidth.js";
import { validate } from "../../middleware/validate.js";
import { idParamSchema } from "../../validations/index.js";
import { boolean, integer, oneOf, optional, required, schema, string } from "../../validations/rules.js";

/**
 * Silent Support System routes (see CHANGES-SILENT-SUPPORT.md), mounted under
 * /api/support by one hook line in routes/index.js. No existing router uses
 * that prefix.
 *
 *   students          their own check-ins and requests only
 *   COUNSELLOR        the support queue and case workflow
 *   COUNSELLOR, ADMIN the aggregate overview (admins get small-count suppression)
 *
 * Every response is Cache-Control: no-store so no browser, proxy or service
 * worker keeps a copy. Nothing sensitive is ever put in a URL: answers and
 * choices travel in request bodies; paths carry only an opaque case id.
 */
const router = Router();
router.use(authenticate, noStore);

const studentOnly = authorize(ROLES.STUDENT);
const team = authorize(SUPPORT_TEAM_ROLES);

const writeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many requests — please wait a moment. If you need help now, use the contacts on your dashboard." }
});

const scale = [optional, integer(1, 5)];
const checkInSchema = schema({ feeling: scale, study: scale, connection: scale, helpComfort: scale, unsafe: [optional, boolean] });
const requestSchema = schema({
  preference: [required, oneOf(["COUNSELLOR", "MENTOR", "PRIVATE_CONVERSATION", "ANONYMOUS"])],
  anonymous: [optional, boolean],
  shareCheckIn: [optional, boolean],
  preferredTime: [optional, oneOf(SUPPORT_CONTACT_TIMES)]
});
const laterSchema = schema({ days: [required, oneOf([1, 3, 7])] });
const moveSchema = schema({
  status: [required, oneOf(SUPPORT_STATUS)],
  outcome: [optional, oneOf(SUPPORT_OUTCOMES)],
  note: [optional, string(500)],
  message: [optional, string(280)],
  followUpDays: [optional, integer(1, 30)]
});

// Student
router.get("/me", studentOnly, c.me);
router.post("/check-in", studentOnly, writeLimiter, validate(checkInSchema), c.checkIn);
router.post("/requests", studentOnly, writeLimiter, validate(requestSchema), c.request);
router.post("/check-later", studentOnly, writeLimiter, validate(laterSchema), c.checkLater);
router.post("/requests/:id/withdraw", studentOnly, validate(idParamSchema, "params"), c.withdraw);

// Anyone signed in: the institution's configured help and emergency contacts.
router.get("/resources", c.resources);

// Support team
router.get("/queue", team, validate(schema({ closed: [optional, boolean] }), "query"), c.queue);
router.post("/cases/:id/status", team, validate(idParamSchema, "params"), validate(moveSchema), c.move);

// Aggregate overview
router.get("/overview", authorize(SUPPORT_OVERVIEW_ROLES), validate(schema({ days: [optional, integer(7, 180)] }), "query"), c.overview);

export default router;
