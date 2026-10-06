import { Router } from "express";
import rateLimit from "express-rate-limit";
import { studentDashboard } from "../controllers/dashboardController.js";
import { askQuestion, myIntelligence } from "../controllers/studentIntelligenceController.js";
import { authenticate } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { studentQuerySchema } from "../validations/index.js";

const router = Router();

// A question can reach an AI provider, so it is rate limited like the
// campus-wide query box.
const queryLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 40,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many questions — slow down for a moment" }
});

router.get("/me/dashboard", authenticate, studentDashboard);
router.get("/me/intelligence", authenticate, myIntelligence);
router.post("/me/query", authenticate, queryLimiter, validate(studentQuerySchema), askQuestion);

export default router;
