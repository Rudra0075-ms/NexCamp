import { Router } from "express";
import {
  createIntervention,
  decide,
  getIntervention,
  getQuality,
  listInterventions,
  simulate,
  updateIntervention
} from "../controllers/interventionController.js";
import { authenticate, authorizeStaff, optionalAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  createInterventionSchema,
  decisionSchema,
  idParamSchema,
  simulateInterventionSchema,
  updateInterventionSchema
} from "../validations/index.js";

const router = Router();

router.get("/", optionalAuth, listInterventions);
// Simulation is read-only arithmetic, so it stays open for the public surfaces.
router.post("/simulate", optionalAuth, validate(simulateInterventionSchema), simulate);
router.get("/:id", optionalAuth, validate(idParamSchema, "params"), getIntervention);
router.get("/:id/quality", optionalAuth, validate(idParamSchema, "params"), getQuality);

router.post("/", authenticate, authorizeStaff, validate(createInterventionSchema), createIntervention);
router.patch("/:id", authenticate, authorizeStaff, validate(idParamSchema, "params"), validate(updateInterventionSchema), updateIntervention);
// Only a human with authority may answer the AI's recommendation.
router.post("/:id/decision", authenticate, authorizeStaff, validate(idParamSchema, "params"), validate(decisionSchema), decide);

export default router;
