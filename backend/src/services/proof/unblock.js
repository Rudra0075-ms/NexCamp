import { DocumentRequest } from "../../models/ext/DocumentRequest.js";
import { GatePass } from "../../models/GatePass.js";
import { istDateKey, istInstant, weekdayOf } from "../ext/istTime.js";
import { preview } from "../xo/touchlessService.js";

/**
 * F9 — Unblock path (page 17).
 *
 * For one student: which of their requests (pending, or the routine ones
 * they are likely to make next) are held back by which policy condition, and
 * the single action that unblocks the most of them. Uses the Policy Engine's
 * own dry run (touchlessService.preview) — nothing is written.
 */

const ACTIONS = {
  overdueDues: (c) => ({ action: `Clear the ₹${Number(c.actual || 0).toLocaleString("en-IN")} overdue on your fee ledger`, page: "fees", pageLabel: "16 Fees & Dues" }),
  requestsLast30Days: () => ({ action: "Wait until an earlier request is more than 30 days old", page: "requests", pageLabel: "17 My Requests" }),
  lateReturnsLast30Days: (c) => ({ action: `Keep a clean return record — ${c.actual} late return(s) in 30 days send passes to the warden`, page: "gatepass", pageLabel: "11 Hostel Gate Pass" }),
  enrolled: () => ({ action: "Ask the academic office to link your student ID to this account", page: "faq", pageLabel: "19 Office FAQ" }),
  receiptOnLedger: () => ({ action: "Check the receipt number against your fee ledger", page: "fees", pageLabel: "16 Fees & Dues" }),
  purposeVisa: () => ({ action: "Visa letters always go to the office — apply early", page: "documents", pageLabel: "14 Certificates" })
};
// Conditions that describe the request itself, not the student — the student cannot "clear" them.
const REQUEST_SHAPE = new Set(["leadTimeHours", "durationHours", "returnBeforeCutoff", "guardianOtpVerified", "copiesLast30Days"]);

/** Pure: blockers → the action that unblocks the most requests. */
export function unblockGraph(requests) {
  const byField = new Map();
  for (const r of requests) for (const c of r.failed) {
    if (REQUEST_SHAPE.has(c.field)) continue;
    if (!byField.has(c.field)) byField.set(c.field, { field: c.field, condition: c, requests: [] });
    byField.get(c.field).requests.push({ key: r.key, label: r.label });
  }
  const blockers = [...byField.values()].map((b) => ({ ...b, ...(ACTIONS[b.field] ? ACTIONS[b.field](b.condition) : { action: b.condition.label, page: null }), unblocks: b.requests.length })).sort((a, b) => b.unblocks - a.unblocks);
  // A request is fully unblocked by an action only when that is its only student-side blocker.
  for (const b of blockers) b.fullyUnblocks = requests.filter((r) => r.failed.filter((c) => !REQUEST_SHAPE.has(c.field)).every((c) => c.field === b.field) && r.failed.some((c) => c.field === b.field)).map((r) => r.label);
  return { blockers, best: blockers[0] || null };
}

function nextSaturday(now) {
  for (let i = 1; i <= 7; i += 1) {
    const key = istDateKey(now, i);
    if (weekdayOf(key) === 6) return key;
  }
  return istDateKey(now, 1);
}

export async function unblockPath(user, { now = new Date() } = {}) {
  const sat = nextSaturday(now);
  const [bonafide, pass, pendingDocs, pendingPasses] = await Promise.all([
    preview(user, { type: "BONAFIDE_CERTIFICATE", purpose: "" }),
    preview(user, { type: "GATE_PASS", leaveAt: istInstant(sat, "10:00").toISOString(), expectedReturnAt: istInstant(sat, "18:00").toISOString() }),
    DocumentRequest.find({ student: user._id, status: { $in: ["SUBMITTED", "UNDER_REVIEW", "APPROVED"] } }).select("reference type status").lean(),
    GatePass.find({ student: user._id, status: { $in: ["PENDING_WARDEN_APPROVAL", "PARENT_VERIFIED"] } }).select("reference status").lean()
  ]);
  const requests = [
    { key: "BONAFIDE", label: "Bonafide certificate (instant under §4.2)", decision: bonafide.decision, failed: bonafide.failedConditions || [], citation: bonafide.citation?.section || null, kind: "future" },
    { key: "WEEKEND_PASS", label: `Weekend day outing (${sat}, 10:00–18:00)`, decision: pass.decision, failed: pass.failedConditions || [], citation: pass.citation?.section || null, kind: "future" },
    ...pendingDocs.map((d) => ({ key: d.reference, label: `${d.reference} ${String(d.type).replace(/_/g, " ").toLowerCase()} certificate (pending)`, decision: "PENDING", failed: d.type === "BONAFIDE" ? bonafide.failedConditions || [] : [], kind: "pending" })),
    ...pendingPasses.map((g) => ({ key: g.reference, label: `${g.reference} gate pass (with the warden)`, decision: "PENDING", failed: [], kind: "pending" }))
  ];
  const graph = unblockGraph(requests);
  return {
    requests: requests.map((r) => ({ ...r, failed: r.failed.map((c) => ({ field: c.field, label: c.label, explanation: c.explanation, actual: c.actual })) })),
    ...graph,
    text: graph.best ? `${graph.best.action} — unblocks ${graph.best.unblocks === 1 ? graph.best.requests[0].label : `${graph.best.unblocks} requests: ${graph.best.requests.map((r) => r.label).join("; ")}`}.` : "Nothing you can clear is blocking a request — every routine request would be decided instantly, or waits only on how it is filled in.",
    method: "POLICY_ENGINE_DRY_RUN (no writes)",
    kind: graph.best ? "RECOMMENDED ACTION" : "ACTUAL DATA"
  };
}
