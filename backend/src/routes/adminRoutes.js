import { Router } from "express";
import { actionQueue, briefing, crossDomain, overview } from "../controllers/adminController.js";
import { importPreview } from "../controllers/kioskController.js";
import { authenticate, authorize, authorizeStaff } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { ROLES } from "../config/constants.js";
import { importPreviewSchema } from "../validations/index.js";

const router = Router();

// Mission control is staff-only, end to end.
router.use(authenticate, authorizeStaff);

router.get("/overview", overview);
router.get("/action-queue", actionQueue);
router.get("/briefing", briefing);
router.get("/cross-domain", crossDomain);
// College adoption: a dry-run CSV import. Validates only; writes nothing.
router.post("/import-preview", authorize(ROLES.ADMIN), validate(importPreviewSchema), importPreview);

export default router;
