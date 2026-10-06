import { MessFeedback, MESS_FEEDBACK_THEMES, MESS_MEALS } from "../models/MessFeedback.js";
import { Complaint } from "../models/Complaint.js";
import { MessRecord } from "../models/MessRecord.js";
import { sentimentOf } from "./feedbackService.js";
import { clamp, round } from "../utils/text.js";

/**
 * Mess intelligence.
 *
 * Everything here is arithmetic over MessRecord (what each slot served) and
 * MessFeedback (what students said). No number on the Mess page is typed into
 * the frontend: demand classes, predictions, feedback themes and simulations
 * are all computed here, and every result carries the rule or method that
 * produced it plus the records it was computed from.
 *
 * The functions that take plain arrays are pure, so they can be unit-tested
 * without a database; the async readers at the bottom only fetch rows.
 */

const DAY = 864e5;
export const MEAL_ORDER = MESS_MEALS;
export const SERVICE_WINDOWS = {
  BREAKFAST: ["07:30", "09:30"],
  LUNCH: ["11:30", "14:30"],
  SNACKS: ["14:30", "15:30"],
  DINNER: ["19:30", "21:30"]
};

// Assumptions the simulator states back to the student rather than hides.
export const SIM_ASSUMPTIONS = {
  prepBufferPct: 5,
  kgPerCover: 0.35
};

export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function dateKey(date) {
  const d = new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const WEEKDAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];

function mean(values) {
  return values.length ? values.reduce((t, v) => t + v, 0) / values.length : 0;
}

function stdev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((t, v) => t + (v - m) ** 2, 0) / (values.length - 1));
}

/** Least-squares slope of y over x = 0..n-1. */
function slope(values) {
  const n = values.length;
  if (n < 2) return 0;
  const xm = (n - 1) / 2;
  const ym = mean(values);
  let num = 0;
  let den = 0;
  values.forEach((v, i) => {
    num += (i - xm) * (v - ym);
    den += (i - xm) ** 2;
  });
  return den ? num / den : 0;
}

// ---- feedback classification ------------------------------------------------

// Phrases that file a comment under a theme. A comment can carry several.
const THEME_RULES = {
  QUANTITY: ["portion", "quantity", "too small", "very less", "is less", "hungry", "not enough", "second helping", "more rice"],
  TASTE: ["taste", "tasty", "tasteless", "bland", "delicious", "oil", "salt", "spicy", "flavour", "flavor"],
  VARIETY: ["variety", "same menu", "same food", "repetitive", "change the menu", "boring"],
  TEMPERATURE: ["cold", "lukewarm", "hot food", "reheated", "not hot"],
  HYGIENE: ["hair", "dirty", "clean", "hygiene", "insect", "smell", "unwashed"],
  QUEUE: ["queue", "crowded", "waited", "waiting", "no seats", "rush", "long line"],
  AVAILABILITY: ["finished", "ran out", "run out", "nothing left", "not available", "sold out", "over before"]
};

/** Themes and sentiment for one comment. Deterministic and labelled as such. */
export function classifyFeedback({ comment, rating }) {
  const text = ` ${String(comment || "").toLowerCase()} `;
  const themes = Object.entries(THEME_RULES)
    .filter(([, phrases]) => phrases.some((phrase) => text.includes(phrase)))
    .map(([theme]) => theme);
  if (!themes.length && String(comment || "").trim()) themes.push("OTHER");
  const sentiment = sentimentOf(comment, Number(rating));
  return { themes, sentiment: sentiment.label, method: "KEYWORD_THEMES + LEXICON_SENTIMENT" };
}

// ---- demand: from slot rows to meals ----------------------------------------

