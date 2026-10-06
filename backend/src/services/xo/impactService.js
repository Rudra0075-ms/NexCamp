import { Building } from "../../models/Building.js";
import { Complaint } from "../../models/Complaint.js";
import { round } from "../../utils/text.js";
import { falseClosures } from "./closureService.js";
import { median } from "./responseStats.js";

/**
 * "You Said, We Did", measured (Phase 3, page 20). For each recurring issue —
 * the same building and category resolved at least three times in a year —
 * the most recent fix that is at least a week old is the dividing line, and
 * the eight weeks either side of it are compared:
 *   complaints per week, median time to fix, and reopen rate.
 * ACTUAL DATA from the complaint records; "Insufficient data" where a window
 * holds too little to compare.
 */

const WINDOW_DAYS = 56;
const MIN_AFTER_DAYS = 7;

/** Pure: one side of the comparison. */
export function windowStats(complaints, flaggedIds, from, to) {
  const days = Math.max(0, (to - from) / 864e5);
  const filed = complaints.filter((c) => new Date(c.createdAt) >= from && new Date(c.createdAt) < to);
  const resolved = filed.filter((c) => c.resolution?.resolvedAt);
  const hours = resolved.map((c) => (new Date(c.resolution.resolvedAt) - new Date(c.createdAt)) / 3600000);
  const reopened = resolved.filter((c) => flaggedIds.has(String(c._id))).length;
  return {
    days: round(days, 1),
    complaints: filed.length,
    perWeek: days >= MIN_AFTER_DAYS ? round(filed.length / (days / 7), 2) : null,
    medianHoursToFix: hours.length ? round(median(hours), 1) : null,
    reopenRatePct: resolved.length ? round((reopened / resolved.length) * 100, 1) : null,
    resolved: resolved.length
  };
}

export async function boardImpact({ hostel, now = new Date() } = {}) {
  const buildings = await Building.find().select("code name").lean();
  const target = hostel ? buildings.find((b) => b.code === String(hostel).toUpperCase() || b.name === String(hostel).toUpperCase()) : null;
  const since = new Date(now - 365 * 864e5);
  const [complaints, closures] = await Promise.all([
    Complaint.find({ createdAt: { $gte: since }, ...(target ? { building: target._id } : {}) }).select("building category createdAt status resolution").lean(),
    falseClosures({ days: 365, now })
  ]);
  const flagged = new Set(closures.flags.map((f) => f.complaintId));
  const byName = new Map(buildings.map((b) => [String(b._id), b]));
  const groups = new Map();
  for (const c of complaints) {
    if (!c.building) continue;
    const key = `${c.building}|${c.category}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const issues = [];
  for (const [key, list] of groups) {
    const resolved = list.filter((c) => c.status === "RESOLVED" && c.resolution?.resolvedAt);
    if (resolved.length < 3) continue;
    const fix = resolved.filter((c) => now - new Date(c.resolution.resolvedAt) >= MIN_AFTER_DAYS * 864e5).sort((a, b) => new Date(b.resolution.resolvedAt) - new Date(a.resolution.resolvedAt))[0];
    if (!fix) continue;
    const fixAt = new Date(fix.resolution.resolvedAt);
    const before = windowStats(list, flagged, new Date(fixAt - WINDOW_DAYS * 864e5), fixAt);
    const after = windowStats(list, flagged, fixAt, new Date(Math.min(now, fixAt.getTime() + WINDOW_DAYS * 864e5)));
    const [buildingId, category] = key.split("|");
    const b = byName.get(buildingId);
    const enough = after.days >= MIN_AFTER_DAYS && before.complaints + after.complaints >= 3 && before.perWeek !== null;
    const change = enough ? (before.perWeek ? round(((after.perWeek - before.perWeek) / before.perWeek) * 100) : after.perWeek > 0 ? 100 : 0) : null;
    issues.push({
      building: b?.name || "Campus",
      code: b?.code,
      category,
      fixAt,
      fix: fix.resolution.resolutionDescription || "Resolved",
      resolvedTimes: resolved.length,
      before,
      after,
      changePct: change,
      verdict: !enough ? "Insufficient data — fewer than 3 reports around the fix, or the fix is too recent to judge." : change <= -30 ? "Fewer reports since the fix." : change >= 30 ? "More reports since the fix — the fix did not hold." : "About the same since the fix.",
      kind: enough ? "ACTUAL DATA" : "INSUFFICIENT DATA"
    });
  }
  return {
    issues: issues.sort((a, b) => b.resolvedTimes - a.resolvedTimes),
    window: { weeks: WINDOW_DAYS / 7, minAfterDays: MIN_AFTER_DAYS },
    method: "BEFORE_AFTER_THE_LATEST_FIX",
    note: `Eight weeks either side of the most recent fix that is at least a week old. Reopen rate uses the false-closure rule (a "Not fixed" answer, or the same room or asset reported again within 7 days).`,
    kind: "ACTUAL DATA"
  };
}
