import { Complaint } from "../models/Complaint.js";
import { GatePass } from "../models/GatePass.js";
import { round } from "../utils/text.js";
import { toDailySeries } from "./predictionService.js";

/**
 * Anomaly detection over the records the application already keeps.
 *
 * The existing anomalyDetectionService watches engineering metrics against
 * fixed thresholds. This one watches the application's own volumes — complaints
 * per building, gate passes per day — and asks a different question: is today
 * unlike this series' own recent behaviour?
 *
 * "Do not falsely label normal variation as an anomaly" is the whole design
 * constraint here, so:
 *   - the score is a modified z-score built on the median and the median
 *     absolute deviation, which a couple of busy days cannot drag around;
 *   - a series with too little history is reported as INSUFFICIENT_HISTORY
 *     rather than scored;
 *   - a deviation has to clear both the statistical threshold and a minimum
 *     absolute change, so 1 complaint becoming 3 on a quiet series is not an
 *     "anomaly".
 *
 * Pure maths, no network. Labelled STATISTICAL_BASELINE everywhere.
 */

const MIN_BASELINE_DAYS = 10;
// 3.5 is the conventional cut-off for the modified z-score.
const Z_THRESHOLD = 3.5;
const MIN_ABSOLUTE_DELTA = 3;

export function median(values = []) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Median absolute deviation — the spread measure the z-score below uses. */
export function mad(values = []) {
  if (!values.length) return 0;
  const centre = median(values);
  return median(values.map((value) => Math.abs(value - centre)));
}

/**
 * Scores the last point of a series against the points before it.
 * Returns { anomalous: false, reason } when it should not be called an anomaly.
 */
export function scoreSeries(series = [], { label = "series", minAbsoluteDelta = MIN_ABSOLUTE_DELTA } = {}) {
  if (series.length < MIN_BASELINE_DAYS + 1) {
    return {
      anomalous: false,
      reason: "INSUFFICIENT_HISTORY",
      detail: `${series.length} days of history; ${MIN_BASELINE_DAYS + 1} needed before a deviation means anything.`,
      method: "STATISTICAL_BASELINE"
    };
  }

  const counts = series.map((point) => point.count);
  const current = counts[counts.length - 1];
  const baseline = counts.slice(0, -1);

  const centre = median(baseline);
  const deviation = mad(baseline);
  const delta = current - centre;

  const absoluteDelta = Math.abs(delta);

  // MAD of zero means the baseline never moved at all — a series that was flat
  // at the same value every day. No spread means no z-score, so there is
  // nothing to compare against statistically. Rather than dividing by zero or
  // declaring every movement an anomaly, such a series has to clear a larger
  // absolute move before it is called anything, and the response says that the
  // verdict rests on the size of the move alone.
  const scale = deviation || 0;
  const flatBaseline = scale === 0;
  const zScore = flatBaseline ? null : round((0.6745 * delta) / scale, 2);

  const flatFloor = Math.max(minAbsoluteDelta * 3, 5);
  const clearsStatistical = flatBaseline
    ? absoluteDelta >= flatFloor
    : Math.abs(zScore) >= Z_THRESHOLD;
  const clearsAbsolute = absoluteDelta >= minAbsoluteDelta;

  if (!clearsStatistical || !clearsAbsolute) {
    const reason = flatBaseline
      ? "NO_BASELINE_VARIATION"
      : clearsStatistical
        ? "CHANGE_TOO_SMALL"
        : "WITHIN_NORMAL_VARIATION";
    return {
      anomalous: false,
      reason,
      detail:
        reason === "NO_BASELINE_VARIATION"
          ? `${label} has been flat at ${centre} for ${baseline.length} days, so there is no spread to measure against. ` +
            `A move of ${absoluteDelta} is below the ${flatFloor}-record floor required before a flat series is called anomalous.`
          : reason === "CHANGE_TOO_SMALL"
            ? `${label} moved by ${absoluteDelta}, below the ${minAbsoluteDelta}-record floor for calling something an anomaly.`
            : `${label} at ${current} against a ${centre} median is within this series' own normal variation.`,
      current,
      baselineMedian: centre,
      zScore,
      method: "STATISTICAL_BASELINE"
    };
  }

  return {
    anomalous: true,
    direction: delta > 0 ? "UP" : "DOWN",
    current,
    baselineMedian: centre,
    delta,
    changePct: centre ? round((delta / centre) * 100) : null,
    zScore,
    threshold: Z_THRESHOLD,
    baselineDays: baseline.length,
    // A flat baseline has no z-score, so the verdict has to name what it did rest on.
    basis: flatBaseline ? "ABSOLUTE_CHANGE_ON_FLAT_BASELINE" : "MODIFIED_Z_SCORE",
    detail: flatBaseline
      ? `${label} is ${current} against a series that had been flat at ${centre} for ${baseline.length} days — ` +
        `a move of ${absoluteDelta}, past the ${flatFloor}-record floor for a series with no spread.`
      : `${label} is ${current} against a ${centre}-record median over the previous ${baseline.length} days ` +
        `(modified z-score ${zScore}, threshold ${Z_THRESHOLD}).`,
    method: "STATISTICAL_BASELINE"
  };
}

