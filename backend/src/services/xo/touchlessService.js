import { STAFF_ROLES } from "../../config/constants.js";
import { GatePass } from "../../models/GatePass.js";
import { User } from "../../models/User.js";
import { DocumentRequest } from "../../models/ext/DocumentRequest.js";
import { PolicySection } from "../../models/ext/PolicySection.js";
import { nextReference } from "../../models/ext/common.js";
import { CampusEvent } from "../../models/xo/CampusEvent.js";
import { PolicyRule } from "../../models/xo/PolicyRule.js";
import { ServiceRequest } from "../../models/xo/ServiceRequest.js";
import { ApiError } from "../../utils/ApiError.js";
import { round } from "../../utils/text.js";
import { record } from "../auditChainService.js";
import { issueToken } from "../gatePassService.js";
import { notify, notifyParent, notifyStaff } from "../notificationService.js";
import { issueDocument, requestDocument, reviewDocument, revokeDocument } from "../ext/certificateService.js";
import { audit } from "../ext/extAudit.js";
import { createNotice } from "../ext/noticeService.js";
import { emitEvent } from "./eventService.js";
import { bonafideFacts, feeReceiptFacts, findReceipt, gatePassFacts } from "./policyFacts.js";
import { DECISIONS, evaluate, summariseVerdict, validateRule } from "./policyEngine.js";
import { DEFAULT_RULES, POLICY_SOURCE, RULE_SECTIONS } from "./policyRules.js";

/**
 * The Touchless Lane (Phase 2).
 *
 * Routine requests — a bonafide certificate, a day outing after guardian
 * confirmation, a copy of a fee receipt — are decided by written, cited policy
 * with no human touch when every condition holds. Everything else goes to the
 * same person and the same screen as before, now with the failed conditions
 * attached. Staff can UNDO any policy decision (reason required, audited, the
 * student is told). The manual approval paths are not changed.
 */

const isStaff = (user) => STAFF_ROLES.includes(user?.role);

/** The actor recorded for a policy decision. Its role is POLICY, never a staff role. */
export const policyActor = (verdict) => ({ name: `Policy engine · ${verdict?.citation?.section || verdict?.matchedRule?.key || "policy"}`, role: "POLICY" });

// ---- rules ----------------------------------------------------------------------------

/** Seeds the default rules (ACTIVE, v1) and their cited sections when none exist. */
export async function ensureDefaultRules({ force = false } = {}) {
  // ROUND-3 HOOK (see CHANGES-ROUND3.md): the upserts below also bump updatedAt (Mongoose timestamps), so a
  // read-only policy preview was writing on every call. Skip them when every cited section already exists.
  const present = await PolicySection.countDocuments({ key: { $in: RULE_SECTIONS.map(([key]) => key) } });
  if (present < RULE_SECTIONS.length) for (const [key, category, section, title, body, keywords] of RULE_SECTIONS) {
    await PolicySection.updateOne(
      { key },
      { $setOnInsert: { key, category, title: `${section} ${title}`, body, keywords, source: POLICY_SOURCE, version: 1, updatedByName: "seed" } },
      { upsert: true }
    );
  }
  if (force) await PolicyRule.deleteMany({});
  // GATE-PASS SHORT OUTING (see CHANGES-GATEPASS-SHORT-OUTING.md): a default rule added after a campus was seeded
  // (e.g. GATEPASS-SHORT-SAMEDAY) is installed once, by key; rules already present, including edited versions, are untouched.
  const existing = new Set(force ? [] : await PolicyRule.distinct("key"));
  const missing = DEFAULT_RULES.filter((r) => !existing.has(r.key));
  if (!missing.length) return false;
  await PolicyRule.insertMany(
    missing.map((r) => ({ ...r, version: 1, status: "ACTIVE", active: true, source: "SEED", approvedByName: "Seeded demo policy", approvedAt: new Date(), history: [{ action: "RULE_SEEDED", actorName: "seed", actorRole: "SYSTEM", note: r.citation.section }] }))
  );
  return true;
}

export async function activeRules(requestType) {
  await ensureDefaultRules();
  return PolicyRule.find({ requestType, active: true }).lean();
}

export const shapeRule = (r) => ({
  id: String(r._id),
  key: r.key,
  version: r.version,
  requestType: r.requestType,
  title: r.title,
  action: r.action,
  status: r.status,
  active: r.active,
  conditions: (r.conditions || []).map((c) => ({ field: c.field, op: c.op, value: c.value, label: c.label, failText: c.failText })),
  citation: r.citation,
  source: r.source,
  approvedByName: r.approvedByName || null,
  approvedAt: r.approvedAt || null,
  notes: r.notes || null,
  updatedAt: r.updatedAt
});

