import { NOTIFICATION_PRIORITIES } from "../config/constants.js";
import { safetyScan } from "./escalationService.js";

/**
 * Notification priority.
 *
 * The existing notification system treats every alert the same. This grades
 * them so the interface can sort and colour them, without changing how any of
 * them are created or delivered — notify() simply stamps the result of
 * classifyNotification() onto the row.
 *
 * Deterministic: the kind of event decides the band, and safety wording can
 * only raise it. A model is never required for an alert to be correct.
 */

// The band each existing notification kind sits in by default. Every kind in
// config/constants.js NOTIFICATION_KINDS is covered; anything new falls to
// INFORMATIONAL until it is graded here.
const KIND_PRIORITY = {
  GATE_PASS_OTP: { priority: "HIGH", reason: "A one-time code is only useful while it is valid." },
  GATE_PASS_SUBMITTED: { priority: "MEDIUM", reason: "A pass is waiting on a warden decision." },
  GATE_PASS_APPROVED: { priority: "MEDIUM", reason: "The student needs to know their pass is live." },
  GATE_PASS_REJECTED: { priority: "MEDIUM", reason: "The student needs to know the pass will not open." },
  GATE_PASS_ACTIVE: { priority: "LOW", reason: "Confirmation that the gate scan registered." },
  GATE_PASS_EXPIRY_WARNING: { priority: "HIGH", reason: "The return window is about to close." },
  GATE_PASS_OVERDUE: { priority: "CRITICAL", reason: "A student is outside the hostel past their approved return time." },
  GATE_PASS_RETURNED: { priority: "INFORMATIONAL", reason: "The pass closed normally." },
  COMPLAINT_ESCALATED: { priority: "CRITICAL", reason: "A complaint matched a safety rule and was escalated." },
  COMPLAINT_ASSIGNED: { priority: "MEDIUM", reason: "A department has work queued against it." },
  COMPLAINT_RESOLVED: { priority: "LOW", reason: "The student's complaint was closed; their rating is invited." },
  // SUPPORT HOOK (see CHANGES-SILENT-SUPPORT.md): Silent Support System notices.
  SUPPORT_REQUEST_RECEIVED: { priority: "MEDIUM", reason: "Confirms a private support request reached the support team." },
  SUPPORT_REQUEST_NEW: { priority: "HIGH", reason: "A student is waiting for a person from the support team." },
  SUPPORT_STATUS_UPDATE: { priority: "LOW", reason: "Progress on the student's own support request." },
  SUPPORT_FOLLOW_UP_DUE: { priority: "MEDIUM", reason: "A follow-up the student asked for is due." }
};

const RANK = Object.fromEntries(NOTIFICATION_PRIORITIES.map((level, index) => [level, index]));

/** The more urgent of two bands (CRITICAL is index 0, so lower wins). */
export function higherPriority(a, b) {
  const left = RANK[a];
  const right = RANK[b];
  if (left === undefined) return b;
  if (right === undefined) return a;
  return left <= right ? a : b;
}

/**
 * Grades one notification.
 *
 * @param {object} input
 * @param {string} input.kind   one of NOTIFICATION_KINDS
 * @param {string} [input.title]
 * @param {string} [input.body]
 * @param {string} [input.explicitPriority]  a caller that already knows better
 */
export function classifyNotification({ kind, title = "", body = "", explicitPriority } = {}) {
  const base = KIND_PRIORITY[kind] || {
    priority: "INFORMATIONAL",
    reason: "No grading rule for this notification kind yet."
  };

  let priority = NOTIFICATION_PRIORITIES.includes(explicitPriority) ? explicitPriority : base.priority;
  let source = "RULE_BASED";
  const reasons = [explicitPriority ? "Priority set by the caller." : base.reason];

  // Wording can raise a band but never lower one.
  const safety = safetyScan(`${title} ${body}`);
  if (safety.length) {
    priority = higherPriority(priority, "CRITICAL");
    source = "SAFETY_RULE";
    reasons.push(`Safety wording matched: ${safety.map((hit) => hit.label).join("; ")}.`);
  }

  return {
    priority,
    prioritySource: source,
    priorityReason: reasons.join(" "),
    method: "DETERMINISTIC_NOTIFICATION_RULES"
  };
}

export const NOTIFICATION_KIND_PRIORITIES = KIND_PRIORITY;
