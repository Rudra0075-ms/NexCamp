import { COMPLAINT_STATUS, GATE_PASS_STATUS } from "../config/constants.js";
import { Complaint } from "../models/Complaint.js";
import { GatePass } from "../models/GatePass.js";
import { ApiError } from "../utils/ApiError.js";

/**
 * One timeline shape for every kind of request.
 *
 * Complaints and gate passes already keep their own event arrays — `audit` and
 * `events` — written by the controllers that move them. Nothing new is stored
 * here and no second workflow is created: this reads those existing records and
 * projects both onto the same structure, so one component can render either.
 *
 * Each stage is one of:
 *   DONE     reached, with the timestamp it was reached at
 *   CURRENT  where the record is now
 *   PENDING  not reached yet
 *   SKIPPED  bypassed (a rejected pass never becomes active)
 */

// The canonical order of each lifecycle, drawn from the status enums the models
// already validate against.
const COMPLAINT_STAGES = [
  { id: "SUBMITTED", label: "Submitted", status: "PENDING" },
  { id: "CLASSIFIED", label: "AI classified", status: "CLASSIFIED" },
  { id: "ASSIGNED", label: "Department assigned", status: "ASSIGNED" },
  { id: "INVESTIGATING", label: "In progress", status: "INVESTIGATING" },
  { id: "RESOLVED", label: "Resolved", status: "RESOLVED" },
  { id: "FEEDBACK", label: "Feedback", status: null }
];

const GATE_PASS_STAGES = [
  { id: "SUBMITTED", label: "Submitted", status: "PENDING_PARENT_VERIFICATION" },
  { id: "PARENT_VERIFIED", label: "Guardian verified", status: "PARENT_VERIFIED" },
  { id: "WARDEN_REVIEW", label: "Warden review", status: "PENDING_WARDEN_APPROVAL" },
  { id: "APPROVED", label: "Approved", status: "APPROVED" },
  { id: "QR_ISSUED", label: "QR issued", status: null },
  { id: "ACTIVE", label: "Scanned out — active", status: "ACTIVE" },
  { id: "RETURNED", label: "Returned", status: "RETURNED" }
];

/** Earliest stored event whose recorded status matches, if the record kept one. */
function reachedAt(events, status) {
  if (!status) return null;
  const hit = events.find((event) => event.status === status);
  return hit?.at || null;
}

/**
 * @param {boolean} complete       the current stage itself is finished
 * @param {boolean} skipRemaining  the record can never reach the later stages
 *                                 (a rejected pass), as opposed to simply not
 *                                 having reached them yet (feedback on a
 *                                 resolved complaint, which may still arrive)
 */
function buildStages(stages, { currentIndex, resolveAt, complete = false, skipRemaining = false }) {
  return stages.map((stage, index) => {
    let state = "PENDING";
    if (skipRemaining && index > currentIndex) state = "SKIPPED";
    else if (index < currentIndex) state = "DONE";
    else if (index === currentIndex) state = complete ? "DONE" : "CURRENT";

    return {
      id: stage.id,
      label: stage.label,
      state,
      at: state === "DONE" || state === "CURRENT" ? resolveAt(stage, index) : null
    };
  });
}

export function complaintTimeline(complaint) {
  const events = complaint.audit || [];
  const statusIndex = COMPLAINT_STAGES.findIndex((stage) => stage.status === complaint.status);
  const hasFeedback = Boolean(complaint.feedback?.rating) || Number.isFinite(complaint.resolution?.studentSatisfaction);

  // A resolved complaint with feedback recorded has completed the last stage.
  const currentIndex = hasFeedback
    ? COMPLAINT_STAGES.length - 1
    : statusIndex >= 0
      ? statusIndex
      : 0;

  const stages = buildStages(COMPLAINT_STAGES, {
    currentIndex,
    complete: complaint.status === "RESOLVED",
    // A resolved complaint has not skipped its feedback stage — feedback can
    // still be recorded against it, so that stage stays PENDING.
    skipRemaining: false,
    resolveAt: (stage, index) => {
      if (index === 0) return complaint.createdAt;
      if (stage.id === "CLASSIFIED") return complaint.aiClassification?.classifiedAt || reachedAt(events, stage.status);
      if (stage.id === "RESOLVED") return complaint.resolution?.resolvedAt || null;
      if (stage.id === "FEEDBACK") return hasFeedback ? complaint.feedback?.submittedAt || complaint.resolution?.resolvedAt : null;
      return reachedAt(events, stage.status);
    }
  });

  return {
    kind: "complaint",
    id: String(complaint._id),
    reference: complaint.reference,
    title: complaint.title,
    status: complaint.status,
    statusVocabulary: COMPLAINT_STATUS,
    stages,
    events: events.map((event) => ({
      at: event.at,
      actor: event.actor,
      message: event.message,
      kind: event.kind
    })),
    method: "DERIVED_FROM_STORED_RECORD"
  };
}

