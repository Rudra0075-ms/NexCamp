import { Complaint } from "../models/Complaint.js";
import { clamp, round } from "../utils/text.js";

/**
 * Demand prediction from the project's own history.
 *
 * The honest part of this file is `sufficiency()`. Below a real amount of
 * history there is no forecast at all — the API returns `available: false` and
 * the interface says so, rather than drawing a confident line through four
 * points.
 *
 * The forecast itself is a seasonal-naive baseline (same weekday) blended with
 * a recent moving average, plus a residual-derived interval. It is arithmetic
 * over stored rows, labelled STATISTICAL_BASELINE, and is never presented as a
 * model output.
 */

// Two weeks of days, and complaints on most of them, or there is nothing to
// learn a weekday shape from.
const MIN_DAYS = 14;
const MIN_ACTIVE_DAYS = 8;
const MIN_EVENTS = 20;

const dayKey = (date) => new Date(date).toISOString().slice(0, 10);

/** Turns timestamped rows into a dense day-by-day count series. */
export function toDailySeries(timestamps = [], { days = 30, endDate = new Date() } = {}) {
  const counts = new Map();
  for (const at of timestamps) {
    const key = dayKey(at);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const series = [];
  const end = new Date(endDate);
  end.setUTCHours(0, 0, 0, 0);
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(end.getTime() - offset * 864e5);
    const key = dayKey(day);
    series.push({ date: key, weekday: day.getUTCDay(), count: counts.get(key) || 0 });
  }
  return series;
}

/** Whether this series may be forecast at all, and why not when it may not. */
export function sufficiency(series = []) {
  const days = series.length;
  const activeDays = series.filter((point) => point.count > 0).length;
  const events = series.reduce((total, point) => total + point.count, 0);

  const reasons = [];
  if (days < MIN_DAYS) reasons.push(`only ${days} days of history (${MIN_DAYS} needed)`);
  if (activeDays < MIN_ACTIVE_DAYS) reasons.push(`only ${activeDays} days carry any record (${MIN_ACTIVE_DAYS} needed)`);
  if (events < MIN_EVENTS) reasons.push(`only ${events} records in the window (${MIN_EVENTS} needed)`);

  return {
    available: reasons.length === 0,
    days,
    activeDays,
    events,
    reasons,
    requirement: { minDays: MIN_DAYS, minActiveDays: MIN_ACTIVE_DAYS, minEvents: MIN_EVENTS }
  };
}

function mean(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

/**
 * Forecasts the next day's count.
 *
 * Returns null when the series is not sufficient — callers must check, and the
 * API surfaces the sufficiency reasons instead of a number.
 */
export function forecastNextDay(series = []) {
  const check = sufficiency(series);
  if (!check.available) return null;

  const counts = series.map((point) => point.count);
  const targetWeekday = (series[series.length - 1].weekday + 1) % 7;

  const sameWeekday = series.filter((point) => point.weekday === targetWeekday).map((point) => point.count);
  const recent = counts.slice(-7);

  const seasonal = sameWeekday.length >= 2 ? mean(sameWeekday) : null;
  const movingAverage = mean(recent);

  // Weight the weekday shape only when there is enough of it to be a shape.
  const point = seasonal === null ? movingAverage : 0.55 * seasonal + 0.45 * movingAverage;

  // The interval comes from how wrong this same blend would have been on the
  // days already observed, not from a chosen percentage.
  const residuals = series.slice(7).map((entry, index) => Math.abs(entry.count - mean(counts.slice(index, index + 7))));
  const spread = residuals.length ? mean(residuals) : Math.max(1, movingAverage * 0.3);

  const low = Math.max(0, Math.floor(point - spread));
  const high = Math.ceil(point + spread);

  const firstHalf = mean(counts.slice(0, Math.floor(counts.length / 2)));
  const secondHalf = mean(counts.slice(Math.floor(counts.length / 2)));
  const trendPct = firstHalf > 0 ? round(((secondHalf - firstHalf) / firstHalf) * 100) : 0;

  return {
    expected: round(point),
    range: { low, high },
    // A wide interval relative to the level is a low-confidence forecast, and
    // this is stated as such rather than as a model confidence.
    intervalConfidence: round(clamp(100 - (spread / Math.max(1, point)) * 100, 25, 90)),
    basis: {
      sameWeekdayObservations: sameWeekday.length,
      sameWeekdayMean: round(seasonal ?? 0, 1),
      sevenDayMean: round(movingAverage, 1),
      meanAbsoluteError: round(spread, 1),
      trendPct
    },
    trend: trendPct > 12 ? "RISING" : trendPct < -12 ? "FALLING" : "STABLE",
    method: "STATISTICAL_BASELINE",
    methodDetail: "Seasonal-naive (same weekday) blended with a 7-day moving average; interval from observed mean absolute error.",
    sufficiency: check
  };
}

/** The busiest hour-of-day band in the window, counted from real timestamps. */
export function peakWindow(timestamps = []) {
  if (!timestamps.length) return null;
  const hours = new Array(24).fill(0);
  for (const at of timestamps) hours[new Date(at).getUTCHours()] += 1;

  let bestStart = 0;
  let bestTotal = -1;
  // A three-hour band reads more usefully than a single hour.
  for (let start = 0; start < 24; start += 1) {
    const total = hours[start] + hours[(start + 1) % 24] + hours[(start + 2) % 24];
    if (total > bestTotal) {
      bestTotal = total;
      bestStart = start;
    }
  }

  const share = round((bestTotal / timestamps.length) * 100);
  return {
    fromHour: bestStart,
    toHour: (bestStart + 3) % 24,
    label: `${String(bestStart).padStart(2, "0")}:00 – ${String((bestStart + 3) % 24).padStart(2, "0")}:00 UTC`,
    events: bestTotal,
    sharePct: share,
    hourly: hours.map((count, hour) => ({ hour, count })),
    method: "DATABASE_AGGREGATION"
  };
}

/** Which category is most likely to lead tomorrow, by its share of the window. */
export function leadingCategory(rows = []) {
  if (!rows.length) return null;
  const counts = new Map();
  for (const row of rows) counts.set(row.category, (counts.get(row.category) || 0) + 1);
  const [category, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { category, count, sharePct: round((count / rows.length) * 100), method: "DATABASE_AGGREGATION" };
}

/** Builds the complaint-volume forecast from stored complaints. */
export async function predictComplaintVolume({ days = 30 } = {}) {
  const since = new Date(Date.now() - days * 864e5);
  const rows = await Complaint.find({ createdAt: { $gte: since } })
    .select("createdAt category")
    .sort({ createdAt: 1 })
    .lean();

  const series = toDailySeries(rows.map((row) => row.createdAt), { days });
  const forecast = forecastNextDay(series);

  return {
    metric: "COMPLAINT_VOLUME",
    windowDays: days,
    series,
    available: Boolean(forecast),
    forecast,
    sufficiency: sufficiency(series),
    peak: peakWindow(rows.map((row) => row.createdAt)),
    leadingCategory: leadingCategory(rows),
    label: "ESTIMATE",
    disclaimer:
      "An estimate extrapolated from the complaint records above. It is arithmetic on stored data, not a trained model, and it can be wrong."
  };
}