export async function listRules({ section, includeDrafts = false } = {}) {
  await ensureDefaultRules();
  const filter = includeDrafts ? {} : { active: true };
  if (section) filter.$or = [{ "citation.key": section }, { "citation.related": section }];
  const rules = await PolicyRule.find(filter).sort({ requestType: 1, key: 1, version: -1 }).lean();
  return { rules: rules.map(shapeRule), method: "WRITTEN_POLICY_RULES", kind: "ACTUAL DATA" };
}

/** Saves a new DRAFT version of a rule. Never changes the live rule set. */
export async function saveDraft(actor, input, { source = "ADMIN" } = {}) {
  const errors = validateRule(input);
  if (errors.length) throw ApiError.badRequest(`The rule is not valid: ${errors.join("; ")}`);
  const key = String(input.key || `${input.requestType}-${Date.now().toString(36)}`).toUpperCase().replace(/[^A-Z0-9-]/g, "-").slice(0, 60);
  const latest = await PolicyRule.findOne({ key }).sort({ version: -1 }).lean();
  const rule = new PolicyRule({
    key,
    version: (latest?.version || 0) + 1,
    requestType: input.requestType,
    title: String(input.title || latest?.title || key).slice(0, 160),
    conditions: input.conditions,
    citation: input.citation,
    action: input.action,
    status: "DRAFT",
    active: false,
    source,
    notes: input.notes ? String(input.notes).slice(0, 600) : undefined
  });
  await audit(rule, { entityType: "PolicyRule", action: "RULE_DRAFTED", actor, channel: source, note: `${key} v${rule.version} · ${input.citation?.section}`, kind: "RECOMMENDED ACTION" });
  await rule.save();
  return shapeRule(rule.toObject());
}

/** An administrator activates a draft: it becomes the live version of its key. */
export async function activateRule(actor, id) {
  const rule = await PolicyRule.findById(id);
  if (!rule) throw ApiError.notFound("No rule with that id");
  if (rule.active) throw ApiError.badRequest("This version is already active");
  const retired = await PolicyRule.find({ key: rule.key, active: true });
  for (const old of retired) {
    old.active = false;
    old.status = "RETIRED";
    await audit(old, { entityType: "PolicyRule", action: "RULE_RETIRED", actor, note: `${old.key} v${old.version} replaced by v${rule.version}` });
    await old.save();
  }
  rule.active = true;
  rule.status = "ACTIVE";
  rule.approvedBy = actor._id;
  rule.approvedByName = actor.name;
  rule.approvedAt = new Date();
  await audit(rule, { entityType: "PolicyRule", action: "RULE_ACTIVATED", actor, field: "status", previousValue: "DRAFT", newValue: "ACTIVE", note: `${rule.key} v${rule.version} · ${rule.citation?.section}` });
  await rule.save();
  return shapeRule(rule.toObject());
}

// ---- dry run ---------------------------------------------------------------------------

/** What would the policy decide for this student right now? Writes nothing. */
export async function preview(user, { type, purpose, receipt, leaveAt, expectedReturnAt } = {}) {
  if (type === "BONAFIDE_CERTIFICATE") {
    const facts = await bonafideFacts(user, { purpose });
    return evaluate({ type, facts }, await activeRules(type));
  }
  if (type === "FEE_RECEIPT_COPY") {
    const facts = await feeReceiptFacts(user, { receipt });
    return evaluate({ type, facts }, await activeRules(type));
  }
  if (type === "GATE_PASS") {
    if (!leaveAt || !expectedReturnAt) throw ApiError.badRequest("leaveAt and expectedReturnAt are needed to preview a gate pass");
    const facts = await gatePassFacts({ _id: null, student: user._id, parent: { verified: true }, leaveAt, expectedReturnAt, createdAt: new Date() });
    const verdict = evaluate({ type, facts }, await activeRules(type));
    return { ...verdict, note: "Preview assumes your guardian confirms the code — that step is never skipped." };
  }
  throw ApiError.badRequest("type must be BONAFIDE_CERTIFICATE, GATE_PASS or FEE_RECEIPT_COPY");
}

// ---- certificates (page 14) -------------------------------------------------------------

/**
 * Runs the policy on a just-filed document request. Only BONAFIDE has a rule;
 * other types go to the office exactly as before. Returns the fresh record and
 * the verdict.
 */