/** Complaint-volume anomalies per building, plus one campus-wide series. */
export async function detectVolumeAnomalies({ days = 30 } = {}) {
  const since = new Date(Date.now() - days * 864e5);
  const rows = await Complaint.find({ createdAt: { $gte: since } })
    .populate("building", "code name")
    .select("createdAt category building reference title")
    .sort({ createdAt: 1 })
    .lean();

  const byBuilding = new Map();
  for (const row of rows) {
    const code = row.building?.code || "UNASSIGNED";
    const entry = byBuilding.get(code) || { code, name: row.building?.name || "Unassigned location", rows: [] };
    entry.rows.push(row);
    byBuilding.set(code, entry);
  }

  const findings = [];

  const campusSeries = toDailySeries(rows.map((row) => row.createdAt), { days });
  const campusScore = scoreSeries(campusSeries, { label: "Campus complaint volume" });
  if (campusScore.anomalous) {
    findings.push({
      scope: "CAMPUS",
      subject: "Campus-wide complaint volume",
      ...campusScore,
      windowDays: days,
      supporting: rows.slice(-6).map((row) => ({ reference: row.reference, title: row.title, at: row.createdAt }))
    });
  }

  for (const entry of byBuilding.values()) {
    const series = toDailySeries(entry.rows.map((row) => row.createdAt), { days });
    const score = scoreSeries(series, { label: `${entry.name} complaint volume` });
    if (!score.anomalous) continue;
    findings.push({
      scope: "BUILDING",
      subject: entry.name,
      building: { code: entry.code, name: entry.name },
      ...score,
      windowDays: days,
      supporting: entry.rows.slice(-6).map((row) => ({ reference: row.reference, title: row.title, at: row.createdAt }))
    });
  }

  // Gate-pass volume, which the same maths handles unchanged.
  const passes = await GatePass.find({ createdAt: { $gte: since } }).select("createdAt reference status").sort({ createdAt: 1 }).lean();
  if (passes.length) {
    const passSeries = toDailySeries(passes.map((row) => row.createdAt), { days });
    const passScore = scoreSeries(passSeries, { label: "Gate pass volume" });
    if (passScore.anomalous) {
      findings.push({
        scope: "GATE_PASS",
        subject: "Gate pass request volume",
        ...passScore,
        windowDays: days,
        supporting: passes.slice(-6).map((row) => ({ reference: row.reference, status: row.status, at: row.createdAt }))
      });
    }
  }

  return {
    windowDays: days,
    complaintsExamined: rows.length,
    gatePassesExamined: passes.length,
    seriesExamined: byBuilding.size + 1 + (passes.length ? 1 : 0),
    findings: findings.sort((a, b) => Math.abs(b.zScore || 0) - Math.abs(a.zScore || 0)),
    method: "STATISTICAL_BASELINE",
    disclaimer:
      "A finding means the latest day sits outside this series' own recent spread by a modified z-score of " +
      `${Z_THRESHOLD} or more, with at least ${MIN_ABSOLUTE_DELTA} records of movement. Series with fewer than ` +
      `${MIN_BASELINE_DAYS + 1} days of history are not scored at all.`
  };
}

export const ANOMALY_SETTINGS = { MIN_BASELINE_DAYS, Z_THRESHOLD, MIN_ABSOLUTE_DELTA };
