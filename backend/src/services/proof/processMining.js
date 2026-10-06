import { CampusEvent } from "../../models/xo/CampusEvent.js";
import { DAY, HOUR, gini, median, quantile, round } from "./stats.js";

/**
 * F1 — Process mining over the Campus Event log (page 10).
 *
 * The designed lifecycle of each workflow is the reference model. From the
 * events actually recorded we build the directly-follows graph (which step
 * really followed which, how often, and how long the wait was), check every
 * case against the reference (skipped steps, loops, going backwards), and name
 * the slowest hand-off. Deterministic: no model computes any of it.
 */

export const MIN_COMPLETED_CASES = 10;
// ASSUMPTION: the wait above which a hand-off counts as slow in the headline.
export const SLOW_WAIT_HOURS = 18;

export const WORKFLOWS = {
  complaint: {
    subjectType: "Complaint",
    start: "COMPLAINT_CREATED",
    reference: ["SUBMITTED", "CLASSIFIED", "ASSIGNED", "INVESTIGATING", "RESOLVED", "FEEDBACK"],
    // Steps the designed lifecycle allows to be skipped without it being a deviation.
    optional: ["INVESTIGATING", "FEEDBACK"],
    end: "RESOLVED",
    rework: "REOPENED"
  },
  gatepass: {
    subjectType: "GatePass",
    start: "GATEPASS_APPLIED",
    reference: ["APPLIED", "GUARDIAN_VERIFIED", "APPROVED", "EXITED", "RETURNED"],
    optional: [],
    end: "RETURNED",
    alternativeEnds: ["REJECTED"],
    rework: "OVERDUE"
  },
  certificate: {
    subjectType: "DocumentRequest",
    start: "CERTIFICATE_REQUESTED",
    reference: ["REQUESTED", "REVIEWED", "ISSUED"],
    optional: ["REVIEWED"],
    end: "ISSUED",
    alternativeEnds: ["REJECTED"],
    rework: null
  }
};

/** Pure: the activity an event stands for in its workflow, or null to ignore it. */
export function activityOf(event) {
  switch (event.type) {
    case "COMPLAINT_CREATED": return "SUBMITTED";
    case "COMPLAINT_CLASSIFIED": return "CLASSIFIED";
    case "COMPLAINT_ASSIGNED": return "ASSIGNED";
    case "COMPLAINT_STATUS_CHANGED": {
      const to = String(event.payload?.to || "").toUpperCase();
      return to === "INVESTIGATING" ? "INVESTIGATING" : to === "ASSIGNED" ? "ASSIGNED" : null;
    }
    case "COMPLAINT_RESOLVED": return "RESOLVED";
    case "COMPLAINT_REOPENED": return "REOPENED";
    case "COMPLAINT_CONFIRMED_FIXED": return "FEEDBACK";
    case "GATEPASS_APPLIED": return "APPLIED";
    case "GATEPASS_OTP_VERIFIED": return "GUARDIAN_VERIFIED";
    case "GATEPASS_APPROVED": return "APPROVED";
    case "GATEPASS_REJECTED": return "REJECTED";
    case "GATEPASS_EXITED": return "EXITED";
    case "GATEPASS_RETURNED": return "RETURNED";
    case "GATEPASS_OVERDUE": return "OVERDUE";
    case "CERTIFICATE_REQUESTED": return "REQUESTED";
    case "CERTIFICATE_REVIEWED": return "REVIEWED";
    case "CERTIFICATE_ISSUED": return "ISSUED";
    case "CERTIFICATE_REJECTED": return "REJECTED";
    default: return null;
  }
}

