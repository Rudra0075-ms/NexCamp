import { Router } from "express";
import { ROLES } from "../config/constants.js";
import {
  createMessRecord,
  getAnalytics,
  getDemand,
  getIntelligence,
  getMess,
  simulateMess,
  submitMessFeedback
} from "../controllers/messController.js";
import { authenticate, authorize } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { createMessSchema, messFeedbackSchema, messSimulateSchema } from "../validations/index.js";

const router = Router();

router.get("/", getMess);
router.get("/demand", getDemand);
router.get("/analytics", getAnalytics);
router.get("/intelligence", getIntelligence);
router.post("/simulate", validate(messSimulateSchema), simulateMess);
router.post("/feedback", authenticate, validate(messFeedbackSchema), submitMessFeedback);
router.post("/", authenticate, authorize(ROLES.ADMIN, ROLES.MESS_MANAGER), validate(createMessSchema), createMessRecord);

export default router;
