import { Building } from "../../models/Building.js";
import { CampusMemory } from "../../models/CampusMemory.js";
import { Complaint } from "../../models/Complaint.js";
import { Incident } from "../../models/Incident.js";
import { Intervention } from "../../models/Intervention.js";
import { ApiError } from "../../utils/ApiError.js";
import { DAY, bootstrap, mean, round, slope } from "./stats.js";

/**
 * F2 — Did the intervention work? (pages 09 and 20)
 *
 * Difference-in-differences against comparable blocks:
 *   treated  = the intervention's building, in the incident's category
 *   controls = buildings of the same type, same category, with no intervention
 *              completed in either window
 *   DiD      = (treated_post − treated_pre) − (control_post − control_pre),
 *              in complaints per day
 * A parallel-trend check refuses a verdict when the pre-period slopes differ
 * by more than a stated threshold. A seeded bootstrap (resampling days) gives
 * a 90% interval. Nothing here is a model's opinion.
 */

export const DEFAULT_WINDOW_DAYS = 14;
// ASSUMPTION: pre-period slopes (complaints/day per day) may differ by at most this much.
export const PARALLEL_TREND_MAX_GAP = 0.08;
export const MIN_PRE_COMPLAINTS = 5;
export const BOOTSTRAP = { iterations: 1000, level: 0.9, seed: 20260927 };

const dayIndex = (at, start) => Math.floor((new Date(at) - start) / DAY);

/** Pure: complaints → a per-day count array for [start, start + days). */
export function dailySeries(complaints, start, days) {
  const out = new Array(days).fill(0);
  for (const c of complaints) {
    const i = dayIndex(c.createdAt, start);
    if (i >= 0 && i < days) out[i] += 1;
  }
  return out;
}

/** Pure: the control series is the per-day mean across control units. */
export function averageSeries(seriesList) {
  if (!seriesList.length) return [];
  return seriesList[0].map((_, i) => mean(seriesList.map((s) => s[i])));
}

/** Pure: the whole estimate from four series (per-day counts). */
export function differenceInDifferences({ treatedPre, treatedPost, controlPre, controlPost }, { maxTrendGap = PARALLEL_TREND_MAX_GAP, bootstrapOptions = BOOTSTRAP } = {}) {
  const tPre = mean(treatedPre);
  const tPost = mean(treatedPost);
  const cPre = mean(controlPre);
  const cPost = mean(controlPost);
  const did = tPost - tPre - (cPost - cPre);
  const slopes = { treated: slope(treatedPre), control: slope(controlPre) };
  const gap = Math.abs(slopes.treated - slopes.control);
  const parallel = gap <= maxTrendGap;
  const ci = bootstrap([treatedPre, treatedPost, controlPre, controlPost], (a, b, c, d) => mean(b) - mean(a) - (mean(d) - mean(c)), bootstrapOptions);
  const verdict = !parallel ? "UNRELIABLE" : ci.high < 0 ? "EFFECTIVE" : ci.low > 0 ? "NO EFFECT / WORSE" : "INCONCLUSIVE";
  return {
    means: { treatedPre: round(tPre, 2), treatedPost: round(tPost, 2), controlPre: round(cPre, 2), controlPost: round(cPost, 2) },
    did: round(did, 2),
    interval: { low: round(ci.low, 2), high: round(ci.high, 2), level: ci.level, iterations: ci.iterations, seed: ci.seed },
    parallelTrend: { treatedSlope: round(slopes.treated, 3), controlSlope: round(slopes.control, 3), gap: round(gap, 3), maxGap: maxTrendGap, holds: parallel, maxGapKind: "ASSUMPTION" },
    verdict,
    formula: `DiD = (${round(tPost, 2)} − ${round(tPre, 2)}) − (${round(cPost, 2)} − ${round(cPre, 2)}) = ${round(did, 2)} complaints/day`
  };
}

function shapeVerdict(v, postDays) {
  if (v.verdict === "UNRELIABLE") return { ...v, text: `Comparison unreliable — pre-trends differ (slope gap ${v.parallelTrend.gap} > ${v.parallelTrend.maxGap} complaints/day²). No verdict is given.`, kind: "INSUFFICIENT DATA" };
  const avoided = round(-v.did * postDays, 0);
  const band = `90% interval ${v.interval.low} to ${v.interval.high}`;
  const text = {
    EFFECTIVE: `EFFECTIVE — complaints fell by about ${round(-v.did, 2)}/day more than in comparable blocks (${band}). ≈ ${avoided} complaints avoided over ${postDays} days.`,
    INCONCLUSIVE: `INCONCLUSIVE — the estimate is ${v.did}/day, but the ${band} includes zero.`,
    "NO EFFECT / WORSE": `NO EFFECT / WORSE — complaints rose by ${v.did}/day relative to comparable blocks (${band}).`
  }[v.verdict];
  return { ...v, complaintsAvoided: v.verdict === "EFFECTIVE" ? avoided : null, avoidedFormula: `≈ −DiD × post days = ${round(-v.did, 2)} × ${postDays}`, text, kind: "ACTUAL DATA" };
}

