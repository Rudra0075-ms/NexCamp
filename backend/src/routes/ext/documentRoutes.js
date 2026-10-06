import { Router } from "express";
import rateLimit from "express-rate-limit";
import { actAsStudent } from "../../controllers/kioskController.js";
import { authenticate, authorize, authorizeStaff } from "../../middleware/auth.js";
import { lite, noStore } from "../../middleware/bandwidth.js";
import { validate } from "../../middleware/validate.js";
import { ApiError } from "../../utils/ApiError.js";
import { idParamSchema } from "../../validations/index.js";
import * as c from "../../controllers/ext/documentController.js";
import { documentCreateSchema, documentReviewSchema, requiredReasonSchema, verifyCopySchema } from "./validators.js";

import { kioskOperatorAuth } from "../kioskRoutes.js";

export const documentRouter = Router();
documentRouter.use((req, res, next) => {
  if (req.path === "/kiosk") return next();
  authenticate(req, res, next);
}, noStore);

documentRouter.get("/", lite, c.listDocs);
documentRouter.post("/", authorize("STUDENT"), validate(documentCreateSchema), c.createDoc);
// Assisted-access kiosk: staff operator, acting as the looked-up student.
documentRouter.post("/kiosk", kioskOperatorAuth, actAsStudent, validate(documentCreateSchema), c.createDoc);
documentRouter.get("/:id/pdf", validate(idParamSchema, "params"), c.docPdf);
documentRouter.post("/:id/review", authorizeStaff, validate(idParamSchema, "params"), validate(documentReviewSchema), c.reviewDoc);
documentRouter.post("/:id/issue", authorizeStaff, validate(idParamSchema, "params"), c.issueDoc);
documentRouter.post("/:id/revoke", authorize("ADMIN"), validate(idParamSchema, "params"), validate(requiredReasonSchema), c.revokeDoc);

/**
 * Public verification. Deliberately unauthenticated — a third party scanning
 * the QR has no account — so it is rate-limited and returns only the status,
 * the issue date, the certificate type and a partially masked name.
 */
export const verifyRouter = Router();
verifyRouter.use(
  rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: "draft-7", legacyHeaders: false, message: { success: false, message: "Too many verification requests — wait a minute" } })
);
const codeParam = (req, _res, next) => (/^[A-Za-z0-9-]{4,16}$/.test(req.params.code) ? next() : next(ApiError.badRequest("Invalid verification code")));
verifyRouter.get("/:code", codeParam, c.verify);
verifyRouter.post("/:code", codeParam, validate(verifyCopySchema), c.verifyCopyHandler);