export function gatePassTimeline(gatePass) {
  const events = gatePass.events || [];
  const status = gatePass.status;

  const terminalStatuses = ["REJECTED", "CANCELLED"];
  const terminal = terminalStatuses.includes(status);

  let currentIndex;
  if (status === "RETURNED" || status === "RETURNED_LATE") currentIndex = GATE_PASS_STAGES.length - 1;
  else if (status === "OVERDUE" || status === "ACTIVE") currentIndex = GATE_PASS_STAGES.findIndex((stage) => stage.id === "ACTIVE");
  else if (status === "APPROVED") {
    // An approved pass with a token minted has already reached QR_ISSUED.
    const target = gatePass.pass?.issuedAt ? "QR_ISSUED" : "APPROVED";
    currentIndex = GATE_PASS_STAGES.findIndex((stage) => stage.id === target);
  } else {
    const byStatus = GATE_PASS_STAGES.findIndex((stage) => stage.status === status);
    currentIndex = byStatus >= 0 ? byStatus : 0;
  }

  const stages = buildStages(GATE_PASS_STAGES, {
    currentIndex,
    complete: terminal || status === "RETURNED" || status === "RETURNED_LATE",
    // A rejected or cancelled pass genuinely never reaches the gate.
    skipRemaining: terminal,
    resolveAt: (stage, index) => {
      if (index === 0) return gatePass.createdAt;
      if (stage.id === "PARENT_VERIFIED") return gatePass.parent?.verifiedAt || null;
      if (stage.id === "APPROVED") return gatePass.approval?.decidedAt || null;
      if (stage.id === "QR_ISSUED") return gatePass.pass?.issuedAt || null;
      if (stage.id === "ACTIVE") return gatePass.exitAt || gatePass.pass?.exitScanAt || null;
      if (stage.id === "RETURNED") return gatePass.returnAt || gatePass.pass?.returnScanAt || null;
      return reachedAt(events, stage.status);
    }
  });

  // A rejected or cancelled pass gets its real ending appended rather than
  // pretending the remaining stages are merely pending.
  if (terminal) {
    stages.push({
      id: status,
      label: status === "REJECTED" ? "Rejected" : "Cancelled",
      state: "DONE",
      at: gatePass.approval?.decidedAt || gatePass.updatedAt
    });
  }
  if (status === "OVERDUE") {
    stages.push({ id: "OVERDUE", label: "Overdue", state: "CURRENT", at: gatePass.overdueMarkedAt || null });
  }
  if (status === "RETURNED_LATE") {
    stages.push({ id: "RETURNED_LATE", label: "Returned late", state: "DONE", at: gatePass.returnAt || null });
  }

  return {
    kind: "gatepass",
    id: String(gatePass._id),
    reference: gatePass.reference,
    title: gatePass.reason,
    status,
    statusVocabulary: GATE_PASS_STATUS,
    stages,
    events: events.map((event) => ({
      at: event.at,
      actor: event.actor,
      message: event.message,
      kind: event.kind
    })),
    method: "DERIVED_FROM_STORED_RECORD"
  };
}

/** Loads one record and projects it. Ownership is enforced by the caller. */
export async function timelineFor(kind, id) {
  if (kind === "complaint") {
    const complaint = await Complaint.findById(id).lean();
    if (!complaint) throw ApiError.notFound("No complaint with that id");
    return { record: complaint, timeline: complaintTimeline(complaint) };
  }
  if (kind === "gatepass") {
    const gatePass = await GatePass.findById(id).lean();
    if (!gatePass) throw ApiError.notFound("No gate pass with that id");
    return { record: gatePass, timeline: gatePassTimeline(gatePass) };
  }
  throw ApiError.badRequest("kind must be 'complaint' or 'gatepass'");
}

export const TIMELINE_STAGES = { complaint: COMPLAINT_STAGES, gatepass: GATE_PASS_STAGES };