export async function applyDocumentPolicy(doc, student, { now } = {}) {
  if (doc.type !== "BONAFIDE") return { doc, policy: { decision: "NOT_COVERED", reason: "No policy rule covers this certificate type, so the academic office reviews it as before.", citation: null } };
  const verdict = evaluate({ type: "BONAFIDE_CERTIFICATE", facts: await bonafideFacts(student, { purpose: doc.purpose, excludeId: doc._id }) }, await activeRules("BONAFIDE_CERTIFICATE"));
  const summary = summariseVerdict(verdict);
  const actor = policyActor(verdict);
  const base = { student: doc.student, subjectType: "DocumentRequest", subjectId: doc._id, subjectRef: doc.reference, department: "ACADEMIC OFFICE" };
  if (verdict.decision === DECISIONS.AUTO) {
    await reviewDocument(doc._id, actor, { decision: "APPROVE" });
    await issueDocument(doc._id, actor, now ? { now } : undefined);
    const fresh = await DocumentRequest.findById(doc._id);
    fresh.decidedBy = "POLICY";
    fresh.policyDecision = summary;
    await audit(fresh, { entityType: "DocumentRequest", action: "POLICY_AUTO_APPROVED", actor, channel: "POLICY", note: `${verdict.citation.section} · ${verdict.passedConditions.length} conditions checked · 0 human touches` });
    await fresh.save();
    emitEvent({ ...base, type: "POLICY_DECISION", actor, channel: "POLICY", payload: { decision: verdict.decision, rule: verdict.matchedRule?.key, section: verdict.citation?.section } });
    return { doc: fresh, policy: summary };
  }
  doc.policyDecision = summary;
  await audit(doc, { entityType: "DocumentRequest", action: "POLICY_ROUTED_TO_HUMAN", actor, channel: "POLICY", note: `${verdict.citation?.section || "no rule"} · ${verdict.failedConditions.map((c) => c.label).join("; ") || verdict.reason}` });
  await doc.save();
  emitEvent({ ...base, type: "POLICY_DECISION", actor, channel: "POLICY", payload: { decision: verdict.decision, rule: verdict.matchedRule?.key, failed: verdict.failedConditions.map((c) => c.field) } });
  return { doc, policy: summary };
}

// ---- gate passes (page 11) ----------------------------------------------------------------

/**
 * Runs after the guardian's code is verified (the pass is already in the
 * warden's queue). In-policy: approved now, QR issued, the warden told FYI
 * with UNDO. Out of policy: it stays with the warden with the reasons.
 */
export async function applyGatePassPolicy(gatePass, { now } = {}) {
  const verdict = evaluate({ type: "GATE_PASS", facts: await gatePassFacts(gatePass, now ? { now } : undefined) }, await activeRules("GATE_PASS"));
  const summary = summariseVerdict(verdict);
  const actor = policyActor(verdict);
  const student = gatePass.student?._id || gatePass.student;
  const base = { student, subjectType: "GatePass", subjectId: gatePass._id, subjectRef: gatePass.reference };
  if (verdict.decision !== DECISIONS.AUTO) {
    gatePass.policyDecision = summary;
    gatePass.log(actor.name, `Sent to the warden — ${verdict.failedConditions.map((c) => c.label).join("; ") || verdict.reason}`, "ACTUAL DATA");
    await gatePass.save();
    await record({ entityType: "GatePass", entityId: gatePass._id, entityRef: gatePass.reference, action: "POLICY_ROUTED_TO_HUMAN", actor, note: `${verdict.citation?.section || "no rule"} · ${verdict.failedConditions.length} condition(s) not met` });
    emitEvent({ ...base, type: "POLICY_DECISION", actor, channel: "POLICY", payload: { decision: verdict.decision, rule: verdict.matchedRule?.key, failed: verdict.failedConditions.map((c) => c.field) } });
    return { approved: false, policy: summary };
  }
  gatePass.status = "APPROVED";
  gatePass.approval = { decision: "APPROVED", decidedByName: actor.name, decidedAt: new Date(), note: `Approved under ${verdict.citation.section} — ${verdict.matchedRule.title}` };
  gatePass.decidedBy = "POLICY";
  gatePass.policyDecision = summary;
  const payload = issueToken(gatePass);
  gatePass.log(actor.name, `Approved under ${verdict.citation.section} · ${verdict.passedConditions.length} conditions checked · QR issued · warden informed (can undo)`, "ACTUAL DATA");
  await gatePass.save();
  await record({ entityType: "GatePass", entityId: gatePass._id, entityRef: gatePass.reference, action: "POLICY_AUTO_APPROVED", field: "status", previousValue: "PENDING_WARDEN_APPROVAL", newValue: "APPROVED", actor, note: `${verdict.citation.section} · 0 human touches` });
  emitEvent({ ...base, type: "GATEPASS_APPROVED", actor, channel: "POLICY", payload: { rule: verdict.matchedRule?.key, section: verdict.citation?.section } });

  await notify({ kind: "GATE_PASS_APPROVED", audience: "STUDENT", user: student, gatePass: gatePass._id, title: "Gate pass approved", body: `${gatePass.reference} is approved under ${verdict.citation.section}. Scan your QR at the gate when you leave.`, tone: "low" });
  const withPhone = await User.findById(student).select("+parentPhone name");
  if (withPhone?.parentPhone) {
    await notifyParent({ kind: "GATE_PASS_APPROVED", gatePass, phone: withPhone.parentPhone, title: "Gate pass approved", body: `${withPhone.name}'s gate pass ${gatePass.reference} is approved under hostel rule ${verdict.citation.section} after your confirmation. Expected back by ${new Date(gatePass.expectedReturnAt).toLocaleString("en-IN", { hour12: true, timeZone: "Asia/Kolkata" })}.` });
  }
  await notifyStaff({ kind: "GATE_PASS_APPROVED", gatePass, hostelId: gatePass.hostel, title: `FYI — ${gatePass.reference} approved under ${verdict.citation.section}`, body: `${gatePass.hostelName || "Hostel"} · ${gatePass.reason}. No action needed; UNDO in the warden console if it should not stand.`, tone: "low" });
  return { approved: true, policy: summary, payload };
}

