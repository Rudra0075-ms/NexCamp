import { Complaint } from "../../models/Complaint.js";
import { round } from "../../utils/text.js";

/**
 * Median response time, computed from resolved history (page 07, the admin
 * briefing and the investigation's confidence factor).
 *
 * The figure used to be a fixed 3.8 days. It is now the median number of days
 * from filing to resolution over resolved complaints — in the same category
 * when there are enough of them, campus-wide otherwise. With fewer than
 * MIN_SAMPLES resolved complaints the old 3.8 days is returned, labelled
 * ASSUMPTION, so a thin history never produces a confident-looking number.
 */

export const ASSUMED_MEDIAN_DAYS = 3.8;
export const MIN_SAMPLES = 5;

export function median(values) {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Pure: the verdict for a list of resolution durations (days). */
export function medianVerdict(categoryDays, campusDays, { category } = {}) {
  if (categoryDays.length >= MIN_SAMPLES) {
    return {
      days: round(median(categoryDays), 1),
      samples: categoryDays.length,
      scope: category ? `${category} complaints` : "resolved complaints",
      kind: "ACTUAL DATA",
      method: "MEDIAN_DAYS_FILED_TO_RESOLVED"
    };
  }
  if (campusDays.length >= MIN_SAMPLES) {
    return {
      days: round(median(campusDays), 1),
      samples: campusDays.length,
      scope: "all resolved complaints (too few in this category)",
      kind: "ACTUAL DATA",
      method: "MEDIAN_DAYS_FILED_TO_RESOLVED"
    };
  }
  return {
    days: ASSUMED_MEDIAN_DAYS,
    samples: campusDays.length,
    scope: "assumed",
    kind: "ASSUMPTION",
    method: "FIXED_ASSUMPTION",
    note: `Only ${campusDays.length} resolved complaint${campusDays.length === 1 ? "" : "s"} on record (need ${MIN_SAMPLES}) — using the assumed ${ASSUMED_MEDIAN_DAYS}-day median.`
  };
}

/** Median days from filing to resolution, from the database. Never throws. */
export async function medianResponseDays({ category } = {}) {
  try {
    const rows = await Complaint.find({ status: "RESOLVED", "resolution.resolvedAt": { $exists: true } })
      .select("category createdAt resolution.resolvedAt")
      .sort({ "resolution.resolvedAt": -1 })
      .limit(500)
      .lean();
    const days = (row) => (new Date(row.resolution.resolvedAt) - new Date(row.createdAt)) / 864e5;
    const all = rows.map(days).filter((d) => d >= 0);
    const same = category ? rows.filter((r) => r.category === category).map(days).filter((d) => d >= 0) : [];
    return medianVerdict(same, all, { category });
  } catch {
    return medianVerdict([], [], { category });
  }
}
