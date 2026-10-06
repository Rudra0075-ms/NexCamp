import { Building } from "../../models/Building.js";
import { GatePass } from "../../models/GatePass.js";
import { MessRecord } from "../../models/MessRecord.js";
import { SlotNudge } from "../../models/proof/SlotNudge.js";
import { istDateKey, istInstant } from "../ext/istTime.js";
import { profileFor } from "../ext/profileService.js";
import { dayFor } from "../ext/timetableService.js";
import { MEAL_ORDER, SERVICE_WINDOWS, currentMeal, dateKey, loadMealDays, predictMeal } from "../messIntelligenceService.js";
import { DAY, mean, median, round } from "./stats.js";

/**
 * F5 — Presence-aware mess forecast (page 04) and a personal best slot (page 02).
 *
 * The gate-pass register knows who will be off campus during a meal; the
 * timetable knows when each student is free. The existing same-weekday
 * forecast is kept as it is, and the presence adjustment is shown as its own
 * line, backtested on past days before anyone should trust it.
 */

export const MIN_BACKTEST_DAYS = 5;
// The adjustment must cut the mean error by at least this share to count as "better".
export const MIN_IMPROVEMENT = 0.05;
export const MIN_NUDGES_FOR_EFFECT = 30;
// Statuses that mean the student did (or will) leave campus on that pass.
export const OUT_STATUSES = ["APPROVED", "ACTIVE", "RETURNED", "RETURNED_LATE", "OVERDUE"];

const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + (m || 0);
};

/** Pure: the meal window of `day` (a mess-register date key, server-local) as instants. */
export function mealWindow(dayKey, meal) {
  const [from, to] = SERVICE_WINDOWS[meal];
  return { from: istInstant(dayKey, from), to: istInstant(dayKey, to) };
}

/** Pure: passes whose out-window covers the whole meal window. */
export function awayDuring(passes, window) {
  return passes.filter((p) => new Date(p.leaveAt) <= window.from && new Date(p.expectedReturnAt) >= window.to);
}

/** Pure: the adjustment line. */
export function adjustment({ away, participation }) {
  const covers = Math.round(away * participation);
  return {
    covers: -covers,
    away,
    participation: round(participation, 2),
    text: `−${covers} covers: ${away} student${away === 1 ? "" : "s"} on approved passes × ${round(participation, 2)} participation`,
    formula: "adjustment = − (students whose pass covers the meal window) × participation rate",
    kind: "AI PREDICTION"
  };
}

/** Pure: mean absolute error with and without the adjustment, over days that had one. */
export function backtest(rows) {
  const used = rows.filter((r) => r.away > 0 && Number.isFinite(r.predicted) && Number.isFinite(r.actual));
  if (used.length < MIN_BACKTEST_DAYS) return { days: used.length, insufficient: true, text: `Insufficient data to backtest — ${used.length} past day${used.length === 1 ? "" : "s"} had students away on passes (at least ${MIN_BACKTEST_DAYS} needed).`, kind: "INSUFFICIENT DATA" };
  const maeRaw = mean(used.map((r) => Math.abs(r.predicted - r.actual)));
  const maeAdj = mean(used.map((r) => Math.abs(r.predicted + r.adjustment - r.actual)));
  const better = maeAdj < maeRaw * (1 - MIN_IMPROVEMENT);
  const same = !better && maeAdj <= maeRaw;
  return {
    days: used.length,
    maeWithout: round(maeRaw, 1),
    maeWith: round(maeAdj, 1),
    better,
    verdict: better ? "BETTER" : same ? "NO MEANINGFUL DIFFERENCE" : "WORSE",
    text: better ? `Adjusted forecast was closer on ${used.length} past days: mean error ${round(maeAdj, 1)} vs ${round(maeRaw, 1)} covers.` : same ? `No meaningful difference on ${used.length} past days: mean error ${round(maeAdj, 1)} with the adjustment vs ${round(maeRaw, 1)} without (less than a ${MIN_IMPROVEMENT * 100}% improvement). Treat it as unproven.` : `Adjustment did not help on ${used.length} past days: mean error ${round(maeAdj, 1)} with it vs ${round(maeRaw, 1)} without. Treat it as unproven.`,
    rows: used.slice(-14),
    kind: "ACTUAL DATA"
  };
}