/** Folds slot records into one row per (day, meal). Pure. */
export function mealDays(records) {
  const byKey = new Map();
  for (const record of records) {
    const key = `${dateKey(record.date)}|${record.meal}`;
    const row =
      byKey.get(key) ||
      {
        date: dateKey(record.date),
        weekday: new Date(record.date).getDay(),
        meal: record.meal,
        covers: 0,
        capacity: record.capacity || 850,
        peakCrowd: 0,
        peakTime: null,
        wasteWeighted: 0,
        queueMax: 0,
        slots: [],
        menu: []
      };
    row.covers += record.crowd || 0;
    row.wasteWeighted += (record.waste || 0) * (record.crowd || 0);
    row.queueMax = Math.max(row.queueMax, record.queueMinutes || 0);
    row.slots.push({ time: record.time, crowd: record.crowd || 0, queueMinutes: record.queueMinutes || 0, waste: record.waste || 0 });
    if ((record.crowd || 0) > row.peakCrowd) {
      row.peakCrowd = record.crowd;
      row.peakTime = record.time;
    }
    if (!row.menu.length && record.menu?.length) row.menu = record.menu;
    byKey.set(key, row);
  }
  return [...byKey.values()]
    .map((row) => ({
      ...row,
      waste: row.covers ? round(row.wasteWeighted / row.covers, 1) : 0,
      utilisation: round((row.peakCrowd / row.capacity) * 100, 1),
      slots: row.slots.sort((a, b) => a.time.localeCompare(b.time))
    }))
    .map(({ wasteWeighted, ...row }) => row)
    .sort((a, b) => a.date.localeCompare(b.date) || MEAL_ORDER.indexOf(a.meal) - MEAL_ORDER.indexOf(b.meal));
}

/**
 * Predicted covers for one meal on one date, from history strictly before it.
 *
 * Method: the same weekday over the last four weeks, newest weighted highest
 * (4, 3, 2, 1), then nudged by half the difference between the last seven
 * days and the three weeks before them, so a genuine recent rise or fall is
 * carried forward. The interval is ±1.28σ of the same-weekday samples (≈80%).
 */
export function predictMeal(days, meal, targetDate) {
  const target = dateKey(targetDate);
  const weekday = new Date(`${target}T12:00:00`).getDay();
  const history = days.filter((row) => row.meal === meal && row.date < target);
  const sameDay = history.filter((row) => row.weekday === weekday).slice(-4).reverse();

  if (sameDay.length < 2) {
    return {
      meal,
      date: target,
      insufficient: true,
      samples: sameDay.length,
      reason: `Only ${sameDay.length} earlier ${WEEKDAYS[weekday].toLowerCase()} ${meal.toLowerCase()} on record — at least 2 are needed to predict.`
    };
  }

  const weights = [4, 3, 2, 1].slice(0, sameDay.length);
  const weighted = sameDay.reduce((t, row, i) => t + row.covers * weights[i], 0) / weights.reduce((t, w) => t + w, 0);

  const cutoff = new Date(`${target}T00:00:00`).getTime();
  const recent = history.filter((row) => cutoff - new Date(`${row.date}T00:00:00`).getTime() <= 7 * DAY);
  const earlier = history.filter((row) => {
    const age = cutoff - new Date(`${row.date}T00:00:00`).getTime();
    return age > 7 * DAY && age <= 28 * DAY;
  });
  const levelShift = recent.length >= 3 && earlier.length >= 3 ? (mean(recent.map((r) => r.covers)) - mean(earlier.map((r) => r.covers))) / 2 : 0;

  const predicted = Math.max(0, Math.round(weighted + levelShift));
  const sigma = stdev(sameDay.map((row) => row.covers));
  const cv = predicted ? sigma / predicted : 1;
  const confidence = Math.round(clamp(96 - cv * 180 - (4 - sameDay.length) * 7, 35, 95));

  // Peak slot: the same-weekday peak share applied to the predicted total.
  const peakShare = mean(sameDay.map((row) => (row.covers ? row.peakCrowd / row.covers : 0)));
  const capacity = sameDay[0].capacity || 850;
  const peakCrowd = Math.round(predicted * peakShare);

  return {
    meal,
    date: target,
    weekday: WEEKDAYS[weekday],
    predicted,
    low: Math.max(0, Math.round(predicted - 1.28 * sigma)),
    high: Math.round(predicted + 1.28 * sigma),
    confidence,
    peakCrowd,
    peakUtilisation: round((peakCrowd / capacity) * 100, 1),
    capacity,
    samples: sameDay.map((row) => ({ date: row.date, covers: row.covers })),
    levelShift: Math.round(levelShift),
    kind: "AI PREDICTION",
    method: "SAME_WEEKDAY_WEIGHTED_AVERAGE + RECENT_LEVEL_SHIFT",
    confidenceBasis: `Spread of ${sameDay.length} same-weekday samples (σ ${Math.round(sigma)} covers). Statistical, not a model probability.`
  };
}

/**
 * Demand class for one served meal, against what history predicted for it.
 * Returns the label plus the numbers that decided it.
 */
