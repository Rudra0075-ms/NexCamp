import { GatePass } from "../../models/GatePass.js";
import { User } from "../../models/User.js";
import { DocumentRequest } from "../../models/ext/DocumentRequest.js";
import { PolicyRule } from "../../models/xo/PolicyRule.js";
import { ServiceRequest } from "../../models/xo/ServiceRequest.js";
import { ApiError } from "../../utils/ApiError.js";
import { round } from "../../utils/text.js";
import { bonafideFacts, feeReceiptFacts, gatePassFacts } from "./policyFacts.js";
import { DECISIONS, evaluate, validateRule } from "./policyEngine.js";
import { median } from "./responseStats.js";
import { ensureDefaultRules } from "./touchlessService.js";

/**
 * Policy what-if (Phase 8, page 09): re-run the last N days of real requests
 * under an edited copy of the rules. Nothing is written — the live rules stay
 * exactly as they are until an administrator saves a draft and activates it.
 * Every figure here is SIMULATED; the assumptions are listed with the result.
 */

export const MINUTES_PER_HUMAN_DECISION = 6; // ASSUMPTION — staff time to read and decide one routine request
const TYPES = { BONAFIDE_CERTIFICATE: "Certificates", GATE_PASS: "Gate passes", FEE_RECEIPT_COPY: "Fee receipt copies" };

export const ASSUMPTIONS = [
  "Facts are re-read from today's records: the fee ledger as it stands now, request counts in the 30 days before each request, the gate-pass register before each pass.",
  "A request auto-approved under the edited rules is taken to be decided the moment it was filed (wait 0).",
  "A request still sent to a person keeps its real wait; a request never decided keeps its wait so far.",
  `Staff time: ${MINUTES_PER_HUMAN_DECISION} minutes per human decision (ASSUMPTION).`,
  "A 'rule violation' is a request the edited rules would newly auto-approve that a person actually rejected, or whose automatic decision was undone — the cases the edit would have got wrong."
];

const hours = (a, b) => (new Date(b) - new Date(a)) / 3600000;

async function history({ days, now }) {
  const since = new Date(now - days * 864e5);
  const [docs, passes, services] = await Promise.all([
    DocumentRequest.find({ type: "BONAFIDE", createdAt: { $gte: since } }).lean(),
    GatePass.find({ createdAt: { $gte: since }, "parent.verified": true }).lean(),
    ServiceRequest.find({ createdAt: { $gte: since } }).lean()
  ]);
  const students = new Map((await User.find({ _id: { $in: [...docs, ...passes, ...services].map((r) => r.student) } }).select("name role studentId").lean()).map((u) => [String(u._id), u]));
  const rows = [];
  for (const d of docs) {
    const student = students.get(String(d.student));
    if (!student) continue;
    const decidedAt = d.certificate?.issuedAt || (d.status === "REJECTED" ? d.reviewedAt : null);
    rows.push({ type: "BONAFIDE_CERTIFICATE", reference: d.reference, createdAt: d.createdAt, facts: await bonafideFacts(student, { purpose: d.purpose, excludeId: d._id, now: new Date(d.createdAt) }), actual: { decidedBy: d.decidedBy || (decidedAt ? "HUMAN" : null), rejected: d.status === "REJECTED", undone: Boolean(d.policyUndo && !d.policyUndo.from), waitHours: decidedAt ? hours(d.createdAt, decidedAt) : hours(d.createdAt, now), open: !decidedAt } });
  }
  for (const g of passes) {
    const decidedAt = g.approval?.decidedAt || null;
    const start = g.parent?.verifiedAt || g.createdAt;
    rows.push({ type: "GATE_PASS", reference: g.reference, createdAt: start, facts: await gatePassFacts(g, { now: new Date(g.createdAt) }), actual: { decidedBy: g.decidedBy || (decidedAt ? "HUMAN" : null), rejected: g.approval?.decision === "REJECTED", undone: Boolean(g.policyUndo), waitHours: decidedAt ? Math.max(0, hours(start, decidedAt)) : hours(start, now), open: !decidedAt } });
  }
  for (const s of services) {
    const student = students.get(String(s.student));
    if (!student) continue;
    rows.push({ type: "FEE_RECEIPT_COPY", reference: s.reference, createdAt: s.createdAt, facts: await feeReceiptFacts(student, { receipt: s.receipt, excludeId: s._id, now: new Date(s.createdAt) }), actual: { decidedBy: s.decidedBy || null, rejected: s.status === "REJECTED", undone: Boolean(s.policyUndo), waitHours: s.decidedAt ? hours(s.createdAt, s.decidedAt) : hours(s.createdAt, now), open: !s.decidedAt } });
  }
  return rows;
}

