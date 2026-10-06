import { Router } from "express";
import rateLimit from "express-rate-limit";
import { login, logout, me, register } from "../controllers/authController.js";
import { authenticate, optionalAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { loginSchema, registerSchema } from "../validations/index.js";

const router = Router();

// Credential endpoints are the ones worth throttling.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50000,
  skip: () => process.env.NODE_ENV !== "production",
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { success: false, message: "Too many attempts — try again in a few minutes" }
});

router.post("/register", authLimiter, optionalAuth, validate(registerSchema), register);
router.post("/login", authLimiter, validate(loginSchema), login);
router.post("/logout", logout);
router.get("/me", authenticate, me);

export default router;
