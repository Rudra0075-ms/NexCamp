/**
 * The policy engine (Phase 2 — the Touchless Lane).
 *
 * Pure and deterministic: it takes a request's facts and a list of rules and
 * returns a verdict. No database, no clock, no model. Every figure in the
 * verdict is either a fact it was given or a value written in a rule, and the
 * rule's citation travels with the verdict so the decision can be read back
 * against the written policy.
 *
 * Order of evaluation, for the active rules of the request's type:
 *   1. ROUTE_TO_HUMAN rules are exceptions — if every condition of one holds,
 *      the request goes to a person, whatever else would have passed.
 *   2. AUTO_APPROVE rules — if every condition of one holds, the request is
 *      approved with no human touch. The newest version wins a tie.
 *   3. Otherwise the request goes to a person, with the failed conditions of
 *      the AUTO_APPROVE rule it came closest to passing.
 * A fact the engine was not given fails its condition ("Insufficient data"):
 * missing information never approves anything.
 */

export const DECISIONS = { AUTO: "AUTO_APPROVE", HUMAN: "ROUTE_TO_HUMAN" };
export const ENGINE_METHOD = "DETERMINISTIC_POLICY_RULES";

const OP_TEXT = { eq: "=", neq: "≠", lt: "<", lte: "≤", gt: ">", gte: "≥", in: "one of", nin: "not one of", isTrue: "is true", isFalse: "is false" };

/** Pure: does `actual` satisfy `op value`? Missing facts never satisfy anything. */
export function checkCondition(condition, facts = {}) {
  const { field, op, value } = condition;
  const has = Object.prototype.hasOwnProperty.call(facts, field) && facts[field] !== null && facts[field] !== undefined;
  const actual = has ? facts[field] : null;
  if (!has) return { ...condition, actual: null, passed: false, missing: true };
  let passed;
  switch (op) {
    case "eq":
      passed = actual === value;
      break;
    case "neq":
      passed = actual !== value;
      break;
    case "lt":
      passed = Number(actual) < Number(value);
      break;
    case "lte":
      passed = Number(actual) <= Number(value);
      break;
    case "gt":
      passed = Number(actual) > Number(value);
      break;
    case "gte":
      passed = Number(actual) >= Number(value);
      break;
    case "in":
      passed = Array.isArray(value) && value.includes(actual);
      break;
    case "nin":
      passed = Array.isArray(value) && !value.includes(actual);
      break;
    case "isTrue":
      passed = actual === true;
      break;
    case "isFalse":
      passed = actual === false;
      break;
    default:
      passed = false;
  }
  return { ...condition, actual, passed: Boolean(passed), missing: false };
}

/** Pure: the sentence shown when a condition fails. */
export function explain(result) {
  if (result.missing) return `Insufficient data — "${result.label || result.field}" could not be checked, so a person will decide.`;
  if (result.failText) return result.failText.replace("{actual}", formatValue(result.actual)).replace("{value}", formatValue(result.value));
  return `${result.label || result.field}: needed ${OP_TEXT[result.op] || result.op} ${formatValue(result.value)}, found ${formatValue(result.actual)}.`;
}

export function formatValue(v) {
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (v === null || v === undefined) return "—";
  return String(v);
}

const plain = (rule) => (typeof rule?.toObject === "function" ? rule.toObject() : rule);

/** Pure: every condition of one rule against the facts. */
export function evaluateRule(rule, facts) {
  const results = (rule.conditions || []).map((c) => checkCondition(plain(c), facts));
  return {
    rule,
    results,
    passed: results.filter((r) => r.passed),
    failed: results.filter((r) => !r.passed),
    allPass: results.length > 0 && results.every((r) => r.passed)
  };
}

const ruleRef = (rule) => (rule ? { key: rule.key, version: rule.version, title: rule.title, action: rule.action, id: rule._id ? String(rule._id) : undefined } : null);
const conditionOut = (r) => ({ field: r.field, op: r.op, opText: OP_TEXT[r.op] || r.op, value: r.value, actual: r.actual, label: r.label || r.field, passed: r.passed, missing: r.missing || undefined, explanation: r.passed ? undefined : explain(r) });

/**
 * Pure: the verdict for one request.
 *   request = { type: "BONAFIDE_CERTIFICATE", facts: { … } }
 *   rules   = PolicyRule documents or plain objects; only active ones of the
 *             request's type are considered.
 */