/** Pure: before/after metrics for one request type. */
export function compareType(rows, liveRules, editedRules) {
  const outcomes = rows.map((r) => {
    const before = evaluate({ type: r.type, facts: r.facts }, liveRules).decision;
    const after = evaluate({ type: r.type, facts: r.facts }, editedRules).decision;
    return { ...r, before, after };
  });
  const auto = (key) => outcomes.filter((o) => o[key] === DECISIONS.AUTO).length;
  const wait = (key) => outcomes.map((o) => (o[key] === DECISIONS.AUTO ? 0 : o.actual.waitHours));
  // Caused by the edit: newly auto-approved, but a person had rejected it or undone its approval.
  const violations = outcomes.filter((o) => o.after === DECISIONS.AUTO && o.before !== DECISIONS.AUTO && (o.actual.rejected || o.actual.undone));
  const n = outcomes.length;
  const humanBefore = n - auto("before");
  const humanAfter = n - auto("after");
  return {
    requests: n,
    autoApprovalPct: { before: n ? round((auto("before") / n) * 100, 1) : null, after: n ? round((auto("after") / n) * 100, 1) : null },
    humanDecisions: { before: humanBefore, after: humanAfter, change: humanAfter - humanBefore },
    staffMinutes: { before: humanBefore * MINUTES_PER_HUMAN_DECISION, after: humanAfter * MINUTES_PER_HUMAN_DECISION },
    medianWaitHours: { before: n ? round(median(wait("before")), 2) : null, after: n ? round(median(wait("after")), 2) : null },
    violations: violations.map((v) => ({ reference: v.reference, why: v.actual.rejected ? "a person rejected it" : "its automatic decision was undone" })),
    changed: outcomes.filter((o) => o.before !== o.after).map((o) => ({ reference: o.reference, before: o.before, after: o.after })).slice(0, 20)
  };
}

/**
 * Runs the replay. `edits` is a list of rule definitions (an edited copy of
 * one or more live rules, same keys). Unedited live rules are kept as they are.
 */
export async function replay({ days = 30, edits = [], now = new Date() } = {}) {
  await ensureDefaultRules();
  for (const e of edits) {
    const errors = validateRule(e);
    if (errors.length) throw ApiError.badRequest(`Edited rule ${e.key || ""} is not valid: ${errors.join("; ")}`);
  }
  const live = await PolicyRule.find({ active: true }).lean();
  const editedKeys = new Set(edits.map((e) => e.key));
  const edited = [...live.filter((r) => !editedKeys.has(r.key)), ...edits.map((e) => ({ ...e, active: true, status: "ACTIVE", version: 999 }))];
  const rows = await history({ days, now });
  const byType = Object.entries(TYPES).map(([type, label]) => ({ type, label, ...compareType(rows.filter((r) => r.type === type), live, edited) }));
  const all = compareType(rows, live, edited);
  return {
    window: { days, since: new Date(now - days * 864e5) },
    edits: edits.map((e) => ({ key: e.key, conditions: e.conditions })),
    totals: all,
    byType,
    assumptions: ASSUMPTIONS,
    liveRulesUnchanged: true,
    note: "SIMULATED on real requests from the window. The live rules are not changed: save the edit as a draft, and an administrator activates it.",
    method: "POLICY_REPLAY_ON_HISTORY",
    kind: rows.length < 5 ? "INSUFFICIENT DATA" : "SIMULATED"
  };
}
