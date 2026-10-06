import { Router } from "express";
import {
  createAttendance,
  myAttendance,
  myAttendanceIntelligence,
  simulateAttendance,
  studentAttendance,
  updateAttendance
} from "../controllers/attendanceController.js";
import { authenticate, authorizeSelfOrStaff, authorizeStaff } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  createAttendanceSchema,
  idParamSchema,
  simulateAttendanceSchema,
  updateAttendanceSchema
} from "../validations/index.js";

const router = Router();

router.use(authenticate);

router.get("/me", myAttendance);
router.get("/me/intelligence", myAttendanceIntelligence);
router.post("/simulate", validate(simulateAttendanceSchema), simulateAttendance);
router.post("/", authorizeStaff, validate(createAttendanceSchema), createAttendance);
router.patch("/:id", authorizeStaff, validate(idParamSchema, "params"), validate(updateAttendanceSchema), updateAttendance);
// Keep this last: it would otherwise swallow /me and /simulate.
router.get("/:studentId", authorizeSelfOrStaff("studentId"), studentAttendance);

export default router;