async function participationRate(allDays, meal) {
  const hostels = await Building.find({ type: "HOSTEL" }).select("occupancy").lean();
  const residents = hostels.reduce((t, h) => t + (h.occupancy || 0), 0);
  // The register's slot counts are headcounts per half hour, not unique diners, so their sum
  // over-counts. The busiest half hour's headcount is a floor on how many residents eat this meal.
  const peaks = allDays.filter((d) => d.meal === meal).map((d) => d.peakCrowd);
  if (!residents || peaks.length < 7) return { rate: null, residents, basis: "Insufficient data — needs hostel occupancy and 7+ recorded meals." };
  const rate = Math.min(1, median(peaks) / residents);
  return { rate, residents, basis: `median busiest-half-hour ${meal.toLowerCase()} headcount ${Math.round(median(peaks))} ÷ ${residents} hostel residents (Building occupancy) — a lower bound on participation. Campus-wide: the register does not record which hostel each diner came from.` };
}

/** Page 04: the forecast with its presence line and backtest. */
export async function presenceForecast({ meal, date, now = new Date() } = {}) {
  const m = MEAL_ORDER.includes(meal) ? meal : currentMeal(now);
  const target = date ? new Date(`${date}T12:00:00`) : now;
  const { days } = await loadMealDays({ days: 42, now });
  const base = predictMeal(days, m, target);
  const part = await participationRate(days, m);
  const targetKey = dateKey(target);
  const window = mealWindow(targetKey, m);
  const futurePasses = await GatePass.find({ status: { $in: ["APPROVED", "ACTIVE"] }, leaveAt: { $lte: window.from }, expectedReturnAt: { $gte: window.to } }).select("student hostelName leaveAt expectedReturnAt").lean();
  const adj = part.rate === null ? null : adjustment({ away: futurePasses.length, participation: part.rate });

  // Backtest: the last four weeks, predicting each day only from days before it.
  const since = new Date(now - 28 * DAY);
  const pastPasses = await GatePass.find({ status: { $in: OUT_STATUSES }, leaveAt: { $gte: new Date(since - 2 * DAY), $lte: now } }).select("leaveAt expectedReturnAt").lean();
  const rows = [];
  for (const d of days.filter((x) => x.meal === m && x.date >= dateKey(since) && x.date < dateKey(now))) {
    const p = predictMeal(days, m, new Date(`${d.date}T12:00:00`));
    if (p.insufficient || part.rate === null) continue;
    const away = awayDuring(pastPasses, mealWindow(d.date, m)).length;
    rows.push({ date: d.date, actual: d.covers, predicted: p.predicted, away, adjustment: -Math.round(away * part.rate) });
  }
  const bt = backtest(rows);
  return {
    meal: m,
    date: targetKey,
    base,
    participation: { rate: part.rate === null ? null : round(part.rate, 2), residents: part.residents, basis: part.basis, kind: part.rate === null ? "INSUFFICIENT DATA" : "ACTUAL DATA" },
    adjustment: adj,
    adjusted: base.insufficient || !adj ? null : { predicted: base.predicted + adj.covers, low: Math.max(0, base.low + adj.covers), high: base.high + adj.covers, kind: "AI PREDICTION" },
    awayStudents: futurePasses.length,
    backtest: bt,
    trust: bt.insufficient ? "UNPROVEN" : bt.better ? "BACKTESTED_BETTER" : "BACKTESTED_NOT_BETTER",
    method: "SAME_WEEKDAY_FORECAST − GATE_PASS_PRESENCE × PARTICIPATION",
    kind: "AI PREDICTION"
  };
}

/** Pure: the best slot for one student from slot history and their free time. */
export function bestSlot({ slots, window, busy = [] }) {
  const [from, to] = window.map(toMin);
  const free = slots.filter((s) => {
    const t = toMin(s.time);
    return t >= from && t < to && !busy.some((b) => t >= toMin(b.start) && t < toMin(b.end));
  });
  if (!free.length) return null;
  const best = [...free].sort((a, b) => a.queueMinutes - b.queueMinutes || toMin(a.time) - toMin(b.time))[0];
  const peak = [...slots].sort((a, b) => b.queueMinutes - a.queueMinutes || b.crowd - a.crowd)[0];
  return { best, peak, freeSlots: free.length };
}