// ---- fee receipt copy (page 16) -------------------------------------------------------------

export const shapeService = (s) => ({
  id: String(s._id),
  reference: s.reference,
  type: s.type,
  receipt: s.receipt,
  purpose: s.purpose || null,
  status: s.status,
  channel: s.channel,
  decidedBy: s.decidedBy || null,
  decidedByName: s.decidedByName || null,
  decidedAt: s.decidedAt || null,
  policyDecision: s.policyDecision || null,
  policyUndo: s.policyUndo || null,
  rejectionReason: s.rejectionReason || null,
  output: s.output || null,
  history: s.history || [],
  student: s.student?.name ? { name: s.student.name, studentId: s.student.studentId } : undefined,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt
});

export async function requestReceiptCopy(student, { receipt, purpose, channel = "APP" }) {
  if (!receipt || String(receipt).trim().length < 3) throw ApiError.badRequest("Enter the receipt number printed on your payment");
  const request = new ServiceRequest({ reference: await nextReference("SRV"), student: student._id, type: "FEE_RECEIPT_COPY", receipt: String(receipt).trim().toUpperCase(), purpose, channel });
  await audit(request, { entityType: "ServiceBooking", action: "SERVICE_REQUESTED", actor: student, channel, note: `Fee receipt copy ${request.receipt}` });
  await request.save();
  const base = { student: student._id, subjectType: "ServiceRequest", subjectId: request._id, subjectRef: request.reference, department: "ACCOUNTS OFFICE" };
  emitEvent({ ...base, type: "SERVICE_REQUESTED", actor: student, channel, payload: { serviceType: request.type } });

  const verdict = evaluate({ type: "FEE_RECEIPT_COPY", facts: await feeReceiptFacts(student, { receipt: request.receipt, excludeId: request._id }) }, await activeRules("FEE_RECEIPT_COPY"));
  const actor = policyActor(verdict);
  request.policyDecision = summariseVerdict(verdict);
  if (verdict.decision === DECISIONS.AUTO) {
    const found = await findReceipt(student, request.receipt);
    request.status = "FULFILLED";
    request.decidedBy = "POLICY";
    request.decidedByName = actor.name;
    request.decidedAt = new Date();
    request.output = { ...found, copyOf: found.receipt, issuedAt: new Date(), note: "Duplicate copy re-stated from the fee ledger. The original receipt number is unchanged.", kind: "ACTUAL DATA" };
    await audit(request, { entityType: "ServiceBooking", action: "POLICY_AUTO_APPROVED", actor, channel: "POLICY", note: `${verdict.citation.section} · 0 human touches` });
    emitEvent({ ...base, type: "SERVICE_FULFILLED", actor, channel: "POLICY", payload: { rule: verdict.matchedRule?.key } });
  } else {
    request.status = "UNDER_REVIEW";
    await audit(request, { entityType: "ServiceBooking", action: "POLICY_ROUTED_TO_HUMAN", actor, channel: "POLICY", note: verdict.failedConditions.map((c) => c.label).join("; ") || verdict.reason });
  }
  emitEvent({ ...base, type: "POLICY_DECISION", actor, channel: "POLICY", payload: { decision: verdict.decision, rule: verdict.matchedRule?.key } });
  await request.save();
  return shapeService(request.toObject());
}

