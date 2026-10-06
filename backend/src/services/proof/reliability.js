import { assetHistory } from "../xo/assetService.js";
import { DAY, mean, median, round } from "./stats.js";

/**
 * F10 — Asset reliability (page 08). Extends the existing asset repair history
 * (services/xo/assetService.js, which already counts failures per asset from
 * the records that name it) with mean / median time between failures and the
 * next expected failure. A prediction is made only from 3+ failures.
 */

export const MIN_FAILURES = 3;
export const INSPECT_WITHIN_DAYS = 7;

/** Pure: MTBF and the next expected failure from failure dates. */
export function reliability(failureDates, { now = new Date() } = {}) {
  const at = failureDates.map((d) => new Date(d)).sort((a, b) => a - b);
  const gaps = at.slice(1).map((d, i) => (d - at[i]) / DAY);
  const last = at[at.length - 1] || null;
  const since = last ? round((now - last) / DAY, 0) : null;
  if (at.length < MIN_FAILURES) return { failureCount: at.length, gapsDays: gaps.map((g) => round(g, 0)), sinceLastDays: since, insufficient: true, text: `Insufficient data — ${at.length} failure${at.length === 1 ? "" : "s"} recorded; a next-failure estimate needs ${MIN_FAILURES}.`, kind: "INSUFFICIENT DATA" };
  const med = median(gaps);
  const next = new Date(last.getTime() + med * DAY);
  const dueIn = round((next - now) / DAY, 0);
  const inspect = dueIn <= INSPECT_WITHIN_DAYS;
  return {
    failureCount: at.length,
    gapsDays: gaps.map((g) => round(g, 0)),
    mtbfDays: round(mean(gaps), 0),
    medianGapDays: round(med, 0),
    sinceLastDays: since,
    lastFailure: last,
    nextExpected: next,
    dueInDays: dueIn,
    formula: `next expected = last failure + median gap = ${last.toISOString().slice(0, 10)} + ${round(med, 0)} days`,
    recommendation: inspect ? { text: dueIn < 0 ? `Past its median gap by ${-dueIn} days — inspect now.` : `Inspection recommended within ${Math.max(1, dueIn)} days.`, kind: "RECOMMENDED ACTION" } : null,
    kind: "AI PREDICTION"
  };
}

export async function assetReliability({ buildingCode, now = new Date() } = {}) {
  const history = await assetHistory({ buildingCode, now });
  const assets = history.assets.map((a) => {
    const r = reliability(a.failures.map((f) => f.at), { now });
    const headline = r.insufficient ? `${a.name}: ${r.failureCount} failure${r.failureCount === 1 ? "" : "s"} — ${r.text}` : `${a.building} ${a.name}: ${r.failureCount} failures, median gap ${r.medianGapDays} days, last ${r.sinceLastDays} days ago${r.recommendation ? ` → ${r.recommendation.text.toLowerCase()}` : ` → next expected in ${r.dueInDays} days`}.`;
    return { code: a.code, name: a.name, building: a.building, category: a.category, failures: a.failures.map((f) => ({ at: f.at, reference: f.reference, source: f.source, fix: f.fix })), ...r, headline };
  });
  return { assets: assets.sort((a, b) => (a.insufficient ? 1 : 0) - (b.insufficient ? 1 : 0) || (a.dueInDays ?? 999) - (b.dueInDays ?? 999)), minFailures: MIN_FAILURES, method: "MEDIAN_TIME_BETWEEN_FAILURES", source: "Failures from complaints and campus-memory records naming each asset (one failure per day)", kind: "ACTUAL DATA" };
}
