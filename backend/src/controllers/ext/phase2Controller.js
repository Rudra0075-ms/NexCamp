import crypto from "node:crypto";
import { STAFF_ROLES } from "../../config/constants.js";
import { Complaint } from "../../models/Complaint.js";
import { StudentProfile } from "../../models/ext/StudentProfile.js";
import { FixConfirmation } from "../../models/ext/FixConfirmation.js";
import { FixProof } from "../../models/ext/FixProof.js";
import { ApiError } from "../../utils/ApiError.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { created, ok } from "../../utils/respond.js";
import { maskPhone, normalisePhone } from "../../services/smsService.js";
import { compare, ledger, updateBaseline } from "../../services/ext/frictionService.js";
import { activity, deliverReply, handleInbound } from "../../services/ext/smsKeywordService.js";
import { attachProof, confirmationsFor, confirmFix, fixMetrics, proofsFor, updateReopen } from "../../services/ext/fixService.js";
import { ask, createRequest, faqStats, listSections, upsertSection } from "../../services/ext/faqService.js";
import { board } from "../../services/ext/boardService.js";
import { DATASETS, readiness, template, validateDataset } from "../../services/ext/adoptionExtService.js";

/** Controllers for the Phase 2 extension features (2A–2E, 2H). */

// ---- 2A Friction Ledger ----------------------------------------------------------
export const frictionLedger = asyncHandler(async (req, res) => ok(res, await ledger({ days: Math.min(90, Math.max(1, Number(req.query.days) || 7)) })));
export const frictionBaseline = asyncHandler(async (req, res) => ok(res, await updateBaseline(req.params.workflow, req.user, req.body), "Baseline updated"));
export const frictionCompare = asyncHandler(async (req, res) => ok(res, await compare(req.body.steps)));

// ---- 2B SMS keyword channel -------------------------------------------------------
const isStaff = (user) => STAFF_ROLES.includes(user?.role);