export async function listServiceRequests(user, { status } = {}) {
  const filter = isStaff(user) ? {} : { student: user._id };
  if (status) filter.status = status;
  const rows = await ServiceRequest.find(filter).sort({ createdAt: -1 }).limit(60).populate("student", "name studentId").lean();
  return { requests: rows.map(shapeService), method: "DATABASE_RECORDS", kind: "ACTUAL DATA" };
}

/** The accounts office decides a request the policy sent to a person. */
export async function decideServiceRequest(id, actor, { decision, reason }) {
  const request = await ServiceRequest.findById(id);
  if (!request) throw ApiError.notFound("No service request with that id");
  if (!["SUBMITTED", "UNDER_REVIEW"].includes(request.status)) throw ApiError.badRequest(`A request in ${request.status} cannot be decided`);
  if (decision === "REJECT" && (!reason || String(reason).trim().length < 5)) throw ApiError.badRequest("A rejection needs a reason (at least 5 characters)");
  const student = await User.findById(request.student);
  const previous = request.status;
  if (decision === "FULFILL") {
    const found = await findReceipt(student, request.receipt);
    request.status = "FULFILLED";
    request.output = found ? { ...found, copyOf: found.receipt, issuedAt: new Date(), kind: "ACTUAL DATA" } : { note: reason || "Issued after the accounts office checked the payment", issuedAt: new Date(), kind: "ACTUAL DATA" };
  } else if (decision === "REJECT") {
    request.status = "REJECTED";
    request.rejectionReason = String(reason).trim();
  } else throw ApiError.badRequest("decision must be FULFILL or REJECT");
  request.decidedBy = "HUMAN";
  request.decidedByName = actor.name;
  request.decidedAt = new Date();
  await audit(request, { entityType: "ServiceBooking", action: `SERVICE_${request.status}`, actor, field: "status", previousValue: previous, newValue: request.status, note: reason });
  await request.save();
  emitEvent({ type: request.status === "FULFILLED" ? "SERVICE_FULFILLED" : "POLICY_DECISION", actor, student: request.student, subjectType: "ServiceRequest", subjectId: request._id, subjectRef: request.reference, department: "ACCOUNTS OFFICE", channel: "APP", payload: { decision } });
  return shapeService(request.toObject());
}

// ---- UNDO ---------------------------------------------------------------------------------------

async function tellStudent(studentId, actor, title, body) {
  try {
    return await createNotice({ title, body, priority: "HIGH", overrideQuietHours: true, audience: { users: [String(studentId)] } }, actor, { kind: "GENERAL" });
  } catch (error) {
    console.error("touchlessService: could not notify the student —", error.message);
    return null;
  }
}

/**
 * Staff reverse a policy decision. The request goes back to a person; the
 * student is told who undid it and why; the chain records it.
 */