export function classifyDemand(day, prediction) {
  const reasons = [];
  let label = "NORMAL DEMAND";
  if (!prediction || prediction.insufficient) {
    if (day.utilisation >= 82) {
      label = "HIGH DEMAND";
      reasons.push(`Peak ${day.peakCrowd} at ${day.peakTime} fills ${day.utilisation}% of ${day.capacity} seats.`);
    } else {
      reasons.push("Not enough history to compare against; classed on seat utilisation only.");
    }
    return { label, reasons, ratio: null, confidence: 50, method: "UTILISATION_THRESHOLD" };
  }

  const ratio = prediction.predicted ? day.covers / prediction.predicted : 1;
  const byRatio = ratio >= 1.1;
  const bySeats = day.utilisation >= 90;
  if (byRatio || bySeats) label = "HIGH DEMAND";
  else if (ratio <= 0.9) label = "LOW DEMAND";

  const versus = `${day.covers.toLocaleString("en-IN")} covers against ${prediction.predicted.toLocaleString("en-IN")} expected from ${prediction.samples.length} earlier ${prediction.weekday.toLowerCase()}s (${ratio >= 1 ? "+" : ""}${round((ratio - 1) * 100, 1)}%).`;
  const seats = `Peak ${day.peakCrowd} at ${day.peakTime} fills ${day.utilisation}% of ${day.capacity} seats${bySeats ? " — above the 90% line" : ""}.`;
  // The reason that decided the label goes first.
  if (bySeats && !byRatio) reasons.push(seats, versus);
  else reasons.push(versus, seats);

  const distance = Math.abs(ratio - 1);
  const confidence = Math.round(clamp(prediction.confidence * (label === "NORMAL DEMAND" ? 1 : 0.7 + Math.min(distance, 0.3)), 35, 95));
  return { label, reasons, ratio: round(ratio, 3), confidence, method: "ACTUAL_VS_SAME_WEEKDAY_BASELINE" };
}

/** Covers trend for a meal over the last N days. */
export function demandTrend(days, meal, { window = 14, now = new Date() } = {}) {
  const cutoff = dateKey(new Date(now.getTime() - window * DAY));
  const rows = days.filter((row) => row.meal === meal && row.date > cutoff && row.date <= dateKey(now));
  if (rows.length < 5) return { label: "INSUFFICIENT DATA", perWeekPct: null, samples: rows.length };
  const values = rows.map((row) => row.covers);
  const perDay = slope(values);
  const perWeekPct = mean(values) ? round(((perDay * 7) / mean(values)) * 100, 1) : 0;
  const label = perWeekPct >= 4 ? "DEMAND RISING" : perWeekPct <= -4 ? "DEMAND FALLING" : "DEMAND STEADY";
  return { label, perWeekPct, samples: rows.length, series: rows.map((row) => ({ date: row.date, covers: row.covers })), method: "LINEAR_TREND" };
}

// ---- feedback intelligence ---------------------------------------------------

/**
 * Groups feedback into themes and looks for themes that are rising.
 * `rows` are MessFeedback-shaped objects with date, meal, rating, comment,
 * themes and sentiment. Pure.
 */
