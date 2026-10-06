import { asyncHandler } from "../../utils/asyncHandler.js";
import { created, ok } from "../../utils/respond.js";
import {
  certificatePdf,
  issueDocument,
  listDocuments,
  requestDocument,
  reviewDocument,
  revokeDocument,
  shapeDocument,
  verifyCode,
  verifyCopy
} from "../../services/ext/certificateService.js";
import { applyDocumentPolicy } from "../../services/xo/touchlessService.js"; // EXCEPTION-ONLY HOOK

/** Certificate & document requests (PS07 extension 1B). */

export const listDocs = asyncHandler(async (req, res) => ok(res, await listDocuments(req.user, { status: req.query.status, type: req.query.type })));

export const createDoc = asyncHandler(async (req, res) => {
  // At the kiosk, actAsStudent has already swapped req.user for the student.
  const filed = await requestDocument(req.user, req.body, req.kiosk ? { channel: "KIOSK", operator: req.operator } : {});
  // EXCEPTION-ONLY HOOK: the Touchless Lane — an in-policy bonafide is issued now under its cited rule;
  // every other request goes to the academic office exactly as before.
  const { doc, policy } = await applyDocumentPolicy(filed, req.user);
  const instant = policy?.decision === "AUTO_APPROVE";
  return created(res, { ...shapeDocument(doc), policy }, instant ? `${doc.reference} issued instantly under ${policy.citation?.section}` : `Request ${doc.reference} submitted`);
});

export const reviewDoc = asyncHandler(async (req, res) => ok(res, shapeDocument(await reviewDocument(req.params.id, req.user, req.body), { staff: true })));

export const issueDoc = asyncHandler(async (req, res) => ok(res, shapeDocument(await issueDocument(req.params.id, req.user), { staff: true }), "Certificate issued"));

export const revokeDoc = asyncHandler(async (req, res) => ok(res, shapeDocument(await revokeDocument(req.params.id, req.user, req.body.reason), { staff: true }), "Certificate revoked"));

export const docPdf = asyncHandler(async (req, res) => {
  const { filename, buffer } = await certificatePdf(req.params.id, req.user);
  res.set("Content-Type", "application/pdf");
  res.set("Content-Disposition", `inline; filename="${filename}"`);
  res.set("Cache-Control", "no-store");
  return res.send(buffer);
});

export const verify = asyncHandler(async (req, res) => {
  res.set("Cache-Control", "no-store");
  return ok(res, await verifyCode(req.params.code));
});

export const verifyCopyHandler = asyncHandler(async (req, res) => {
  res.set("Cache-Control", "no-store");
  return ok(res, await verifyCopy(req.params.code, req.body.content));
});
