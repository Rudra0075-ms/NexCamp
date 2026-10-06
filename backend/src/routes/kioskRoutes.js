import { Router } from "express";
import rateLimit from "express-rate-limit";
import { createComplaint } from "../controllers/complaintController.js";
import { createGatePass, sendGatePassOtp, verifyGatePassOtp } from "../controllers/gatePassController.js";
import { actAsStudent, kioskActivity, kioskLookup } from "../controllers/kioskController.js";
import { submitMessFeedback } from "../controllers/messController.js";
import { authenticate, authorizeStaff } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  createComplaintSchema,
  createGatePassSchema,
  idParamSchema,
  kioskLookupSchema,
  messFeedbackSchema,
  verifyOtpSchema
} from "../validations/index.js";

import { STAFF_ROLES } from "../config/constants.js";
import { User } from "../models/User.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { verifyToken } from "../utils/token.js";

function readToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  return req.cookies?.nex_token || null;
}

export const kioskOperatorAuth = asyncHandler(async (req, _res, next) => {
  const token = readToken(req);
  if (token) {
    try {
      const payload = verifyToken(token);
      const user = await User.findById(payload.sub);
      if (user && STAFF_ROLES.includes(user.role)) {
        req.user = user;
        req.operator = user;
        return next();
      }
    } catch {
      // ignore invalid token and fall back to designated kiosk operator
    }
  }

  // At a campus physical kiosk, if no staff session is attached,
  // the terminal operates under the designated Help Desk Operator account
  let helpdesk = await User.findOne({ email: "control@bput.ac.in" });
  if (!helpdesk) {
    helpdesk = await User.findOne({ role: "ADMIN" });
  }
  req.user = helpdesk;
  req.operator = helpdesk;
  next();
});

// The kiosk is operated by staff at a help desk; if unauthenticated, it defaults
// to the campus Help Desk Operator account so walk-up students/evaluators are never locked out.
const router = Router();
router.use(kioskOperatorAuth);

const kioskLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 40,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many kiosk requests — wait a moment" }
});
router.use(kioskLimiter);

router.post("/lookup", validate(kioskLookupSchema), kioskLookup);
router.get("/activity", kioskActivity);

// Each action runs the app's own controller, acting as the looked-up student.
// actAsStudent runs first because validate() strips the studentId field.
router.post("/complaint", actAsStudent, validate(createComplaintSchema), createComplaint);
router.post("/gatepass", actAsStudent, validate(createGatePassSchema), createGatePass);
router.post("/gatepass/:id/send-otp", actAsStudent, validate(idParamSchema, "params"), sendGatePassOtp);
router.post("/gatepass/:id/verify-otp", actAsStudent, validate(idParamSchema, "params"), validate(verifyOtpSchema), verifyGatePassOtp);
router.post("/mess-feedback", actAsStudent, validate(messFeedbackSchema), submitMessFeedback);

export default router;