export async function undoPolicyDecision(kind, id, actor, reason) {
  if (!isStaff(actor)) throw ApiError.forbidden("Only staff can undo a policy decision");
  const why = String(reason || "").trim();
  if (why.length < 5) throw ApiError.badRequest("Give a reason for the undo (at least 5 characters) — the student is shown it");
  const undo = { byName: actor.name, byRole: actor.role, by: actor._id, at: new Date(), reason: why };

  if (kind === "gatepass") {
    const gatePass = await GatePass.findById(id);
    if (!gatePass) throw ApiError.notFound("Gate pass not found");
    if (gatePass.decidedBy !== "POLICY" || gatePass.policyUndo) throw ApiError.badRequest("This pass was not approved by policy (or was already undone)");
    if (gatePass.status !== "APPROVED") throw ApiError.badRequest(`A pass in ${gatePass.status} cannot be undone — it has already been used at the gate or closed`);
    gatePass.status = "PENDING_WARDEN_APPROVAL";
    gatePass.approval = undefined;
    gatePass.set("pass.tokenHash", undefined);
    gatePass.set("pass.nonce", undefined); // GATE-PASS QR FIX (see CHANGES-GATEPASS-QR-FIX.md)
    gatePass.set("pass.issuedAt", undefined);
    gatePass.decidedBy = undefined;
    gatePass.policyUndo = undo;
    gatePass.log(actor.name, `Policy approval undone — ${why}. QR withdrawn; back with the warden.`, "ACTUAL DATA");
    await gatePass.save();
    await record({ entityType: "GatePass", entityId: gatePass._id, entityRef: gatePass.reference, action: "POLICY_DECISION_UNDONE", field: "status", previousValue: "APPROVED", newValue: "PENDING_WARDEN_APPROVAL", actor, note: why });
    emitEvent({ type: "POLICY_UNDONE", actor, student: gatePass.student, subjectType: "GatePass", subjectId: gatePass._id, subjectRef: gatePass.reference, channel: "APP", payload: { reason: why } });
    await tellStudent(gatePass.student, actor, `Gate pass ${gatePass.reference}: automatic approval undone`, `${actor.name} (${actor.role}) undid the automatic approval: ${why}. Your QR code no longer works; the warden will decide.`);
    await notifyStaff({ kind: "GATE_PASS_SUBMITTED", gatePass, hostelId: gatePass.hostel, title: `Gate pass awaiting approval — policy decision undone`, body: `${gatePass.reference} · undone by ${actor.name}: ${why}`, tone: "mid" });
    return { kind, id: String(gatePass._id), reference: gatePass.reference, status: gatePass.status, undo };
  }

  if (kind === "document") {
    const doc = await DocumentRequest.findById(id);
    if (!doc) throw ApiError.notFound("No document request with that id");
    if (doc.decidedBy !== "POLICY" || doc.policyUndo) throw ApiError.badRequest("This certificate was not issued by policy (or was already undone)");
    if (doc.status !== "ISSUED" || doc.certificate?.revokedAt) throw ApiError.badRequest("Only an issued, unrevoked certificate can be undone");
    await revokeDocument(doc._id, actor, `Policy decision undone: ${why}`);
    const student = await User.findById(doc.student);
    // A fresh request goes to the office, so the student is not left with nothing.
    const followUp = await requestDocument(student, { type: doc.type, purpose: doc.purpose }, { channel: doc.channel, actor });
    followUp.policyUndo = { ...undo, from: doc.reference };
    await audit(followUp, { entityType: "DocumentRequest", action: "REOPENED_AFTER_POLICY_UNDO", actor, note: `${doc.reference} revoked · ${why}` });
    await followUp.save();
    const fresh = await DocumentRequest.findById(doc._id);
    fresh.policyUndo = { ...undo, followUp: followUp.reference };
    await audit(fresh, { entityType: "DocumentRequest", action: "POLICY_DECISION_UNDONE", actor, note: why });
    await fresh.save();
    emitEvent({ type: "POLICY_UNDONE", actor, student: doc.student, subjectType: "DocumentRequest", subjectId: doc._id, subjectRef: doc.reference, department: "ACADEMIC OFFICE", channel: "APP", payload: { reason: why, followUp: followUp.reference } });
    await tellStudent(doc.student, actor, `Certificate ${doc.reference}: automatic issue undone`, `${actor.name} (${actor.role}) withdrew the instantly issued certificate: ${why}. A new request ${followUp.reference} is with the academic office; you do not need to apply again.`);
    return { kind, id: String(doc._id), reference: doc.reference, status: "REVOKED", followUp: followUp.reference, undo };
  }

  if (kind === "service") {
    const request = await ServiceRequest.findById(id);
    if (!request) throw ApiError.notFound("No service request with that id");
    if (request.decidedBy !== "POLICY" || request.policyUndo) throw ApiError.badRequest("This request was not decided by policy (or was already undone)");
    request.status = "UNDER_REVIEW";
    request.decidedBy = undefined;
    request.policyUndo = undo;
    request.output = request.output ? { ...request.output, withdrawn: true, withdrawnReason: why } : undefined;
    await audit(request, { entityType: "ServiceBooking", action: "POLICY_DECISION_UNDONE", actor, field: "status", previousValue: "FULFILLED", newValue: "UNDER_REVIEW", note: why });
    await request.save();
    emitEvent({ type: "POLICY_UNDONE", actor, student: request.student, subjectType: "ServiceRequest", subjectId: request._id, subjectRef: request.reference, department: "ACCOUNTS OFFICE", channel: "APP", payload: { reason: why } });
    await tellStudent(request.student, actor, `Receipt copy ${request.reference}: automatic issue undone`, `${actor.name} (${actor.role}) withdrew the copy: ${why}. The accounts office will check it.`);
    return { kind, id: String(request._id), reference: request.reference, status: request.status, undo };
  }
  throw ApiError.badRequest("kind must be gatepass, document or service");
}

// ---- exceptions inbox (page 10) ---------------------------------------------------------------

