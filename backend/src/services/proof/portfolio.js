import { CampusMemory } from "../../models/CampusMemory.js";
import { Complaint } from "../../models/Complaint.js";
import { Incident } from "../../models/Incident.js";
import { Intervention } from "../../models/Intervention.js";
import { median, round } from "./stats.js";

/**
 * F7 — Repair portfolio optimiser (page 09).
 *
 * Which open problems should this week's technician hours go to? A 0/1
 * knapsack (dynamic programming over half-hour units) maximises
 * Σ risk × students affected, with safety-critical items forced in. Read-only
 * arithmetic, labelled SIMULATED; hour estimates carry their own label.
 */

export const UNIT_HOURS = 0.5;
export const MIN_MEMORY_SAMPLES = 3;
// ASSUMPTION: hands-on repair hours per category when campus memory has fewer than 3 repairs.
export const DEFAULT_HOURS = { WATER: 3, ELECTRICITY: 2, "WI-FI": 3, CLEANLINESS: 1.5, MESS: 2, SAFETY: 3, HEALTH: 2, ATTENDANCE: 1, OTHER: 2 };
// ASSUMPTION: a single complaint's risk from its priority, on the incident 0–100 scale.
export const PRIORITY_RISK = { LOW: 20, MEDIUM: 40, HIGH: 65, CRITICAL: 90 };

/**
 * Pure: 0/1 knapsack. items: { id, hours, value, mandatory }. Returns the
 * chosen ids. Mandatory items are taken first; the rest fill what is left.
 */
export function knapsack(items, capacityHours, unit = UNIT_HOURS) {
  const mandatory = items.filter((i) => i.mandatory);
  const mandatoryHours = mandatory.reduce((t, i) => t + i.hours, 0);
  const cap = Math.floor((capacityHours - mandatoryHours) / unit + 1e-9);
  const optional = items.filter((i) => !i.mandatory);
  if (cap < 0) return { chosen: mandatory.map((i) => i.id), feasible: false, mandatoryHours };
  const w = optional.map((i) => Math.max(1, Math.ceil(i.hours / unit - 1e-9)));
  const best = new Array(cap + 1).fill(0);
  const keep = optional.map(() => new Uint8Array(cap + 1));
  optional.forEach((item, k) => {
    for (let c = cap; c >= w[k]; c -= 1) {
      const v = best[c - w[k]] + item.value;
      if (v > best[c]) {
        best[c] = v;
        keep[k][c] = 1;
      }
    }
  });
  const chosen = [];
  let c = cap;
  for (let k = optional.length - 1; k >= 0; k -= 1) {
    if (keep[k][c]) {
      chosen.push(optional[k].id);
      c -= w[k];
    }
  }
  return { chosen: [...mandatory.map((i) => i.id), ...chosen], feasible: true, mandatoryHours };
}

/** Pure: the whole plan, including the value of 4 more hours. */
export function plan(items, capacityHours, { extraHours = 4 } = {}) {
  const total = items.reduce((t, i) => t + i.value, 0);
  const run = (cap) => {
    const r = knapsack(items, cap);
    const set = new Set(r.chosen);
    const picked = items.filter((i) => set.has(i.id));
    return { ...r, set, picked, value: picked.reduce((t, i) => t + i.value, 0), hours: round(picked.reduce((t, i) => t + i.hours, 0), 1) };
  };
  const now = run(capacityHours);
  const more = run(capacityHours + extraHours);
  const gained = more.picked.filter((i) => !now.set.has(i.id));
  const leftOut = items.filter((i) => !now.set.has(i.id)).map((i) => ({ ...i, why: i.hours > capacityHours - now.mandatoryHours ? `needs ${i.hours} h — more than the ${round(Math.max(0, capacityHours - now.mandatoryHours), 1)} h left after mandatory items` : `lower value per hour (${round(i.value / i.hours)} per h) than what was chosen` }));
  return {
    capacityHours,
    feasible: now.feasible,
    mandatoryHours: round(now.mandatoryHours, 1),
    selected: now.picked,
    usedHours: now.hours,
    coveredValue: now.value,
    totalValue: total,
    coveredPct: total ? round((now.value / total) * 100) : null,
    leftOut,
    marginal: {
      extraHours,
      addedValue: more.value - now.value,
      added: gained.map((i) => ({ id: i.id, title: i.title, students: i.students })),
      text: gained.length ? `${extraHours} more hours would cover ${gained.map((i) => i.title).join(", ")} (+${gained.reduce((t, i) => t + i.students, 0)} students).` : `${extraHours} more hours would not change the plan.`
    }
  };
}