export function feedbackIntel(rows, { now = new Date(), meal = null, theme = null, days = 28 } = {}) {
  const until = now.getTime();
  const inWindow = rows.filter((row) => until - new Date(row.date).getTime() <= days * DAY);
  const scoped = inWindow.filter((row) => (!meal || row.meal === meal) && (!theme || (row.themes || []).includes(theme)));

  const commented = scoped.filter((row) => (row.themes || []).length);
  const themeCounts = Object.fromEntries(MESS_FEEDBACK_THEMES.map((t) => [t, { count: 0, positive: 0, negative: 0 }]));
  commented.forEach((row) => row.themes.forEach((t) => {
    themeCounts[t].count += 1;
    if (row.sentiment === "POSITIVE") themeCounts[t].positive += 1;
    if (row.sentiment === "NEGATIVE") themeCounts[t].negative += 1;
  }));
  const themeTotal = Object.values(themeCounts).reduce((t, v) => t + v.count, 0);
  const distribution = MESS_FEEDBACK_THEMES
    .map((t) => ({
      theme: t,
      count: themeCounts[t].count,
      positive: themeCounts[t].positive,
      negative: themeCounts[t].negative,
      share: themeTotal ? round((themeCounts[t].count / themeTotal) * 100, 1) : 0
    }))
    .filter((row) => row.count)
    .sort((a, b) => b.count - a.count);

  const sentiment = { POSITIVE: 0, NEUTRAL: 0, NEGATIVE: 0 };
  scoped.forEach((row) => { if (row.sentiment) sentiment[row.sentiment] += 1; });

  const byMeal = MEAL_ORDER.map((m) => {
    const mine = inWindow.filter((row) => row.meal === m);
    return {
      meal: m,
      responses: mine.length,
      averageRating: mine.length ? round(mean(mine.map((row) => row.rating)), 2) : null,
      negativeShare: mine.length ? round((mine.filter((row) => row.sentiment === "NEGATIVE").length / mine.length) * 100, 1) : null
    };
  }).filter((row) => row.responses);

  // Rising themes: the last 7 days against the 7 before, per meal and theme.
  const last = (row) => until - new Date(row.date).getTime() <= 7 * DAY;
  const prev = (row) => {
    const age = until - new Date(row.date).getTime();
    return age > 7 * DAY && age <= 14 * DAY;
  };
  const patterns = [];
  for (const m of MEAL_ORDER) {
    for (const t of MESS_FEEDBACK_THEMES.filter((x) => x !== "OTHER")) {
      const hits = rows.filter((row) => row.meal === m && (row.themes || []).includes(t));
      const now7 = hits.filter(last);
      const before7 = hits.filter(prev);
      const negativeNow = now7.filter((row) => row.sentiment !== "POSITIVE").length;
      if (negativeNow >= 4 && negativeNow >= Math.max(2, before7.length) * 2) {
        patterns.push({
          meal: m,
          theme: t,
          last7: now7.length,
          previous7: before7.length,
          headline: `${t.charAt(0) + t.slice(1).toLowerCase()}-related feedback at ${m.toLowerCase()} rose from ${before7.length} to ${now7.length} in the last 7 days.`,
          samples: now7.filter((row) => row.comment).slice(-3).map((row) => ({ date: dateKey(row.date), rating: row.rating, comment: row.comment })),
          confidence: Math.round(clamp(55 + negativeNow * 4 - before7.length * 2, 50, 92)),
          kind: "AI DETECTED PATTERN",
          method: "WEEK_OVER_WEEK_THEME_COUNT"
        });
      }
    }
  }
  patterns.sort((a, b) => b.last7 - b.previous7 - (a.last7 - a.previous7));

  return {
    windowDays: days,
    filters: { meal, theme },
    responses: scoped.length,
    withComments: commented.length,
    averageRating: scoped.length ? round(mean(scoped.map((row) => row.rating)), 2) : null,
    sentiment,
    distribution,
    byMeal,
    patterns,
    recent: scoped
      .filter((row) => row.comment)
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 8)
      .map((row) => ({ date: dateKey(row.date), meal: row.meal, rating: row.rating, comment: row.comment, themes: row.themes, sentiment: row.sentiment })),
    method: "KEYWORD_THEMES + LEXICON_SENTIMENT + WEEK_OVER_WEEK_COUNT"
  };
}

/** Feedback-derived labels for one meal: alert, improving, declining. */
export function classifyFeedbackTrend(rows, meal, { now = new Date() } = {}) {
  const until = now.getTime();
  const mine = rows.filter((row) => row.meal === meal);
  const last = mine.filter((row) => until - new Date(row.date).getTime() <= 7 * DAY);
  const prev = mine.filter((row) => {
    const age = until - new Date(row.date).getTime();
    return age > 7 * DAY && age <= 14 * DAY;
  });
  const labels = [];
  if (last.length < 6) return { labels, samples: last.length, note: "Fewer than 6 ratings in the last 7 days." };
  const lastAvg = mean(last.map((row) => row.rating));
  const negShare = last.filter((row) => row.sentiment === "NEGATIVE").length / last.length;
  if (negShare >= 0.35) {
    labels.push({ label: "FEEDBACK ALERT", reason: `${round(negShare * 100)}% of ${last.length} ratings in the last 7 days were negative.` });
  }
  if (prev.length >= 6) {
    const prevAvg = mean(prev.map((row) => row.rating));
    const diff = lastAvg - prevAvg;
    if (diff >= 0.3) labels.push({ label: "RATINGS IMPROVING", reason: `Average rating up from ${round(prevAvg, 2)} to ${round(lastAvg, 2)} week over week.` });
    if (diff <= -0.3) labels.push({ label: "RATINGS DECLINING", reason: `Average rating down from ${round(prevAvg, 2)} to ${round(lastAvg, 2)} week over week.` });
  }
  return { labels, samples: last.length, averageRating: round(lastAvg, 2) };
}

