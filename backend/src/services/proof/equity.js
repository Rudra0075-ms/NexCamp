import { Complaint } from "../../models/Complaint.js";
import { everyoneWithProfiles } from "../ext/profileService.js";
import { DAY, HOUR, bootstrap, median, round } from "./stats.js";

/**
 * F8 — Service equity monitor (pages 21 and 10).
 *
 * Is a student who files by kiosk or SMS served as well as one who uses the
 * app? Median resolution time and completion rate per group, each with a
 * seeded bootstrap 90% interval. A gap is flagged only when the interval of
 * the ratio excludes 1 and both groups have at least the minimum sample —
 * otherwise it says "no measurable gap" or "insufficient data". Only
 * groupings the system already records are used: channel, hostel, year.
 */

export const MIN_GROUP = 5;
export const BOOT = { iterations: 1000, level: 0.9, seed: 7 };
const ROOM = /\b([A-C]-\d{3}|room\s*\d+|lab\s*\d+|floor\s*\d|\d(st|nd|rd|th)\s+floor|counter\s*\d)\b/i;

/** Pure: how complete a complaint's fields are, 0–1 (room / precise location, description ≥ 40 chars, evidence). */
export function completeness(c) {
  const parts = [ROOM.test(`${c.location || ""} ${c.description || ""}`), String(c.description || "").length >= 40, (c.evidence || []).length > 0];
  return parts.filter(Boolean).length / parts.length;
}

/** Pure: one group against everyone else. */
export function compareGroup(group, rest, { label, dimension }) {
  const who = dimension === "channel" ? `${label}-filed complaints` : dimension === "hostel" ? `Complaints from ${label} residents` : `${label} students' complaints`;
  const hoursOf = (xs) => xs.filter((c) => c.hours !== null).map((c) => c.hours);
  const gh = hoursOf(group);
  const rh = hoursOf(rest);
  const out = { dimension, group: label, n: group.length, nResolved: gh.length, nRest: rest.length, completionPct: group.length ? round((gh.length / group.length) * 100) : null, restCompletionPct: rest.length ? round((rh.length / rest.length) * 100) : null, fieldCompletenessPct: round((group.reduce((t, c) => t + c.complete, 0) / Math.max(1, group.length)) * 100), restFieldCompletenessPct: round((rest.reduce((t, c) => t + c.complete, 0) / Math.max(1, rest.length)) * 100) };
  if (gh.length < MIN_GROUP || rh.length < MIN_GROUP) return { ...out, verdict: "INSUFFICIENT DATA", text: `${who}: insufficient data (n = ${gh.length} resolved vs ${rh.length}; ${MIN_GROUP} each needed).`, kind: "INSUFFICIENT DATA" };
  const ratio = median(gh) / Math.max(0.1, median(rh));
  const ci = bootstrap([gh, rh], (a, b) => median(a) / Math.max(0.1, median(b)), BOOT);
  const gap = ci.low > 1 ? "SLOWER" : ci.high < 1 ? "FASTER" : "NO MEASURABLE GAP";
  const cause = gap === "SLOWER" && out.fieldCompletenessPct < out.restFieldCompletenessPct - 10 ? ` Possible cause: these tickets are less complete (field completeness ${out.fieldCompletenessPct}% vs ${out.restFieldCompletenessPct}%) — AI HYPOTHESIS.` : "";
  return {
    ...out,
    medianHours: round(median(gh), 1),
    restMedianHours: round(median(rh), 1),
    ratio: round(ratio, 2),
    interval: { low: round(ci.low, 2), high: round(ci.high, 2), level: ci.level },
    verdict: gap,
    text: gap === "NO MEASURABLE GAP" ? `${who}: no measurable gap (${round(ratio, 2)}×, interval ${round(ci.low, 2)}–${round(ci.high, 2)}× includes 1; n = ${gh.length}/${rh.length}).` : `${who} resolve ${gap === "SLOWER" ? `${round(ratio, 2)}× slower` : `faster (${round(ratio, 2)}× the time)`} than the rest (interval ${round(ci.low, 2)}–${round(ci.high, 2)}×, n = ${gh.length}/${rh.length}).${cause}`,
    kind: gap === "NO MEASURABLE GAP" ? "ACTUAL DATA" : "AI DETECTED PATTERN"
  };
}

/** Pure: every group in every dimension. */
export function equityReport(rows) {
  const dims = [
    ["channel", (c) => c.channel],
    ["hostel", (c) => c.hostel],
    ["year", (c) => (c.year ? `Year ${c.year}` : null)]
  ];
  const out = [];
  for (const [dimension, key] of dims) {
    const values = [...new Set(rows.map(key).filter(Boolean))];
    if (values.length < 2) continue;
    for (const v of values) out.push(compareGroup(rows.filter((c) => key(c) === v), rows.filter((c) => key(c) !== v), { label: v, dimension }));
  }
  const flagged = out.filter((g) => g.verdict === "SLOWER" || g.verdict === "FASTER");
  return { groups: out, flagged };
}

export async function serviceEquity({ days = 365, now = new Date() } = {}) {
  const [complaints, people] = await Promise.all([
    Complaint.find({ createdAt: { $gte: new Date(now - days * DAY) } }).select("channel student status createdAt resolution location description evidence").lean(),
    everyoneWithProfiles({ roles: ["STUDENT"] })
  ]);
  const who = new Map(people.map((p) => [String(p.user._id), p]));
  const rows = complaints.map((c) => {
    const p = who.get(String(c.student));
    const resolved = c.status === "RESOLVED" && c.resolution?.resolvedAt;
    return { channel: c.channel || "APP", hostel: p?.user.hostelName || null, year: p?.profile.year || null, hours: resolved ? (new Date(c.resolution.resolvedAt) - new Date(c.createdAt)) / HOUR : null, complete: completeness(c) };
  });
  const report = equityReport(rows);
  const channel = report.groups.filter((g) => g.dimension === "channel");
  return {
    windowDays: days,
    complaints: rows.length,
    ...report,
    headline: report.flagged[0]?.text || (report.groups.length ? "No measurable gap between channels, hostels or years at the 90% level." : "Insufficient data."),
    channel,
    rule: `A gap is flagged only when the 90% bootstrap interval of the median-time ratio excludes 1 and both sides have ${MIN_GROUP}+ resolved complaints.`,
    method: "MEDIAN_RATIO + SEEDED_BOOTSTRAP (1,000 resamples)",
    kind: "ACTUAL DATA"
  };
}