async function hoursByCategory() {
  const rows = await CampusMemory.find({ resolutionTimeHours: { $gt: 0 } }).select("category resolutionTimeHours").lean();
  const out = {};
  for (const r of rows) (out[r.category] ||= []).push(r.resolutionTimeHours);
  return out;
}

export async function portfolio({ hours = 24, trade, now = new Date() } = {}) {
  const [incidents, complaints, memory, interventions] = await Promise.all([
    Incident.find({ status: { $ne: "RESOLVED" } }).populate("building", "name code").select("reference title category risk affectedStudents building status").lean(),
    Complaint.find({ status: { $ne: "RESOLVED" }, relatedIncident: null }).populate("building", "name code").select("reference title category priority department building aiClassification createdAt").lean(),
    hoursByCategory(),
    Intervention.find({ status: { $in: ["RECOMMENDED", "ACCEPTED", "MODIFIED", "IN_PROGRESS"] } }).select("incident estimatedResolutionHours").lean()
  ]);
  const estimateFor = (category, intervention) => {
    if (intervention?.estimatedResolutionHours) return { hours: intervention.estimatedResolutionHours, basis: "intervention estimate", kind: "AI PREDICTION" };
    const past = memory[category] || [];
    if (past.length >= MIN_MEMORY_SAMPLES) return { hours: round(median(past), 1), basis: `median of ${past.length} past repairs (campus memory)`, kind: "ACTUAL DATA" };
    return { hours: DEFAULT_HOURS[category] ?? 2, basis: `default for ${category} — fewer than ${MIN_MEMORY_SAMPLES} past repairs recorded`, kind: "ASSUMPTION" };
  };
  const items = [
    ...incidents.map((i) => {
      const est = estimateFor(i.category, interventions.find((x) => String(x.incident) === String(i._id)));
      return { id: `INC:${i._id}`, reference: i.reference, title: `${i.building?.name || "Campus"} ${i.category}`, category: i.category, risk: i.risk || 0, students: i.affectedStudents || 0, hours: Math.max(UNIT_HOURS, est.hours), hoursBasis: est.basis, hoursKind: est.kind, mandatory: (i.risk || 0) >= 90, why: (i.risk || 0) >= 90 ? "risk ≥ 90 — safety-critical, always scheduled" : null };
    }),
    ...complaints.map((c) => {
      const est = estimateFor(c.category);
      const safety = Boolean(c.aiClassification?.safetyRule);
      return { id: `CMP:${c._id}`, reference: c.reference, title: `${c.reference} ${c.title}`, category: c.category, department: c.department, risk: PRIORITY_RISK[c.priority] ?? 40, riskKind: "ASSUMPTION", students: 1, hours: Math.max(UNIT_HOURS, est.hours), hoursBasis: est.basis, hoursKind: est.kind, mandatory: c.priority === "CRITICAL" || safety, why: safety ? `safety rule (${c.aiClassification.safetyRule}) — always scheduled` : c.priority === "CRITICAL" ? "priority CRITICAL (classification) — always scheduled" : null };
    })
  ]
    .filter((i) => !trade || i.category === trade || String(i.department || "").includes(trade))
    .map((i) => ({ ...i, value: Math.round(i.risk * i.students) }));
  if (!items.length) return { items: 0, text: "Nothing open to schedule.", kind: "ACTUAL DATA" };
  const p = plan(items, hours);
  return {
    ...p,
    items: items.length,
    objective: "maximise Σ risk × students affected, subject to Σ hours ≤ capacity; safety-critical items are mandatory",
    method: "0/1_KNAPSACK_DYNAMIC_PROGRAMMING (0.5 h units)",
    text: p.feasible ? `${p.usedHours} of ${hours} h cover ${p.coveredPct}% of the open impact (${p.selected.length} of ${items.length} items).` : `Mandatory safety-critical items alone need ${p.mandatoryHours} h — more than the ${hours} h available.`,
    kind: "SIMULATED",
    generatedAt: now
  };
}
