// Client-side projection of a document request onto the shared timeline shape
// (the same shape components/ai.jsx RequestTimeline renders for complaints and
// gate passes). The server's own projection lives in requestTrackerService.js.

// Mirrors DOCUMENT_TYPES / DOCUMENT_SLA_HOURS in backend/src/models/ext/DocumentRequest.js.
export const DOC_TYPES = [
  { type: "BONAFIDE", label: "Bonafide Certificate", slaHours: 24 },
  { type: "NO_DUES", label: "No Dues Certificate", slaHours: 72 },
  { type: "HOSTEL_RESIDENCE", label: "Hostel Residence Certificate", slaHours: 48 },
  { type: "CHARACTER", label: "Character Certificate", slaHours: 72 }
];

export function documentTimeline(d) {
  const order = [["SUBMITTED", "Submitted"], ["UNDER_REVIEW", "Under review"], ["APPROVED", "Approved"], ["ISSUED", "Issued"]];
  const at = (action) => (d.history || []).find((h) => h.action === action)?.at || null;
  const when = { SUBMITTED: d.createdAt, UNDER_REVIEW: at("DOCUMENT_START_REVIEW"), APPROVED: at("DOCUMENT_APPROVE"), ISSUED: d.certificate?.issuedAt };
  const rejected = d.status === "REJECTED";
  const current = rejected ? (when.UNDER_REVIEW ? 1 : 0) : order.findIndex(([id]) => id === d.status);
  const stages = order.map(([id, label], i) => {
    let state = "PENDING";
    if (rejected && i > current) state = "SKIPPED";
    else if (i < current || (i === current && (d.status === "ISSUED" || rejected))) state = "DONE";
    else if (i === current) state = "CURRENT";
    return { id, label, state, at: state === "DONE" || state === "CURRENT" ? when[id] : null };
  });
  if (rejected) stages.push({ id: "REJECTED", label: "Rejected", state: "DONE", at: d.reviewedAt });
  if (d.certificate?.revokedAt) stages.push({ id: "REVOKED", label: "Revoked", state: "DONE", at: d.certificate.revokedAt });
  return { kind: "document", reference: d.reference, stages };
}