/** Pure: events → one trace per case, oldest first, with consecutive duplicates of CLASSIFIED/REVIEWED collapsed. */
export function traces(events) {
  const byCase = new Map();
  for (const e of events) {
    const activity = activityOf(e);
    if (!activity) continue;
    const id = String(e.subjectId);
    if (!byCase.has(id)) byCase.set(id, { id, ref: e.subjectRef || id, department: null, steps: [] });
    const c = byCase.get(id);
    if (e.department && !c.department) c.department = e.department;
    c.steps.push({ activity, at: new Date(e.at), actor: e.actorName || null, humanTouch: Boolean(e.humanTouch), department: e.department || null });
  }
  for (const c of byCase.values()) {
    c.steps.sort((a, b) => a.at - b.at);
    // Two identical activities within a minute are one step recorded twice (live + derived).
    c.steps = c.steps.filter((s, i, all) => !(i && all[i - 1].activity === s.activity && s.at - all[i - 1].at < 60000 && s.activity !== "ASSIGNED"));
  }
  return [...byCase.values()];
}

/** Pure: one case checked against the reference model. */
export function conformance(trace, model) {
  const index = (a) => model.reference.indexOf(a);
  const issues = [];
  const assigned = trace.steps.filter((s) => s.activity === "ASSIGNED").length;
  if (assigned > 1) issues.push({ kind: "REASSIGNED", detail: `assigned ${assigned} times` });
  if (model.rework && trace.steps.some((s) => s.activity === model.rework)) issues.push({ kind: "REWORK", detail: `${model.rework.toLowerCase()} after it was closed` });
  let last = -1;
  for (const s of trace.steps) {
    const i = index(s.activity);
    if (i < 0) continue;
    if (i < last && s.activity !== "ASSIGNED") issues.push({ kind: "BACKWARDS", detail: `${s.activity} after ${model.reference[last]}` });
    if (i > last + 1) {
      const skipped = model.reference.slice(last + 1, i).filter((a) => !model.optional.includes(a));
      if (skipped.length) issues.push({ kind: "SKIPPED", detail: `skipped ${skipped.join(", ")}` });
    }
    last = Math.max(last, i);
  }
  const ended = trace.steps.some((s) => s.activity === model.end || (model.alternativeEnds || []).includes(s.activity));
  return { conforms: issues.length === 0, issues, completed: ended };
}

/** Pure: the directly-follows graph with counts and waits. */
export function directlyFollows(caseTraces) {
  const edges = new Map();
  const nodes = new Map();
  for (const t of caseTraces) {
    t.steps.forEach((s, i) => {
      nodes.set(s.activity, (nodes.get(s.activity) || 0) + 1);
      if (!i) return;
      const prev = t.steps[i - 1];
      const key = `${prev.activity}→${s.activity}`;
      if (!edges.has(key)) edges.set(key, { from: prev.activity, to: s.activity, waits: [], cases: [] });
      const e = edges.get(key);
      const hours = (s.at - prev.at) / HOUR;
      e.waits.push(hours);
      e.cases.push({ id: t.id, ref: t.ref, from: prev.at, to: s.at, hours: round(hours, 1), department: s.department || t.department });
    });
  }
  return {
    nodes: [...nodes.entries()].map(([id, count]) => ({ id, count })),
    edges: [...edges.values()].map((e) => ({
      from: e.from,
      to: e.to,
      count: e.waits.length,
      medianHours: round(median(e.waits), 1),
      p90Hours: round(quantile(e.waits, 0.9), 1),
      slowShare: round((e.waits.filter((w) => w > SLOW_WAIT_HOURS).length / e.waits.length) * 100),
      cost: round(median(e.waits) * e.waits.length, 1),
      cases: e.cases.sort((a, b) => b.hours - a.hours)
    }))
  };
}

