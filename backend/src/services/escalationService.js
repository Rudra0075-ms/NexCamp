import { PRIORITIES, SAFETY_CRITICAL_PATTERNS } from "../config/constants.js";

/**
 * Priority and escalation.
 *
 * Deliberately not an AI decision. A complaint that says "sparks are coming
 * out of the distribution board" has to reach an administrator whether or not
 * a provider is configured, whether or not it is reachable, and whether or not
 * the model agrees — so the safety rules below run first and cannot be
 * overridden downwards by a model.
 *
 * Pure functions over text and counts: no database, no network.
 */

const PRIORITY_RANK = Object.fromEntries(PRIORITIES.map((level, index) => [level, index]));

/** The highest of two priority labels. Unknown labels lose. */
export function maxPriority(a, b) {
  const left = PRIORITY_RANK[a] ?? -1;
  const right = PRIORITY_RANK[b] ?? -1;
  return left >= right ? (PRIORITIES[left] || b) : (PRIORITIES[right] || a);
}

/**
 * Deterministic safety scan. Returns every pattern the wording matched, so the
 * explanation quotes the actual trigger rather than asserting "unsafe".
 */
export function safetyScan(text) {
  const haystack = ` ${String(text || "").toLowerCase()} `;
  const matches = [];
  for (const pattern of SAFETY_CRITICAL_PATTERNS) {
    const term = pattern.terms.find((word) => haystack.includes(word));
    if (term) matches.push({ id: pattern.id, term, label: pattern.label });
  }
  return matches;
}

/**
 * Decides the priority a complaint is actually filed at, and whether it has to
 * escalate to staff immediately.
 *
 * @param {object} input
 * @param {string} input.text            title + description as submitted
 * @param {string} input.basePriority    whatever the classifier produced
 * @param {string} [input.severity]
 * @param {number} [input.duplicateProbability]
 * @param {number} [input.relatedCount]  how many recent complaints look like this one
 */
export function decideEscalation({
  text,
  basePriority = "MEDIUM",
  severity,
  duplicateProbability = 0,
  relatedCount = 0
} = {}) {
  const safety = safetyScan(text);
  const reasons = [];

  let priority = PRIORITIES.includes(basePriority) ? basePriority : "MEDIUM";
  let rule = "CLASSIFIER_PRIORITY";

  if (safety.length) {
    priority = "CRITICAL";
    rule = "SAFETY_RULE";
    reasons.push(
      `Safety rule ${safety.map((hit) => hit.id).join(", ")} matched — ${safety
        .map((hit) => `${hit.label} ("${hit.term}")`)
        .join("; ")}.`
    );
  } else {
    reasons.push(`Classifier priority ${priority}${severity ? ` at ${severity} severity` : ""}.`);
  }

  // A problem many students are reporting at once is bigger than any one of
  // those reports. This can raise a priority; it can never lower one.
  if (!safety.length && relatedCount >= 5) {
    priority = maxPriority(priority, "HIGH");
    rule = rule === "CLASSIFIER_PRIORITY" ? "CLUSTER_VOLUME" : rule;
    reasons.push(`${relatedCount} similar complaints are already open on the same area.`);
  } else if (!safety.length && duplicateProbability >= 70) {
    priority = maxPriority(priority, "HIGH");
    reasons.push(`Overlaps an existing complaint at ${duplicateProbability}%, so more than one student is affected.`);
  }

  const escalate = priority === "CRITICAL" || priority === "HIGH";

  return {
    priority,
    escalate,
    // What actually decided it. "SAFETY_RULE" means no model was consulted.
    rule,
    safetyMatches: safety,
    reasons,
    action: safety.length
      ? "Immediate administrator notification — do not wait for triage"
      : priority === "HIGH"
        ? "Notify the assigned department today"
        : priority === "MEDIUM"
          ? "Queue for the normal SLA window"
          : "No escalation — routine queue",
    method: "DETERMINISTIC_SAFETY_RULES"
  };
}

/**
 * A model may raise a priority it thinks is understated, but never lower one a
 * safety rule set. This is the only path by which an AI priority reaches a
 * stored complaint.
 */
export function reconcilePriority(deterministic, modelPriority) {
  if (deterministic.rule === "SAFETY_RULE") {
    return { priority: deterministic.priority, honoured: false, note: "A safety rule fixed this at CRITICAL; the model cannot lower it." };
  }
  const suggested = PRIORITIES.includes(modelPriority) ? modelPriority : null;
  if (!suggested) return { priority: deterministic.priority, honoured: false, note: "No usable model priority." };

  const merged = maxPriority(deterministic.priority, suggested);
  return {
    priority: merged,
    honoured: merged === suggested && suggested !== deterministic.priority,
    note:
      merged === suggested && suggested !== deterministic.priority
        ? `Model raised the priority from ${deterministic.priority} to ${suggested}.`
        : merged === deterministic.priority && suggested !== deterministic.priority
          ? `Model suggested ${suggested}; kept the higher rule-based ${deterministic.priority}.`
          : "Model agreed with the rule-based priority."
  };
}

export const SAFETY_RULE_IDS = SAFETY_CRITICAL_PATTERNS.map((pattern) => pattern.id);