/** Page 02: when this student should go to lunch (or another meal) on a given day. */
export async function myBestSlot(user, { meal = "LUNCH", date, now = new Date() } = {}) {
  const m = MEAL_ORDER.includes(meal) ? meal : "LUNCH";
  const key = date || istDateKey(now);
  const weekday = new Date(`${key}T12:00:00`).getDay();
  const records = await MessRecord.find({ meal: m, date: { $gte: new Date(now - 35 * DAY) } }).select("date time crowd queueMinutes").lean();
  const same = records.filter((r) => new Date(r.date).getDay() === weekday);
  const byTime = new Map();
  for (const r of same) {
    if (!byTime.has(r.time)) byTime.set(r.time, { q: [], c: [] });
    byTime.get(r.time).q.push(r.queueMinutes || 0);
    byTime.get(r.time).c.push(r.crowd || 0);
  }
  const slots = [...byTime.entries()].map(([time, v]) => ({ time, queueMinutes: round(median(v.q), 1), crowd: Math.round(median(v.c)), days: v.q.length })).sort((a, b) => a.time.localeCompare(b.time));
  const minDays = Math.min(...slots.map((s) => s.days), Infinity);
  if (!slots.length || minDays < 2) return { meal: m, date: key, insufficient: true, text: "Insufficient data — fewer than 2 recorded days of queue times for this meal on this weekday.", kind: "INSUFFICIENT DATA" };
  const profile = await profileFor(user);
  const classes = profile?.section ? (await dayFor(profile, key)).filter((s) => s.status !== "CANCELLED" && s.status !== "MOVED_AWAY") : [];
  const busy = classes.map((c) => ({ start: c.startTime, end: c.endTime || `${String(Number(c.startTime.slice(0, 2)) + 1).padStart(2, "0")}:${c.startTime.slice(3)}`, subject: c.subject }));
  const pick = bestSlot({ slots, window: SERVICE_WINDOWS[m], busy });
  const window = SERVICE_WINDOWS[m];
  const before = busy.filter((b) => toMin(b.end) <= toMin(window[1])).sort((a, b) => toMin(b.end) - toMin(a.end))[0];
  if (!pick) return { meal: m, date: key, slots, busy, text: `No free recorded slot in ${m.toLowerCase()} service (${window.join("–")}) — you have class throughout.`, kind: "ACTUAL DATA" };
  const accepted = await SlotNudge.findOne({ student: user._id, date: key, meal: m }).lean();
  return {
    meal: m,
    date: key,
    recommendation: {
      slot: pick.best.time,
      queueMinutes: pick.best.queueMinutes,
      peak: { slot: pick.peak.time, queueMinutes: pick.peak.queueMinutes },
      classEnds: before?.end || null,
      text: `${m.charAt(0) + m.slice(1).toLowerCase()}: arrive ${pick.best.time} — expected queue ~${pick.best.queueMinutes} min (peak ${pick.peak.time}: ~${pick.peak.queueMinutes} min).${before ? ` Your class ends ${before.end}.` : ""}`,
      kind: "AI PREDICTION"
    },
    slots,
    busy,
    granularity: `${slots.length} recorded slots (the register records every 30 minutes, so suggestions are to the nearest slot)`,
    basis: `Median queue per slot on ${same.length ? `${Math.round(same.length / slots.length)} past` : "past"} ${["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"][weekday]} (mess register) and your timetable for ${key}.`,
    accepted: Boolean(accepted),
    method: "SLOT_QUEUE_MEDIAN + TIMETABLE_FREE_TIME"
  };
}

export async function acceptSlot(user, { meal = "LUNCH", date, slot, peakSlot, queueMinutes }, { now = new Date() } = {}) {
  const key = date || istDateKey(now);
  const doc = await SlotNudge.findOneAndUpdate({ student: user._id, date: key, meal }, { $set: { slot, peakSlot, expectedQueueMinutes: queueMinutes } }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
  return { date: doc.date, meal: doc.meal, slot: doc.slot };
}

/** Aggregate nudge effect — only once there is enough of it. */
export async function nudgeEffect({ now = new Date() } = {}) {
  const rows = await SlotNudge.find({ createdAt: { $gte: new Date(now - 28 * DAY) } }).select("date meal slot peakSlot").lean();
  if (rows.length < MIN_NUDGES_FOR_EFFECT) return { accepted: rows.length, insufficient: true, text: `Insufficient data — ${rows.length} accepted suggestions in 28 days; peak-flattening is shown from ${MIN_NUDGES_FOR_EFFECT}.`, kind: "INSUFFICIENT DATA" };
  const offPeak = rows.filter((r) => r.slot !== r.peakSlot).length;
  return { accepted: rows.length, offPeak, text: `${offPeak} of ${rows.length} accepted suggestions moved a student off the peak slot.`, kind: "ACTUAL DATA" };
}