// ---- menu popularity and availability ---------------------------------------

/** Item uptake and sell-outs across the window. Pure. */
export function menuStats(days) {
  const items = new Map();
  for (const day of days) {
    for (const item of day.menu || []) {
      const row = items.get(item.item) || { item: item.item, meals: new Set(), served: 0, taken: [], soldOut: [] };
      row.meals.add(day.meal);
      row.served += 1;
      if (Number.isFinite(item.takenPercentage)) row.taken.push(item.takenPercentage);
      if (item.soldOutAt) row.soldOut.push({ date: day.date, meal: day.meal, at: item.soldOutAt });
      items.set(item.item, row);
    }
  }
  return [...items.values()]
    .map((row) => ({
      item: row.item,
      meals: [...row.meals],
      timesServed: row.served,
      averageTaken: row.taken.length ? round(mean(row.taken), 1) : null,
      soldOutCount: row.soldOut.length,
      soldOutRate: round((row.soldOut.length / row.served) * 100, 1),
      soldOut: row.soldOut.slice(-4)
    }))
    .sort((a, b) => (b.averageTaken ?? 0) - (a.averageTaken ?? 0));
}

/** Average covers per weekday per meal, and average crowd per slot. Pure. */
export function patterns(days) {
  const byWeekday = MEAL_ORDER.map((meal) => ({
    meal,
    days: WEEKDAYS.map((name, weekday) => {
      const rows = days.filter((row) => row.meal === meal && row.weekday === weekday);
      return { weekday: name.slice(0, 3), average: rows.length ? Math.round(mean(rows.map((row) => row.covers))) : null, samples: rows.length };
    })
  })).filter((row) => row.days.some((d) => d.samples));

  const slotMap = new Map();
  for (const day of days) {
    for (const slot of day.slots) {
      const row = slotMap.get(slot.time) || { time: slot.time, meal: day.meal, crowd: [], queue: [] };
      row.crowd.push(slot.crowd);
      row.queue.push(slot.queueMinutes);
      slotMap.set(slot.time, row);
    }
  }
  const bySlot = [...slotMap.values()]
    .map((row) => ({ time: row.time, meal: row.meal, averageCrowd: Math.round(mean(row.crowd)), averageQueue: round(mean(row.queue), 1), samples: row.crowd.length }))
    .sort((a, b) => a.time.localeCompare(b.time));

  return { byWeekday, bySlot };
}

// ---- simulation --------------------------------------------------------------

/**
 * What-if for one meal. Never touches the database: it takes the prediction
 * and the scenario, and returns what the numbers would be.
 */
