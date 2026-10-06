import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  getEntityIntelligence,
  getRelationships,
  listQuestions,
  query
} from "../controllers/intelligenceController.js";
import { optionalAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { querySchema } from "../validations/index.js";

const router = Router();

const queryLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 40,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many queries — slow down for a moment" }
});

router.get("/relationships", getRelationships);
router.get("/questions", listQuestions);
router.post("/query", queryLimiter, optionalAuth, validate(querySchema), query);
// Keep last so it does not shadow the named routes above.
router.get("/:entityType/:entityId", optionalAuth, getEntityIntelligence);

export default router;
