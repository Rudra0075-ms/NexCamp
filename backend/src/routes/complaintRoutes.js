import { Router } from "express";
import {
  complaintDuplicates,
  createComplaint,
  decideRouting,
  deleteComplaint,
  getComplaint,
  listComplaints,
  reclassifyComplaint,
  resolutionSuggestions,
  reviewDuplicate,
  studentFlagComplaint,
  submitFeedback,
  updateComplaint
} from "../controllers/complaintController.js";
import { authenticate, authorizeStaff } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  createComplaintSchema,
  duplicateReviewSchema,
  feedbackSchema,
  idParamSchema,
  routingDecisionSchema,
  updateComplaintSchema
} from "../validations/index.js";

const router = Router();

router.use(authenticate);

router.post("/", validate(createComplaintSchema), createComplaint);
router.get("/", listComplaints);
router.get("/:id", validate(idParamSchema, "params"), getComplaint);

// ---- AI layer -------------------------------------------------------------
// Suspected duplicates: the author or any staff member may read them.
router.get("/:id/duplicates", validate(idParamSchema, "params"), complaintDuplicates);
// Acting on the AI's recommendations is staff-only.
router.patch("/:id/routing", authorizeStaff, validate(idParamSchema, "params"), validate(routingDecisionSchema), decideRouting);
router.post("/:id/duplicate-review", authorizeStaff, validate(idParamSchema, "params"), validate(duplicateReviewSchema), reviewDuplicate);
router.post("/:id/reclassify", authorizeStaff, validate(idParamSchema, "params"), reclassifyComplaint);
// Feature 16: resolutions that worked on similar complaints. Staff only.
router.get("/:id/resolution-suggestions", authorizeStaff, validate(idParamSchema, "params"), resolutionSuggestions);
// Feature 17: the author rates their own resolved complaint. Ownership is
// enforced in the controller.
router.post("/:id/feedback", validate(idParamSchema, "params"), validate(feedbackSchema), submitFeedback);
// 6-day Red/Green Flag confirmation by student
router.post("/:id/student-flag", validate(idParamSchema, "params"), studentFlagComplaint);
router.patch("/:id", authorizeStaff, validate(idParamSchema, "params"), validate(updateComplaintSchema), updateComplaint);
router.delete("/:id", validate(idParamSchema, "params"), deleteComplaint);

export default router;