export function simulateMeal({ prediction, day, scenario = {}, capacity = 850 }) {
  if (!prediction || prediction.insufficient) {
    return { insufficient: true, reason: prediction?.reason || "No prediction available for this meal." };
  }
  const baseline = prediction.predicted;
  const changePct = Number(scenario.attendanceChangePct) || 0;
  const changeAbs = Number(scenario.attendanceChange) || 0;
  const expected = Number.isFinite(Number(scenario.expectedDiners)) && scenario.expectedDiners !== null && scenario.expectedDiners !== undefined
    ? Math.max(0, Math.round(Number(scenario.expectedDiners)))
    : Math.max(0, Math.round(baseline * (1 + changePct / 100) + changeAbs));

  const prepared = Number.isFinite(Number(scenario.preparedCovers)) && scenario.preparedCovers
    ? Math.round(Number(scenario.preparedCovers))
    : Math.round(baseline * (1 + SIM_ASSUMPTIONS.prepBufferPct / 100));
  const surplus = Math.max(0, prepared - expected);
  const shortage = Math.max(0, expected - prepared);

  const peakShare = baseline ? prediction.peakCrowd / baseline : 0;
  const peakCrowd = Math.round(expected * peakShare);
  const peakUtilisation = round((peakCrowd / capacity) * 100, 1);

  const result = {
    meal: prediction.meal,
    date: prediction.date,
    baseline,
    expected,
    delta: expected - baseline,
    deltaPct: baseline ? round(((expected - baseline) / baseline) * 100, 1) : 0,
    prepared,
    surplus,
    shortage,
    surplusKg: round(surplus * SIM_ASSUMPTIONS.kgPerCover, 1),
    peakCrowd,
    peakUtilisation,
    capacity,
    capacityStatus: peakCrowd > capacity ? "OVER CAPACITY" : peakUtilisation >= 82 ? "NEAR CAPACITY" : "WITHIN CAPACITY",
    item: null,
    kind: "SIMULATED RESULT",
    method: "SCENARIO_ARITHMETIC",
    assumptions: [
      `The kitchen prepares the predicted ${baseline} covers + ${SIM_ASSUMPTIONS.prepBufferPct}% buffer unless you set a figure.`,
      `Waste is estimated at ${SIM_ASSUMPTIONS.kgPerCover} kg per uneaten cover.`,
      `The busiest slot keeps its usual share (${round(peakShare * 100, 1)}%) of the meal's covers.`
    ],
    note: "Simulation only — no mess record is changed."
  };

  // Item-level: what if more students pick one dish?
  if (scenario.item && day?.menu?.length) {
    const item = day.menu.find((row) => row.item === scenario.item);
    if (item) {
      const shift = Number(scenario.selectionShiftPct) || 0;
      const baseTaken = Math.round((item.servings || 0) * ((item.takenPercentage || 0) / 100));
      const scaled = Math.round(baseTaken * (expected / (baseline || 1)) * (1 + shift / 100));
      const window = SERVICE_WINDOWS[prediction.meal];
      let runsOutAt = null;
      if (scaled > item.servings && window) {
        const [sh, sm] = window[0].split(":").map(Number);
        const [eh, em] = window[1].split(":").map(Number);
        const minutes = (eh * 60 + em - (sh * 60 + sm)) * (item.servings / scaled);
        const at = sh * 60 + sm + Math.round(minutes);
        runsOutAt = `${String(Math.floor(at / 60)).padStart(2, "0")}:${String(at % 60).padStart(2, "0")}`;
      }
      result.item = {
        item: item.item,
        selectionShiftPct: shift,
        currentDemand: baseTaken,
        projectedDemand: scaled,
        servingsPrepared: item.servings,
        shortfall: Math.max(0, scaled - item.servings),
        runsOutAt,
        assumption: "Servings drawn scale with diners and the selection change; service runs at an even pace."
      };
    }
  }
  return result;
}

// ---- database readers --------------------------------------------------------

export async function loadMealDays({ days = 28, now = new Date() } = {}) {
  const from = startOfDay(new Date(now.getTime() - days * DAY));
  const to = new Date(startOfDay(now).getTime() + 2 * DAY);
  const records = await MessRecord.find({ date: { $gte: from, $lt: to } }).sort({ date: 1, time: 1 }).lean();
  return { records, days: mealDays(records) };
}

export async function loadFeedback({ days = 28, now = new Date() } = {}) {
  const from = startOfDay(new Date(now.getTime() - days * DAY));
  const [feedback, complaints] = await Promise.all([
    MessFeedback.find({ date: { $gte: from } }).select("date meal rating comment themes sentiment").sort({ date: 1 }).lean(),
    Complaint.find({ category: "MESS", createdAt: { $gte: from } }).select("title description createdAt status reference").lean()
  ]);
  return { feedback, complaints };
}

/** Which meal is being served now, or next. */
export function currentMeal(now = new Date()) {
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  for (const meal of MEAL_ORDER) {
    const [, end] = SERVICE_WINDOWS[meal];
    if (hhmm < end) return meal;
  }
  return "BREAKFAST";
}

/**
 * The whole Mess page in one read: today's meals with their classes, the
 * prediction for a chosen meal and date, feedback intelligence, popularity,
 * availability and day/time patterns.
 */