function secretMatches(given) {
  const expected = process.env.SMS_WEBHOOK_SECRET || "";
  if (!expected || !given) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * POST /api/sms/inbound — provider-agnostic. Accepts {from,text}, Twilio's
 * {From,Body}, or {sender,message}. Authenticated by a shared secret in the
 * x-sms-webhook-secret header (or ?secret=), configured as SMS_WEBHOOK_SECRET.
 */
export const smsInbound = asyncHandler(async (req, res) => {
  if (!process.env.SMS_WEBHOOK_SECRET) throw new ApiError(503, "The SMS webhook is not configured (set SMS_WEBHOOK_SECRET)");
  if (!secretMatches(req.get("x-sms-webhook-secret") || req.query.secret)) throw ApiError.unauthorized("Webhook secret missing or wrong");
  const from = req.body.from || req.body.From || req.body.sender || req.body.msisdn;
  const text = req.body.text ?? req.body.Body ?? req.body.message ?? req.body.content;
  if (!from || typeof text !== "string") throw ApiError.badRequest("from and text are required");
  const result = await handleInbound({ from, text, simulated: false, via: "WEBHOOK" });
  if (process.env.SMS_REPLY_VIA_PROVIDER !== "false") await deliverReply(from, result.reply, result.message._id);
  return ok(res, { reply: result.reply, outcome: result.outcome });
});

/** POST /api/sms/simulate — the on-screen basic phone. Clearly SIMULATED. */
export const smsSimulate = asyncHandler(async (req, res) => {
  const from = normalisePhone(req.body.from);
  if (!from) throw ApiError.badRequest("from must be a phone number");
  const result = await handleInbound({ from, text: req.body.text, simulated: true, via: "SIMULATOR" });
  return ok(res, { reply: result.reply, outcome: result.outcome, chars: result.reply.length, simulated: true, at: result.message.createdAt });
});

/** GET /api/sms/phones — numbers the simulator may use (masked names). */
export const smsPhones = asyncHandler(async (req, res) => {
  let rows = await StudentProfile.find({}).populate("student", "name studentId hostelName").limit(40).lean();
  let phones = (rows || [])
    .filter((r) => r.registeredPhone && r.student)
    .map((r) => ({
      phone: r.registeredPhone,
      masked: maskPhone(r.registeredPhone),
      name: r.student.name,
      studentId: r.student.studentId,
      hostel: r.student.hostelName
    }));

  if (!phones.length) {
    phones = [
      { phone: "+919000000001", masked: "+91XXXXXX0001", name: "PRITISH RANJAN SAHOO", studentId: "BPUT/CSE/22/0417", hostel: "BPUT Hall-1" }
    ];
  }

  if (req.user) {
    const myIndex = phones.findIndex((p) => p.studentId === req.user.studentId || p.phone === req.user.phone);
    if (myIndex > 0) {
      const [myPhone] = phones.splice(myIndex, 1);
      phones.unshift(myPhone);
    }
  }

  return ok(res, {
    phones,
    note: "Demo numbers in an unallocated placeholder range; nothing is sent to a real handset from the simulator."
  });
});

export const smsActivity = asyncHandler(async (_req, res) => ok(res, await activity()));

// ---- 2C Proof of fix ----------------------------------------------------------------
async function assertCanSee(user, complaintId) {
  const c = await Complaint.findById(complaintId).select("student").lean();
  if (!c) throw ApiError.notFound("No complaint with that id");
  if (!isStaff(user) && String(c.student) !== String(user._id)) throw ApiError.forbidden("Not your complaint");
}

export const fixAttach = asyncHandler(async (req, res) => created(res, await attachProof(req.params.id, req.user, req.body), "Proof of fix attached"));
export const fixProofs = asyncHandler(async (req, res) => {
  await assertCanSee(req.user, req.params.id);
  return ok(res, { proofs: await proofsFor(req.params.id) });
});
export const fixConfirm = asyncHandler(async (req, res) => ok(res, await confirmFix(req.params.id, req.user, req.body)));
export const fixMine = asyncHandler(async (req, res) => ok(res, { items: await confirmationsFor(req.user), windowHours: 48 }));
export const fixMetricsHandler = asyncHandler(async (_req, res) => ok(res, await fixMetrics()));
export const fixReopen = asyncHandler(async (req, res) => ok(res, await updateReopen(req.params.id, req.user, req.body)));

/** GET /api/fix/resolved — resolved complaints for staff to attach proof to. */
export const fixResolved = asyncHandler(async (_req, res) => {
  const rows = await Complaint.find({ status: "RESOLVED" }).sort({ "resolution.resolvedAt": -1 }).limit(30).select("reference title department category resolution").lean();
  const ids = rows.map((r) => r._id);
  const [proofs, confirmations] = await Promise.all([
    FixProof.aggregate([{ $match: { complaint: { $in: ids } } }, { $group: { _id: "$complaint", n: { $sum: 1 } } }]),
    FixConfirmation.find({ complaint: { $in: ids } }).lean()
  ]);
  const proofBy = new Map(proofs.map((p) => [String(p._id), p.n]));
  const confBy = new Map(confirmations.map((c) => [String(c.complaint), c.response]));
  return ok(res, {
    complaints: rows.map((r) => ({ id: String(r._id), reference: r.reference, title: r.title, department: r.department, category: r.category, resolvedAt: r.resolution?.resolvedAt || null, proofs: proofBy.get(String(r._id)) || 0, confirmation: confBy.get(String(r._id)) || "NOT_ASKED" }))
  });
});

// ---- 2D FAQ ------------------------------------------------------------------------
export const faqAsk = asyncHandler(async (req, res) => ok(res, await ask(req.user, req.body)));
export const faqRequest = asyncHandler(async (req, res) => created(res, await createRequest(req.user, req.body), "Request filed with the office"));
export const faqSections = asyncHandler(async (_req, res) => ok(res, await listSections()));
export const faqSave = asyncHandler(async (req, res) => ok(res, await upsertSection(req.user, req.params.key, req.body), "Section saved"));
export const faqStatsHandler = asyncHandler(async (_req, res) => ok(res, await faqStats()));

// ---- 2E Board ------------------------------------------------------------------------
export const boardHandler = asyncHandler(async (req, res) => ok(res, await board({ hostel: req.query.hostel })));

// ---- 2H Adoption extension ----------------------------------------------------------
export const adoptionDatasets = asyncHandler(async (_req, res) =>
  ok(res, { datasets: Object.entries(DATASETS).map(([key, d]) => ({ key, label: d.label, columns: d.columns, note: d.note || null })), ...(await readiness()) })
);
export const adoptionTemplate = asyncHandler(async (req, res) => {
  const csv = template(req.params.dataset);
  res.set("Content-Type", "text/csv; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="${req.params.dataset}-template.csv"`);
  return res.send(csv);
});
export const adoptionValidate = asyncHandler(async (req, res) => ok(res, await validateDataset(req.params.dataset, req.body.csv)));
