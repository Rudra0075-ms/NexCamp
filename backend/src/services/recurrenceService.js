import { Complaint } from "../models/Complaint.js";
import { round, similarity } from "../utils/text.js";

/**
 * Recurring problem detection.
 *
 * Groups real complaint rows by (building, category) and reports the groups
 * that genuinely repeat. Every number below is counted from the rows handed in
 * — nothing is estimated, and a group that does not clear the thresholds is
 * simply not reported rather than being reported weakly.
 *
 * detectRecurring() is pure so it can be tested without a database;
 * findRecurring() is the thin query around it.
 */

// A pattern has to be more than one person having a bad day.
const MIN_OCCURRENCES = 3;
// …and more than one day, or it is one event being reported many times.
const MIN_DISTINCT_DAYS = 2;

const dayKey = (date) => new Date(date).toISOString().slice(0, 10);

/**
 * @param {Array} rows  complaint rows: { reference, title, description, category,
 *                      createdAt, status, building:{code,name}, location }
 * @param {object} options
 * @param {number} options.windowDays  the period the rows were selected over
 */
export function detectRecurring(rows = [], { windowDays = 30, minOccurrences = MIN_OCCURRENCES } = {}) {
  const groups = new Map();

  for (const row of rows) {
    const buildingCode = row.building?.code || "UNASSIGNED";
    const key = `${buildingCode}::${row.category || "OTHER"}`;
    const entry = groups.get(key) || {
      key,
      buildingCode,
      buildingName: row.building?.name || "Unassigned location",
      category: row.category || "OTHER",
      rows: []
    };
    entry.rows.push(row);
    groups.set(key, entry);
  }

  const patterns = [];

  for (const group of groups.values()) {
    if (group.rows.length < minOccurrences) continue;

    const days = new Set(group.rows.map((row) => dayKey(row.createdAt)));
    if (days.size < MIN_DISTINCT_DAYS) continue;

    const sorted = [...group.rows].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const first = new Date(sorted[0].createdAt);
    const last = new Date(sorted[sorted.length - 1].createdAt);
    const spanDays = Math.max(1, round((last - first) / 864e5, 1));

    // How alike the wording actually is, averaged over every pair. This is the
    // same Jaccard overlap the classifier uses — keyword overlap, not embeddings.
    const texts = sorted.map((row) => `${row.title} ${row.description}`);
    let pairs = 0;
    let overlapTotal = 0;
    for (let i = 0; i < texts.length; i += 1) {
      for (let j = i + 1; j < texts.length; j += 1) {
        overlapTotal += similarity(texts[i], texts[j]);
        pairs += 1;
      }
    }
    const textSimilarity = pairs ? round((overlapTotal / pairs) * 100) : 0;

    // Locations inside the building — "B-214", "floor 2" — that show up twice.
    const locationCounts = new Map();
    for (const row of sorted) {
      const spot = (row.location || "").trim();
      if (!spot) continue;
      locationCounts.set(spot, (locationCounts.get(spot) || 0) + 1);
    }
    const repeatedLocations = [...locationCounts.entries()]
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ location: name, occurrences: count }));

    const unresolved = sorted.filter((row) => row.status !== "RESOLVED").length;
    const departments = [...new Set(sorted.map((row) => row.department).filter(Boolean))];

    patterns.push({
      key: group.key,
      building: { code: group.buildingCode, name: group.buildingName },
      category: group.category,
      occurrences: sorted.length,
      distinctDays: days.size,
      periodDays: windowDays,
      spanDays,
      firstSeen: first,
      lastSeen: last,
      // Complaints per day across the period the rows actually cover.
      ratePerDay: round(sorted.length / Math.max(1, spanDays), 2),
      textSimilarity,
      repeatedLocations,
      unresolved,
      departments,
      references: sorted.map((row) => row.reference).filter(Boolean),
      sampleTitles: [...new Set(sorted.map((row) => row.title))].slice(0, 4),
      method: "DATABASE_AGGREGATION"
    });
  }

  return patterns.sort((a, b) => b.occurrences - a.occurrences || b.textSimilarity - a.textSimilarity);
}

/** The observable facts a recurring pattern supports, stated as evidence lines. */
export function evidenceFor(pattern) {
  const lines = [
    `${pattern.occurrences} complaints in ${pattern.building.name}, category ${pattern.category}, over the last ${pattern.periodDays} days.`,
    `Filed on ${pattern.distinctDays} separate days, spanning ${pattern.spanDays} days from ${new Date(pattern.firstSeen).toISOString().slice(0, 10)} to ${new Date(pattern.lastSeen).toISOString().slice(0, 10)}.`,
    `Average wording overlap between these complaints is ${pattern.textSimilarity}% (keyword overlap, not semantic embedding).`
  ];
  if (pattern.repeatedLocations.length) {
    const top = pattern.repeatedLocations[0];
    lines.push(`${top.location} appears in ${top.occurrences} of them.`);
  }
  if (pattern.unresolved) {
    lines.push(`${pattern.unresolved} of the ${pattern.occurrences} are still unresolved.`);
  }
  return lines;
}

/** Loads the window from the database and runs the detector over it. */
export async function findRecurring({ windowDays = 30, limit = 8, buildingId = null } = {}) {
  const since = new Date(Date.now() - windowDays * 864e5);
  const filter = { createdAt: { $gte: since } };
  if (buildingId) filter.building = buildingId;

  const rows = await Complaint.find(filter)
    .populate("building", "code name")
    .select("reference title description category location status department createdAt building")
    .sort({ createdAt: 1 })
    .limit(600)
    .lean();

  const patterns = detectRecurring(rows, { windowDays });

  return {
    windowDays,
    complaintsExamined: rows.length,
    patterns: patterns.slice(0, limit).map((pattern) => ({ ...pattern, evidence: evidenceFor(pattern) })),
    method: "DATABASE_AGGREGATION",
    disclaimer:
      "Counted directly from complaint records in the selected window. Nothing here is estimated or modelled."
  };
}

export const RECURRENCE_THRESHOLDS = { minOccurrences: MIN_OCCURRENCES, minDistinctDays: MIN_DISTINCT_DAYS };