const hoursSince = (at, now) => round((now - new Date(at)) / 3600000, 1);
const whyFrom = (policy, fallback) => {
  if (policy?.failedConditions?.length) return policy.failedConditions.map((c) => ({ label: c.label, explanation: c.explanation, actual: c.actual }));
  // Sent to a person by an exception rule (e.g. visa use): name that rule.
  if (policy?.decision === "ROUTE_TO_HUMAN" && policy.matchedRule) return [{ label: policy.matchedRule.title, explanation: policy.reason }];
  return [{ label: fallback, explanation: policy?.reason || fallback }];
};

/** Only what needs a person — with the reason it needs one — plus policy decisions to glance at. */
export async function exceptionsInbox({ now = new Date(), fyiHours = 72 } = {}) {
  const since = new Date(now - fyiHours * 3600000);
  const [docs, passes, services, docFyi, passFyi, serviceFyi] = await Promise.all([
    DocumentRequest.find({ status: { $in: ["SUBMITTED", "UNDER_REVIEW", "APPROVED"] } }).populate("student", "name studentId hostelName").sort({ createdAt: 1 }).lean(),
    GatePass.find({ status: "PENDING_WARDEN_APPROVAL" }).populate("student", "name studentId hostelName").sort({ createdAt: 1 }).lean(),
    ServiceRequest.find({ status: { $in: ["SUBMITTED", "UNDER_REVIEW"] } }).populate("student", "name studentId hostelName").sort({ createdAt: 1 }).lean(),
    DocumentRequest.find({ decidedBy: "POLICY", "certificate.issuedAt": { $gte: since } }).populate("student", "name studentId").sort({ "certificate.issuedAt": -1 }).lean(),
    GatePass.find({ decidedBy: "POLICY", "approval.decidedAt": { $gte: since } }).populate("student", "name studentId").sort({ "approval.decidedAt": -1 }).lean(),
    ServiceRequest.find({ decidedBy: "POLICY", decidedAt: { $gte: since } }).populate("student", "name studentId").sort({ decidedAt: -1 }).lean()
  ]);
  const who = (s) => (s?.name ? { name: s.name, studentId: s.studentId, hostel: s.hostelName || null } : null);
  const exceptions = [
    ...docs.map((d) => ({
      kind: "document", id: String(d._id), reference: d.reference, title: `${d.type.replace("_", " ")} certificate — ${d.purpose}`, status: d.status, student: who(d.student), ageHours: hoursSince(d.createdAt, now), owner: "Academic office", ownerPage: "documents",
      why: d.type !== "BONAFIDE" ? [{ label: "No policy rule covers this type", explanation: `${d.type.replace("_", " ")} certificates are always reviewed by the academic office.` }] : d.policyUndo ? [{ label: "Policy decision undone", explanation: `${d.policyUndo.byName}: ${d.policyUndo.reason}` }] : whyFrom(d.policyDecision, "Filed before the Touchless Lane — not evaluated"),
      citation: d.policyDecision?.citation || null
    })),
    ...passes.map((g) => ({
      kind: "gatepass", id: String(g._id), reference: g.reference, title: `Gate pass — ${g.reason}`, status: g.status, student: who(g.student), ageHours: hoursSince(g.createdAt, now), owner: "Hostel warden", ownerPage: "gatepass",
      why: g.policyUndo ? [{ label: "Policy decision undone", explanation: `${g.policyUndo.byName}: ${g.policyUndo.reason}` }] : whyFrom(g.policyDecision, "Not evaluated by the policy engine"),
      citation: g.policyDecision?.citation || null
    })),
    ...services.map((s) => ({
      kind: "service", id: String(s._id), reference: s.reference, title: `Fee receipt copy — ${s.receipt}`, status: s.status, student: who(s.student), ageHours: hoursSince(s.createdAt, now), owner: "Accounts office", ownerPage: "fees",
      why: s.policyUndo ? [{ label: "Policy decision undone", explanation: `${s.policyUndo.byName}: ${s.policyUndo.reason}` }] : whyFrom(s.policyDecision, "Not evaluated"),
      citation: s.policyDecision?.citation || null
    }))
  ].sort((a, b) => b.ageHours - a.ageHours);

  const fyi = [
    ...docFyi.map((d) => ({ kind: "document", id: String(d._id), reference: d.reference, title: `Bonafide certificate — ${d.purpose}`, student: who(d.student), decidedAt: d.certificate?.issuedAt, citation: d.policyDecision?.citation, undone: Boolean(d.policyUndo), canUndo: !d.policyUndo && !d.certificate?.revokedAt, undoBlocked: d.policyUndo ? `Undone by ${d.policyUndo.byName}` : d.certificate?.revokedAt ? "Certificate already revoked" : null })),
    ...passFyi.map((g) => ({ kind: "gatepass", id: String(g._id), reference: g.reference, title: `Gate pass — ${g.reason}`, student: who(g.student), decidedAt: g.approval?.decidedAt, citation: g.policyDecision?.citation, status: g.status, undone: Boolean(g.policyUndo), canUndo: g.status === "APPROVED" && !g.policyUndo, undoBlocked: g.status !== "APPROVED" ? `Already ${g.status.toLowerCase().replace(/_/g, " ")} — used at the gate` : null })),
    ...serviceFyi.map((s) => ({ kind: "service", id: String(s._id), reference: s.reference, title: `Fee receipt copy — ${s.receipt}`, student: who(s.student), decidedAt: s.decidedAt, citation: s.policyDecision?.citation, undone: Boolean(s.policyUndo), canUndo: !s.policyUndo, undoBlocked: null }))
  ].sort((a, b) => new Date(b.decidedAt) - new Date(a.decidedAt));

  return {
    exceptions,
    fyi,
    counts: { exceptions: exceptions.length, fyi: fyi.length, byOwner: Object.entries(exceptions.reduce((t, e) => ({ ...t, [e.owner]: (t[e.owner] || 0) + 1 }), {})).map(([owner, n]) => ({ owner, n })) },
    window: { fyiHours },
    note: "Only requests that need a person are listed as exceptions, each with the policy conditions it failed. Requests decided by written policy are listed as FYI for 72 hours with UNDO.",
    method: "POLICY_VERDICTS_ON_OPEN_RECORDS",
    kind: "ACTUAL DATA"
  };
}

