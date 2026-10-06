import { STAFF_ROLES } from "../../config/constants.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { replay } from "../../services/xo/replayService.js";
import { created, ok } from "../../utils/respond.js";
import {
  activateRule,
  decideServiceRequest,
  exceptionsInbox,
  listRules,
  listServiceRequests,
  preview,
  requestReceiptCopy,
  saveDraft,
  touchlessRate,
  undoPolicyDecision
} from "../../services/xo/touchlessService.js";

const isStaff = (user) => STAFF_ROLES.includes(user?.role);

/** GET /api/xo/policy/rules — active rules (staff may ask for drafts too). ?section=KEY links an FAQ section to its rules. */
export const rules = asyncHandler(async (req, res) => ok(res, await listRules({ section: req.query.section, includeDrafts: isStaff(req.user) && req.query.drafts === "1" })));
export const draftRule = asyncHandler(async (req, res) => created(res, await saveDraft(req.user, req.body), "Draft saved — not live until an administrator activates it"));
export const activate = asyncHandler(async (req, res) => ok(res, await activateRule(req.user, req.params.id), "Rule activated"));
/** POST /api/xo/policy/preview — what would the policy decide for me now? Writes nothing. */
export const previewDecision = asyncHandler(async (req, res) => ok(res, await preview(req.user, req.body)));
export const undo = asyncHandler(async (req, res) => ok(res, await undoPolicyDecision(req.params.kind, req.params.id, req.user, req.body.reason), "Policy decision undone — the student has been told"));
export const exceptions = asyncHandler(async (_req, res) => ok(res, await exceptionsInbox()));
export const rate = asyncHandler(async (req, res) => ok(res, await touchlessRate({ days: Math.min(180, Math.max(1, Number(req.query.days) || 30)) })));

export const requestService = asyncHandler(async (req, res) => {
  const result = await requestReceiptCopy(req.user, { receipt: req.body.receipt, purpose: req.body.purpose, channel: req.kiosk ? "KIOSK" : "APP" });
  return created(res, result, result.decidedBy === "POLICY" ? `${result.reference} issued instantly under ${result.policyDecision?.citation?.section}` : `${result.reference} sent to the accounts office`);
});
export const services = asyncHandler(async (req, res) => ok(res, await listServiceRequests(req.user, { status: req.query.status })));
export const decideService = asyncHandler(async (req, res) => ok(res, await decideServiceRequest(req.params.id, req.user, req.body)));

// Phase 8 — policy what-if
export const replayRules = asyncHandler(async (req, res) => ok(res, await replay({ days: Math.min(180, Math.max(1, Number(req.body.days) || 30)), edits: req.body.edits || [] })));