/** Pure: everything the page shows, from a list of events. */
export function mine(events, { workflow = "complaint", days = 30 } = {}) {
  const model = WORKFLOWS[workflow];
  if (!model) throw new Error(`Unknown workflow ${workflow}`);
  const all = traces(events);
  const checked = all.map((t) => ({ ...t, ...conformance(t, model) }));
  const completed = checked.filter((t) => t.completed);
  const base = { workflow, windowDays: days, reference: model.reference, cases: all.length, completedCases: completed.length, minCompleted: MIN_COMPLETED_CASES };
  if (completed.length < MIN_COMPLETED_CASES) {
    return { ...base, insufficient: true, text: `Insufficient data to mine this workflow — ${completed.length} completed case${completed.length === 1 ? "" : "s"} in ${days} days; at least ${MIN_COMPLETED_CASES} are needed.`, kind: "INSUFFICIENT DATA" };
  }
  const graph = directlyFollows(checked);
  // The bottleneck is a forward hand-off in the designed lifecycle that actually accumulates waiting.
  const forward = (e) => model.reference.indexOf(e.to) > model.reference.indexOf(e.from) && model.reference.indexOf(e.from) >= 0;
  const ranked = graph.edges.filter((e) => e.count >= 3 && forward(e) && e.cost > 0).sort((a, b) => b.cost - a.cost);
  const top = ranked[0] || null;
  // Which department's cases wait longest on that hand-off (3+ cases each).
  const byDept = new Map();
  for (const c of top?.cases || []) {
    const d = c.department || "UNRECORDED";
    if (!byDept.has(d)) byDept.set(d, []);
    byDept.get(d).push(c.hours);
  }
  const topDepts = [...byDept.entries()].filter(([, h]) => h.length >= 3).map(([department, h]) => ({ department, cases: h.length, medianHours: round(median(h), 1), slowShare: round((h.filter((x) => x > SLOW_WAIT_HOURS).length / h.length) * 100) })).sort((a, b) => b.slowShare - a.slowShare || b.medianHours - a.medianHours);
  const worst = topDepts[0] && topDepts[0].slowShare > (top?.slowShare ?? 0) ? topDepts[0] : null;
  const nonConforming = checked.filter((t) => !t.conforms);
  const reworked = checked.filter((t) => t.issues.some((i) => i.kind === "REWORK"));
  const reassigned = checked.filter((t) => t.issues.some((i) => i.kind === "REASSIGNED" && Number(i.detail.match(/\d+/)?.[0]) >= 3));
  const ended = checked.filter((t) => t.steps.some((s) => s.activity === model.end));

  // Hand-off delay per department: the wait into each step, owned by the department recorded on it.
  const perDept = new Map();
  for (const e of graph.edges) for (const c of e.cases) {
    const d = c.department || "UNRECORDED";
    if (!perDept.has(d)) perDept.set(d, []);
    perDept.get(d).push(c.hours);
  }
  // Load: human-touch steps per named staff member (who actually moved cases).
  const load = new Map();
  for (const t of checked) for (const s of t.steps) if (s.humanTouch && s.actor) load.set(s.actor, (load.get(s.actor) || 0) + 1);
  const loads = [...load.entries()].map(([name, n]) => ({ name, steps: n })).sort((a, b) => b.steps - a.steps);
  const g = loads.length >= 2 ? gini(loads.map((l) => l.steps)) : null;

  const reworkRate = ended.length ? round((reworked.length / ended.length) * 100) : null;
  return {
    ...base,
    insufficient: false,
    graph: { nodes: graph.nodes, edges: graph.edges.map((e) => ({ ...e, cases: e.cases.slice(0, 40) })) },
    bottleneck: top
      ? {
          from: top.from,
          to: top.to,
          count: top.count,
          medianHours: top.medianHours,
          p90Hours: top.p90Hours,
          slowShare: top.slowShare,
          cost: top.cost,
          byDepartment: topDepts,
          text: worst
            ? `${worst.slowShare}% of ${worst.department} ${workflow}s wait more than ${SLOW_WAIT_HOURS} h between ${top.from} and ${top.to} (median ${worst.medianHours} h, ${worst.cases} cases; all departments: ${top.slowShare}%, median ${top.medianHours} h).`
            : `${top.slowShare}% of ${workflow} cases wait more than ${SLOW_WAIT_HOURS} h between ${top.from} and ${top.to} (median ${top.medianHours} h, P90 ${top.p90Hours} h, ${top.count} cases).`,
          formula: `bottleneck = argmax over edges of (median wait × cases) = ${top.medianHours} h × ${top.count} = ${top.cost} case-hours`,
          kind: "ACTUAL DATA"
        }
      : null,
    recommendation: top
      ? { text: `Add a first-response target at the ${top.from} → ${top.to} hand-off${worst ? ` for ${worst.department}` : ""} (currently median ${worst ? worst.medianHours : top.medianHours} h).`, kind: "RECOMMENDED ACTION" }
      : { text: "No hand-off in the designed lifecycle accumulates waiting time.", kind: "ACTUAL DATA" },
    rework: { reopened: reworked.length, resolved: ended.length, ratePct: reworkRate, formula: `rework rate = reopened ÷ resolved = ${reworked.length} ÷ ${ended.length}`, kind: "ACTUAL DATA" },
    conformance: {
      nonConforming: nonConforming.length,
      ofCases: checked.length,
      pct: round((nonConforming.length / checked.length) * 100),
      byKind: ["SKIPPED", "REASSIGNED", "BACKWARDS", "REWORK"].map((k) => ({ kind: k, cases: checked.filter((t) => t.issues.some((i) => i.kind === k)).length })),
      reassignedTwicePlus: reassigned.map((t) => t.ref),
      examples: nonConforming.filter((t, i, all) => all.findIndex((x) => x.ref === t.ref) === i).slice(0, 12).map((t) => ({ ref: t.ref, issues: t.issues.map((i) => i.detail) })),
      kind: "ACTUAL DATA"
    },
    departments: [...perDept.entries()].map(([department, hours]) => ({ department, handoffs: hours.length, medianHours: round(median(hours), 1), p90Hours: round(quantile(hours, 0.9), 1) })).sort((a, b) => (b.medianHours ?? 0) - (a.medianHours ?? 0)),
    load: {
      staff: loads,
      gini: round(g, 2),
      formula: "G = Σᵢ Σⱼ |xᵢ − xⱼ| ÷ (2 n² μ), over human-touch steps per staff member",
      text: g === null ? "Insufficient data — fewer than two staff members touched these cases." : g >= 0.4 ? `Load is concentrated (Gini ${round(g, 2)}): ${loads[0].name} made ${loads[0].steps} of ${loads.reduce((t, l) => t + l.steps, 0)} human steps.` : `Load is spread fairly evenly (Gini ${round(g, 2)}).`,
      kind: g === null ? "INSUFFICIENT DATA" : "ACTUAL DATA"
    },
    thresholds: { slowWaitHours: SLOW_WAIT_HOURS, slowWaitKind: "ASSUMPTION" },
    method: "DIRECTLY_FOLLOWS_GRAPH + CONFORMANCE_CHECK",
    kind: "ACTUAL DATA"
  };
}

// A small cache: the log only grows, and the page is read far more often than it changes.
const cache = new Map();
const TTL = 60000;

export async function processMining({ workflow = "complaint", days = 30, now = new Date(), fresh = false } = {}) {
  const key = `${workflow}|${days}`;
  const hit = cache.get(key);
  if (!fresh && hit && now - hit.at < TTL) return { ...hit.value, cached: true };
  const model = WORKFLOWS[workflow];
  const since = new Date(now - days * DAY);
  // Cases that started in the window (their first step is inside it), with every later event for them.
  const starts = await CampusEvent.find({ subjectType: model.subjectType, type: model.start, at: { $gte: since } }).distinct("subjectId");
  const events = await CampusEvent.find({ subjectType: model.subjectType, subjectId: { $in: starts } }).select("type subjectId subjectRef at actorName humanTouch department payload").lean();
  const value = { ...mine(events, { workflow, days }), generatedAt: now };
  cache.set(key, { at: now, value });
  return value;
}

export function clearProcessMiningCache() {
  cache.clear();
}