/** Reads the intervention, finds its controls and computes the proof. */
export async function interventionImpact(id, { windowDays = DEFAULT_WINDOW_DAYS, now = new Date(), remember = true } = {}) {
  const intervention = await Intervention.findById(id).lean();
  if (!intervention) throw ApiError.notFound("No intervention with that id");
  const incident = await Incident.findById(intervention.incident).select("reference title category building").lean();
  const building = await Building.findById(intervention.building || incident?.building).select("code name type").lean();
  const base = {
    intervention: { id: String(intervention._id), reference: intervention.reference, action: intervention.decision?.modifiedAction || intervention.recommendedAction, status: intervention.status },
    treated: building ? { code: building.code, name: building.name, category: incident?.category || null } : null,
    windowDays,
    method: "DIFFERENCE_IN_DIFFERENCES + PARALLEL_TREND_CHECK + SEEDED_BOOTSTRAP",
    bootstrap: BOOTSTRAP
  };
  const fixedAt = intervention.outcome?.completedAt || (intervention.status === "COMPLETED" ? intervention.updatedAt : null);
  if (!fixedAt) return { ...base, status: "NOT_RESOLVED", text: "Not measurable yet — this intervention has not been completed, so there is no 'after' to compare.", kind: "INSUFFICIENT DATA" };
  const fix = new Date(fixedAt);
  const measurableOn = new Date(fix.getTime() + windowDays * DAY);
  if (measurableOn > now) return { ...base, status: "WINDOW_OPEN", fixedAt: fix, measurableOn, text: `Measurable on ${measurableOn.toISOString().slice(0, 10)} — the ${windowDays}-day window after the fix has not elapsed.`, kind: "INSUFFICIENT DATA" };
  if (!building || !incident?.category) return { ...base, status: "NO_UNIT", text: "Insufficient data — the intervention has no building or category to measure.", kind: "INSUFFICIENT DATA" };

  const preStart = new Date(fix.getTime() - windowDays * DAY);
  // Controls: same building type, not this building, and no intervention completed inside either window.
  const peers = await Building.find({ type: building.type, _id: { $ne: building._id } }).select("code name").lean();
  const busy = await Intervention.find({ building: { $in: peers.map((p) => p._id) }, "outcome.completedAt": { $gte: preStart, $lte: measurableOn } }).distinct("building");
  const controls = peers.filter((p) => !busy.some((b) => String(b) === String(p._id)));
  const excluded = peers.filter((p) => busy.some((b) => String(b) === String(p._id))).map((p) => p.name);
  if (!controls.length) return { ...base, status: "NO_CONTROLS", fixedAt: fix, text: `Insufficient data — no comparable ${String(building.type).toLowerCase()} block without an intervention exists, so there is nothing to compare against.`, excluded, kind: "INSUFFICIENT DATA" };

  const complaints = await Complaint.find({ category: incident.category, building: { $in: [building._id, ...controls.map((c) => c._id)] }, createdAt: { $gte: preStart, $lt: measurableOn } }).select("building createdAt").lean();
  const of = (b) => complaints.filter((c) => String(c.building) === String(b));
  const treatedPre = dailySeries(of(building._id), preStart, windowDays);
  const treatedPost = dailySeries(of(building._id), fix, windowDays);
  const controlSeries = controls.map((c) => ({ c, pre: dailySeries(of(c._id), preStart, windowDays), post: dailySeries(of(c._id), fix, windowDays) }));
  const controlPre = averageSeries(controlSeries.map((s) => s.pre));
  const controlPost = averageSeries(controlSeries.map((s) => s.post));
  const preTotal = treatedPre.reduce((t, v) => t + v, 0);
  const chart = {
    labels: [...treatedPre, ...treatedPost].map((_, i) => new Date(preStart.getTime() + i * DAY).toISOString().slice(5, 10)),
    treated: [...treatedPre, ...treatedPost],
    control: [...controlPre, ...controlPost].map((v) => round(v, 2)),
    fixIndex: windowDays
  };
  const unit = { ...base, fixedAt: fix, measurableOn, controls: controlSeries.map((s) => ({ code: s.c.code, name: s.c.name, pre: s.pre.reduce((t, v) => t + v, 0), post: s.post.reduce((t, v) => t + v, 0) })), excluded, chart };
  if (preTotal < MIN_PRE_COMPLAINTS) return { ...unit, status: "TOO_FEW", text: `Insufficient data — only ${preTotal} complaint${preTotal === 1 ? "" : "s"} in the ${windowDays} days before the fix (at least ${MIN_PRE_COMPLAINTS} needed).`, kind: "INSUFFICIENT DATA" };

  const result = shapeVerdict(differenceInDifferences({ treatedPre, treatedPost, controlPre, controlPost }), windowDays);
  const out = { ...unit, status: "MEASURED", ...result, totals: { treatedPre: preTotal, treatedPost: treatedPost.reduce((t, v) => t + v, 0) } };

  // Feeds campus memory: the measured effect sits beside the outcome for future recommendations.
  if (remember && incident?._id && result.verdict !== "UNRELIABLE") {
    await CampusMemory.updateMany(
      { incident: incident._id },
      { $set: { measuredEffect: { verdict: result.verdict, didPerDay: result.did, low: result.interval.low, high: result.interval.high, complaintsAvoided: result.complaintsAvoided, windowDays, controls: out.controls.map((c) => c.name), method: base.method, measuredAt: now } } }
    ).catch(() => null);
  }
  return out;
}

/** Page 20: a proof badge per completed intervention (read-only; does not write memory). */
export async function proofBadges({ now = new Date() } = {}) {
  const done = await Intervention.find({ status: "COMPLETED" }).select("_id reference").sort({ "outcome.completedAt": -1 }).limit(10).lean();
  const out = [];
  for (const i of done) {
    const r = await interventionImpact(i._id, { now, remember: false });
    out.push({ id: r.intervention.id, reference: r.intervention.reference, action: r.intervention.action, building: r.treated?.name, category: r.treated?.category, fixedAt: r.fixedAt || null, status: r.status, verdict: r.verdict || null, did: r.did ?? null, interval: r.interval || null, complaintsAvoided: r.complaintsAvoided ?? null, controls: (r.controls || []).map((c) => c.name), text: r.text, kind: r.kind });
  }
  return { badges: out, method: "DIFFERENCE_IN_DIFFERENCES", kind: "ACTUAL DATA" };
}
