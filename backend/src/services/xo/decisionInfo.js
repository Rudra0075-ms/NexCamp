/**
 * "Who decided, and why" for every request on page 17 (Phase 2).
 *
 * Pure projections from the stored records: a request decided by written
 * policy names the rule and section and the conditions it checked; one
 * decided by a person names that person and their note; one still open says
 * who it is waiting on and — when the policy sent it to a person — which
 * conditions it failed.
 */

const conditions = (policy) => (policy?.passedConditions || []).map((c) => ({ label: c.label, passed: true })).concat((policy?.failedConditions || []).map((c) => ({ label: c.label, passed: false, explanation: c.explanation })));

export function documentDecision(d) {
  if (d.decidedBy === "POLICY") return { by: "POLICY", name: `Written policy ${d.policyDecision?.citation?.section || ""}`.trim(), rule: d.policyDecision?.matchedRule || null, citation: d.policyDecision?.citation || null, why: d.policyDecision?.reason, conditions: conditions(d.policyDecision), undone: d.policyUndo || null };
  if (d.decidedBy === "HUMAN" || ["APPROVED", "ISSUED", "REJECTED"].includes(d.status)) return { by: "HUMAN", name: d.reviewerName || "Academic office", why: d.status === "REJECTED" ? d.rejectionReason : d.policyUndo?.from ? `Reopened after ${d.policyUndo.byName} undid the automatic issue: ${d.policyUndo.reason}` : "Reviewed by the academic office", citation: null, conditions: conditions(d.policyDecision) };
  return { by: null, waitingOn: "Academic office", why: d.policyUndo?.from ? `Reopened after ${d.policyUndo.byName} undid the automatic issue: ${d.policyUndo.reason}` : d.policyDecision?.failedConditions?.length ? d.policyDecision.reason : d.type !== "BONAFIDE" ? "No policy rule covers this certificate type, so the office reviews it." : "Waiting for review.", conditions: conditions(d.policyDecision) };
}

export function gatePassDecision(g) {
  if (g.decidedBy === "POLICY") return { by: "POLICY", name: `Written policy ${g.policyDecision?.citation?.section || ""}`.trim(), rule: g.policyDecision?.matchedRule || null, citation: g.policyDecision?.citation || null, why: g.policyDecision?.reason, conditions: conditions(g.policyDecision) };
  if (g.approval?.decision) return { by: "HUMAN", name: g.approval.decidedByName || "Warden", why: g.approval.note || (g.approval.decision === "APPROVED" ? "Approved by the warden" : "Rejected by the warden"), conditions: conditions(g.policyDecision) };
  if (g.status === "PENDING_PARENT_VERIFICATION") return { by: null, waitingOn: "Your guardian's SMS code", why: "The guardian code is never skipped.", conditions: [] };
  if (g.status === "PENDING_WARDEN_APPROVAL") return { by: null, waitingOn: "Hostel warden", why: g.policyUndo ? `${g.policyUndo.byName} undid the automatic approval: ${g.policyUndo.reason}` : g.policyDecision?.reason || "Waiting for the warden.", conditions: conditions(g.policyDecision) };
  return { by: null, waitingOn: null, why: null, conditions: [] };
}

export function serviceDecision(s) {
  if (s.decidedBy === "POLICY") return { by: "POLICY", name: `Written policy ${s.policyDecision?.citation?.section || ""}`.trim(), rule: s.policyDecision?.matchedRule || null, citation: s.policyDecision?.citation || null, why: s.policyDecision?.reason, conditions: conditions(s.policyDecision) };
  if (s.decidedBy === "HUMAN") return { by: "HUMAN", name: s.decidedByName || "Accounts office", why: s.rejectionReason || "Checked by the accounts office", conditions: conditions(s.policyDecision) };
  return { by: null, waitingOn: "Accounts office", why: s.policyUndo ? `${s.policyUndo.byName} undid the automatic issue: ${s.policyUndo.reason}` : s.policyDecision?.reason || "Waiting for the accounts office.", conditions: conditions(s.policyDecision) };
}

export function complaintDecision(c, resolverName) {
  if (c.status === "RESOLVED") return { by: "HUMAN", name: resolverName || c.department || "Staff", why: c.resolution?.resolutionDescription || "Resolved", conditions: [] };
  return { by: null, waitingOn: c.department || "Unrouted", why: "Repairs always need a person; it is with the department shown.", conditions: [] };
}

/** Timeline-shaped item for a service request (same shape as the other kinds). */
export function serviceTimeline(s) {
  const done = s.status === "FULFILLED" || s.status === "REJECTED";
  return {
    kind: "service",
    id: String(s._id),
    reference: s.reference,
    title: `Fee receipt copy — ${s.receipt}`,
    status: s.status,
    stages: [
      { id: "SUBMITTED", label: "Requested", state: "DONE", at: s.createdAt },
      { id: "CHECKED", label: s.decidedBy === "POLICY" ? `Checked by policy ${s.policyDecision?.citation?.section || ""}`.trim() : "Checked by the accounts office", state: done ? "DONE" : "CURRENT", at: done ? s.decidedAt : null },
      { id: s.status === "REJECTED" ? "REJECTED" : "FULFILLED", label: s.status === "REJECTED" ? "Rejected" : "Copy issued", state: done ? "DONE" : "PENDING", at: done ? s.decidedAt : null }
    ],
    events: (s.history || []).map((h) => ({ at: h.at, actor: h.actorName, message: `${h.action}${h.note ? ` · ${h.note}` : ""}`, kind: h.kind })),
    method: "DERIVED_FROM_STORED_RECORD",
    createdAt: s.createdAt,
    channel: s.channel
  };
}