// ---- Touchless Rate (page 10 KPI) ---------------------------------------------------------------

/** Pure: the rate from per-type rows. */
export function touchlessRateFrom(rows) {
  const closed = rows.reduce((t, r) => t + r.closed, 0);
  const zero = rows.reduce((t, r) => t + r.zeroTouch, 0);
  return { closed, zeroTouch: zero, ratePct: closed ? round((zero / closed) * 100, 1) : null };
}

export async function touchlessRate({ days = 30, now = new Date() } = {}) {
  const since = new Date(now - days * 864e5);
  const [docs, passes, services] = await Promise.all([
    DocumentRequest.find({ status: { $in: ["ISSUED", "REJECTED"] }, updatedAt: { $gte: since } }).select("reference decidedBy status type").lean(),
    GatePass.find({ "approval.decidedAt": { $gte: since } }).select("reference decidedBy status").lean(),
    ServiceRequest.find({ status: { $in: ["FULFILLED", "REJECTED"] }, updatedAt: { $gte: since } }).select("reference decidedBy status").lean()
  ]);
  const ids = [...docs, ...passes, ...services].map((r) => String(r._id));
  const touches = await CampusEvent.aggregate([{ $match: { subjectId: { $in: ids }, humanTouch: true } }, { $group: { _id: "$subjectId", n: { $sum: 1 } } }]);
  const touchBy = new Map(touches.map((t) => [t._id, t.n]));
  const row = (label, list) => {
    const zero = list.filter((r) => !touchBy.get(String(r._id)));
    return {
      type: label,
      closed: list.length,
      zeroTouch: zero.length,
      ratePct: list.length ? round((zero.length / list.length) * 100, 1) : null,
      byPolicy: list.filter((r) => r.decidedBy === "POLICY").length,
      humanTouches: list.reduce((t, r) => t + (touchBy.get(String(r._id)) || 0), 0),
      examples: zero.slice(0, 3).map((r) => r.reference)
    };
  };
  const rows = [row("Certificates", docs), row("Gate passes", passes), row("Fee receipt copies", services)];
  const total = touchlessRateFrom(rows);
  return {
    window: { days, since },
    ...total,
    rows,
    calculation: {
      formula: "Touchless Rate = requests closed with 0 human touches ÷ all requests closed in the window",
      numerator: total.zeroTouch,
      denominator: total.closed,
      humanTouch: "A human touch is a Campus Event on the request whose actor is staff (ADMIN, WARDEN, FACILITY_MANAGER, MESS_MANAGER) and whose channel is not POLICY — an approval, review, issue or rejection by a person.",
      closed: "Certificates ISSUED or REJECTED, gate passes with a decision, receipt copies FULFILLED or REJECTED, in the window.",
      source: "CampusEvent log (live events plus events derived from stored records by the backfill)"
    },
    insufficient: total.closed < 5 ? "Insufficient data — fewer than 5 requests closed in the window." : null,
    method: "CAMPUS_EVENT_HUMAN_TOUCH_COUNT",
    kind: total.closed < 5 ? "INSUFFICIENT DATA" : "ACTUAL DATA"
  };
}
