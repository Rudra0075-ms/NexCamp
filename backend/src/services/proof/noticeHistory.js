import { Notice } from "../../models/ext/Notice.js";
import { NoticeReceipt } from "../../models/ext/NoticeReceipt.js";
import { istParts } from "../ext/istTime.js";
import { DAY, round } from "./stats.js";

/**
 * What past notices tell us about the next one (pages 13 and 15).
 *
 *   predicted reach  — historical read and action rates for recipients like
 *                      these (same cohort, same channel, same hour band)
 *   attention budget — read rate against how many notices a person received
 *                      that week, shown only with enough data
 *
 * Pure functions take receipt rows; the reader at the bottom fetches them.
 */

export const MIN_RECEIPTS_FOR_REACH = 20;
export const MIN_WEEKS_PER_BAND = 3;
export const MIN_RECEIPTS_PER_BAND = 20;
export const LOAD_BANDS = [
  { key: "≤3", min: 0, max: 3 },
  { key: "4–7", min: 4, max: 7 },
  { key: "≥8", min: 8, max: Infinity }
];
export const HOUR_BANDS = [
  { key: "07–12", from: 7, to: 12 },
  { key: "12–17", from: 12, to: 17 },
  { key: "17–22", from: 17, to: 22 },
  { key: "22–07", from: 22, to: 31 }
];

export const hourBand = (at) => {
  const h = istParts(at).hour;
  const hh = h < 7 ? h + 24 : h;
  return HOUR_BANDS.find((b) => hh >= b.from && hh < b.to)?.key || "22–07";
};

const weekOf = (at) => Math.floor(new Date(at).getTime() / (7 * DAY));

/**
 * Pure: read rate by weekly notice load. Each receipt is placed in the band of
 * how many notices that recipient received in that calendar week.
 */
export function attentionBudget(rows) {
  const perWeek = new Map();
  for (const r of rows) {
    const key = `${r.student}|${weekOf(r.publishedAt)}`;
    perWeek.set(key, (perWeek.get(key) || 0) + 1);
  }
  const bands = LOAD_BANDS.map((b) => ({ ...b, receipts: 0, read: 0, weeks: new Set() }));
  for (const r of rows) {
    const key = `${r.student}|${weekOf(r.publishedAt)}`;
    const load = perWeek.get(key);
    const band = bands.find((b) => load >= b.min && load <= b.max);
    band.receipts += 1;
    if (r.readAt) band.read += 1;
    band.weeks.add(weekOf(r.publishedAt));
  }
  const out = bands.map((b) => {
    const enough = b.receipts >= MIN_RECEIPTS_PER_BAND && b.weeks.size >= MIN_WEEKS_PER_BAND;
    return { band: `${b.key} notices/week`, receipts: b.receipts, weeks: b.weeks.size, readRatePct: enough ? round((b.read / b.receipts) * 100) : null, enough };
  });
  const measured = out.filter((b) => b.enough);
  const first = measured[0];
  const last = measured[measured.length - 1];
  const relation = measured.length >= 2 && first !== last
    ? { text: `Read rate falls from ${first.readRatePct}% at ${first.band} to ${last.readRatePct}% at ${last.band}.`, falls: last.readRatePct < first.readRatePct, kind: "AI DETECTED PATTERN" }
    : { text: `Insufficient data — a relation needs at least two load bands with ${MIN_RECEIPTS_PER_BAND}+ receipts over ${MIN_WEEKS_PER_BAND}+ weeks each.`, falls: null, kind: "INSUFFICIENT DATA" };
  return { bands: out, relation, method: "READ_RATE_BY_WEEKLY_LOAD" };
}

/** Pure: the notices each person received this ISO week, for a cohort. */
export function currentLoad(rows, now = new Date()) {
  const wk = weekOf(now);
  const byStudent = new Map();
  for (const r of rows) if (weekOf(r.publishedAt) === wk) byStudent.set(String(r.student), (byStudent.get(String(r.student)) || 0) + 1);
  const values = [...byStudent.values()];
  return { students: values.length, median: values.length ? values.sort((a, b) => a - b)[Math.floor(values.length / 2)] : 0, max: values.length ? Math.max(...values) : 0 };
}

/**
 * Pure: predicted reach for `recipients` people from rows like them. Falls back
 * from (channel + hour band) to channel only, then to all rows, and says which.
 */
export function predictReach(rows, { recipients, channel = "APP", at = new Date() } = {}) {
  const band = hourBand(at);
  const tiers = [
    { basis: `same cohort, ${channel}, published ${band} IST`, rows: rows.filter((r) => (r.channel || "APP") === channel && hourBand(r.publishedAt) === band) },
    { basis: `same cohort, ${channel}, any hour`, rows: rows.filter((r) => (r.channel || "APP") === channel) },
    { basis: "same cohort, any channel or hour", rows }
  ];
  const tier = tiers.find((t) => t.rows.length >= MIN_RECEIPTS_FOR_REACH);
  if (!tier) return { recipients, insufficient: true, text: `Insufficient data — fewer than ${MIN_RECEIPTS_FOR_REACH} past receipts for this cohort, so no reach is predicted.`, kind: "INSUFFICIENT DATA" };
  const n = tier.rows.length;
  const delivered = tier.rows.filter((r) => r.deliveredAt).length / n;
  const read = tier.rows.filter((r) => r.readAt).length / n;
  const acted = tier.rows.filter((r) => r.actionDoneAt || r.acknowledgedAt).length / n;
  return {
    recipients,
    delivered: Math.round(recipients * delivered),
    read: Math.round(recipients * read),
    acted: Math.round(recipients * acted),
    rates: { deliveredPct: round(delivered * 100), readPct: round(read * 100), actedPct: round(acted * 100) },
    basis: `${n} past receipts — ${tier.basis}`,
    text: `About ${Math.round(recipients * read)} of ${recipients} will read it (${round(read * 100)}% read rate for ${tier.basis}).`,
    kind: "AI PREDICTION"
  };
}

/** Reader: receipts for a set of recipients over the last `days`, with the notice's publish time. */
export async function receiptsFor(studentIds, { days = 84, now = new Date() } = {}) {
  const since = new Date(now - days * DAY);
  const notices = await Notice.find({ status: { $in: ["PUBLISHED", "CANCELLED"] }, publishedAt: { $gte: since, $lte: now } }).select("_id publishedAt title body").lean();
  const byId = new Map(notices.map((n) => [String(n._id), n]));
  const receipts = await NoticeReceipt.find({ notice: { $in: notices.map((n) => n._id) }, ...(studentIds ? { student: { $in: studentIds } } : {}) }).select("notice student deliveredAt readAt acknowledgedAt actionDoneAt channel").lean();
  return receipts.map((r) => ({ ...r, student: String(r.student), publishedAt: byId.get(String(r.notice))?.publishedAt }));
}