export async function messIntelligence({ date, meal, days = 28, feedbackMeal = null, feedbackTheme = null, now = new Date() } = {}) {
  const { days: allDays } = await loadMealDays({ days: Math.max(days, 28), now });
  const { feedback, complaints } = await loadFeedback({ days: Math.max(days, 28), now });

  const todayKey = dateKey(now);
  const today = MEAL_ORDER.map((m) => {
    const day = allDays.find((row) => row.date === todayKey && row.meal === m) || null;
    const prediction = predictMeal(allDays, m, now);
    const demand = day ? classifyDemand(day, prediction) : null;
    const fb = classifyFeedbackTrend(feedback, m, { now });
    const window = SERVICE_WINDOWS[m];
    const labels = [];
    if (demand) labels.push({ label: demand.label, reason: demand.reasons[0] });
    fb.labels.forEach((row) => labels.push(row));
    if (day && day.waste >= 9) labels.push({ label: "WASTE RISK", reason: `Recorded waste ${day.waste}% of covers, above the 9% line.` });
    return {
      meal: m,
      window,
      served: Boolean(day),
      menu: (day?.menu || []).map((item) => ({ item: item.item, servings: item.servings, takenPercentage: item.takenPercentage, soldOutAt: item.soldOutAt || null, available: !item.soldOutAt })),
      covers: day?.covers ?? null,
      peak: day ? { time: day.peakTime, crowd: day.peakCrowd, utilisation: day.utilisation } : null,
      waste: day?.waste ?? null,
      queueMax: day?.queueMax ?? null,
      slots: day?.slots || [],
      prediction,
      demand,
      feedback: fb,
      labels,
      trend: demandTrend(allDays, m, { now })
    };
  }).filter((row) => row.served || !row.prediction.insufficient);

  const focusMeal = meal && MEAL_ORDER.includes(meal) ? meal : currentMeal(now);
  const focusDate = date ? new Date(`${date}T12:00:00`) : now;
  const focusDay = allDays.find((row) => row.date === dateKey(focusDate) && row.meal === focusMeal) || null;
  const focusPrediction = predictMeal(allDays, focusMeal, focusDate);
  const tomorrow = new Date(startOfDay(now).getTime() + DAY + 12 * 3600e3);

  const windowed = allDays.filter((row) => row.date > dateKey(new Date(now.getTime() - days * DAY)));

  return {
    generatedAt: now,
    windowDays: days,
    dataRange: allDays.length ? { from: allDays[0].date, to: allDays[allDays.length - 1].date, mealDays: allDays.length } : null,
    today,
    focus: {
      meal: focusMeal,
      date: dateKey(focusDate),
      served: focusDay ? { covers: focusDay.covers, peak: { time: focusDay.peakTime, crowd: focusDay.peakCrowd }, waste: focusDay.waste } : null,
      prediction: focusPrediction,
      demand: focusDay ? classifyDemand(focusDay, focusPrediction) : null,
      history: allDays.filter((row) => row.meal === focusMeal).slice(-28).map((row) => ({ date: row.date, covers: row.covers, weekday: row.weekday }))
    },
    tomorrow: MEAL_ORDER.map((m) => predictMeal(allDays, m, tomorrow)).filter((row) => !row.insufficient),
    feedback: {
      ...feedbackIntel(feedback, { now, meal: feedbackMeal, theme: feedbackTheme, days }),
      complaints: {
        count: complaints.length,
        items: complaints.slice(0, 5).map((row) => ({ reference: row.reference, title: row.title, status: row.status, themes: classifyFeedback({ comment: `${row.title}. ${row.description}` }).themes }))
      }
    },
    menu: menuStats(windowed),
    patterns: patterns(windowed),
    methods: {
      demand: "ACTUAL_VS_SAME_WEEKDAY_BASELINE",
      prediction: "SAME_WEEKDAY_WEIGHTED_AVERAGE + RECENT_LEVEL_SHIFT",
      feedback: "KEYWORD_THEMES + LEXICON_SENTIMENT",
      note: "Deterministic analysis over mess records and student ratings. No language model computes these numbers."
    }
  };
}

/** POST /api/mess/simulate: prediction + scenario for one meal. */
export async function simulateScenario({ meal, date, now = new Date(), ...scenario }) {
  const { days } = await loadMealDays({ days: 35, now });
  const target = date ? new Date(`${date}T12:00:00`) : now;
  const m = MEAL_ORDER.includes(meal) ? meal : currentMeal(now);
  const prediction = predictMeal(days, m, target);
  // The menu comes from the most recent serving of this meal on the same weekday.
  const weekday = target.getDay();
  const reference = [...days].reverse().find((row) => row.meal === m && row.weekday === weekday && row.menu?.length) || null;
  return {
    prediction,
    menu: (reference?.menu || []).map((item) => ({ item: item.item, servings: item.servings, takenPercentage: item.takenPercentage })),
    simulation: simulateMeal({ prediction, day: reference, scenario, capacity: prediction.capacity || 850 })
  };
}
