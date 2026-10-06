import { Router } from "express";
import {
  createIncident,
  getIncident,
  getIncidentComplaints,
  getInvestigation,
  getMemoryMatch,
  listIncidents,
  runClustering,
  updateIncident
} from "../controllers/incidentController.js";
import { authenticate, authorizeStaff, optionalAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { clusterSchema, createIncidentSchema, idParamSchema, updateIncidentSchema } from "../validations/index.js";

const router = Router();

// Incident intelligence is readable without an account so the public campus
// surfaces work; writing to it is staff-only.
router.get("/", optionalAuth, listIncidents);
router.post("/cluster", optionalAuth, validate(clusterSchema), runClustering);
router.get("/:id", optionalAuth, validate(idParamSchema, "params"), getIncident);
router.get("/:id/complaints", authenticate, validate(idParamSchema, "params"), getIncidentComplaints);
router.get("/:id/investigation", optionalAuth, validate(idParamSchema, "params"), getInvestigation);
router.get("/:id/memory-match", optionalAuth, validate(idParamSchema, "params"), getMemoryMatch);

router.post("/", authenticate, authorizeStaff, validate(createIncidentSchema), createIncident);
router.patch("/:id", authenticate, authorizeStaff, validate(idParamSchema, "params"), validate(updateIncidentSchema), updateIncident);

export default router;