export function evaluate(request, rules = []) {
  const candidates = rules
    .map(plain)
    .filter((r) => r && r.requestType === request.type && (r.active === true || r.status === "ACTIVE"))
    .sort((a, b) => (b.version || 0) - (a.version || 0));
  const base = { requestType: request.type, facts: request.facts || {}, method: ENGINE_METHOD, source: "DETERMINISTIC", kind: "ACTUAL DATA" };

  if (!candidates.length) {
    return { ...base, decision: DECISIONS.HUMAN, matchedRule: null, passedConditions: [], failedConditions: [], citation: null, reason: "No active policy rule covers this request type, so a person decides." };
  }

  const exceptions = candidates.filter((r) => r.action === DECISIONS.HUMAN).map((r) => evaluateRule(r, request.facts));
  const hit = exceptions.find((e) => e.allPass);
  if (hit) {
    return {
      ...base,
      decision: DECISIONS.HUMAN,
      matchedRule: ruleRef(hit.rule),
      passedConditions: hit.passed.map(conditionOut),
      failedConditions: [],
      citation: hit.rule.citation || null,
      reason: `${hit.rule.title}: the policy sends this case to a person.`
    };
  }

  const approvals = candidates.filter((r) => r.action === DECISIONS.AUTO).map((r) => evaluateRule(r, request.facts));
  const approved = approvals.find((e) => e.allPass);
  if (approved) {
    return {
      ...base,
      decision: DECISIONS.AUTO,
      matchedRule: ruleRef(approved.rule),
      passedConditions: approved.passed.map(conditionOut),
      failedConditions: [],
      citation: approved.rule.citation || null,
      reason: `Every condition of ${approved.rule.citation?.section || approved.rule.key} holds, so the request is approved with no human touch.`
    };
  }

  // Closest miss: fewest failed conditions, then the newest version.
  const closest = [...approvals].sort((a, b) => a.failed.length - b.failed.length || (b.rule.version || 0) - (a.rule.version || 0))[0];
  return {
    ...base,
    decision: DECISIONS.HUMAN,
    matchedRule: ruleRef(closest?.rule),
    passedConditions: (closest?.passed || []).map(conditionOut),
    failedConditions: (closest?.failed || []).map(conditionOut),
    citation: closest?.rule.citation || null,
    reason: closest ? `${closest.failed.length} condition${closest.failed.length === 1 ? "" : "s"} of ${closest.rule.citation?.section || closest.rule.key} ${closest.failed.length === 1 ? "is" : "are"} not met, so a person decides.` : "No rule matched."
  };
}

/** Pure: a compact, storable copy of a verdict (no facts object duplication beyond what is shown). */
export function summariseVerdict(verdict, { at = new Date() } = {}) {
  return {
    decision: verdict.decision,
    matchedRule: verdict.matchedRule,
    citation: verdict.citation,
    passedConditions: verdict.passedConditions,
    failedConditions: verdict.failedConditions,
    reason: verdict.reason,
    facts: verdict.facts,
    method: verdict.method,
    evaluatedAt: at
  };
}

/** Pure: validates a rule definition before it is saved (drafts, the compiler, the simulator). */
export function validateRule(rule) {
  const errors = [];
  if (!rule || typeof rule !== "object") return ["The rule must be an object"];
  if (!["BONAFIDE_CERTIFICATE", "GATE_PASS", "FEE_RECEIPT_COPY"].includes(rule.requestType)) errors.push("requestType is not a known request type");
  if (!["AUTO_APPROVE", "ROUTE_TO_HUMAN"].includes(rule.action)) errors.push("action must be AUTO_APPROVE or ROUTE_TO_HUMAN");
  if (!Array.isArray(rule.conditions) || !rule.conditions.length) errors.push("a rule needs at least one condition");
  for (const [i, c] of (rule.conditions || []).entries()) {
    if (!c || typeof c.field !== "string" || !/^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(c.field)) errors.push(`condition ${i + 1}: field is not valid`);
    if (!Object.keys(OP_TEXT).includes(c?.op)) errors.push(`condition ${i + 1}: op must be one of ${Object.keys(OP_TEXT).join(", ")}`);
    if (["in", "nin"].includes(c?.op) && !Array.isArray(c.value)) errors.push(`condition ${i + 1}: ${c.op} needs a list value`);
    if (["lt", "lte", "gt", "gte"].includes(c?.op) && !Number.isFinite(Number(c.value))) errors.push(`condition ${i + 1}: ${c.op} needs a number`);
  }
  if (!rule.citation?.section || !rule.citation?.text) errors.push("a rule must cite a written policy section");
  return errors;
}
