import { Complaint } from "../models/Complaint.js";
import { round, similarity, tokenize } from "../utils/text.js";
import { quantile } from "./operationsIntelligenceService.js";

/**
 * Feature 16 (resolution learning) and Feature 17 (feedback intelligence).
 *
 * Both read only real, stored history: complaints that staff actually resolved,
 * and ratings that students actually left. When there is none, they say so —
 * no precedent and no feedback is ever synthesised to fill a panel.
 */

// ---------------------------------------------------------------------------
// Sentiment — a small, explicit lexicon
// ---------------------------------------------------------------------------

const POSITIVE = new Set([
  "good", "great", "quick", "quickly", "fast", "fixed", "resolved", "thanks", "thank", "helpful",
  "excellent", "satisfied", "happy", "prompt", "working", "clean", "polite", "appreciate", "smooth", "perfect"
]);
const NEGATIVE = new Set([
  "bad", "slow", "late", "delay", "delayed", "again", "still", "broken", "worse", "poor", "rude",
  "dirty", "useless", "ignored", "never", "unresolved", "waiting", "terrible", "unhappy", "disappointed", "recurring"
]);
const NEGATORS = new Set(["not", "no", "never", "didn't", "dont", "don't", "isn't", "wasn't"]);
const SUGGESTION_CUES = ["should", "suggest", "please", "could", "would be better", "need to", "recommend", "instead"];

/**
 * Lexicon sentiment of one comment, blended with the star rating the student
 * gave. Deterministic and labelled as such — it is not a model's judgement.
 */
export function sentimentOf(comment, rating) {
  const words = String(comment || "").toLowerCase().replace(/[^a-z'\s]/g, " ").split(/\s+/).filter(Boolean);
  let score = 0;
  const matched = [];
  words.forEach((word, i) => {
    const negated = NEGATORS.has(words[i - 1]);
    if (POSITIVE.has(word)) {
      score += negated ? -1 : 1;
      matched.push(negated ? `not ${word}` : word);
    } else if (NEGATIVE.has(word)) {
      score += negated ? 0.5 : -1;
      matched.push(negated ? `not ${word}` : word);
    }
  });

  // The rating is the student's own explicit verdict, so it anchors the label;
  // the text can only move it one step.
  const ratingScore = Number.isFinite(rating) ? rating - 3 : 0;
  const combined = ratingScore + Math.max(-1, Math.min(1, score / 2));
  const label = combined >= 1 ? "POSITIVE" : combined <= -1 ? "NEGATIVE" : "NEUTRAL";
  return { label, score: round(combined, 2), matchedTerms: matched, method: "LEXICON + STAR_RATING" };
}

export function isSuggestion(comment) {
  const text = String(comment || "").toLowerCase();
  return SUGGESTION_CUES.some((cue) => text.includes(cue));
}

/** Words that recur across several comments. Pure. */
export function repeatedTerms(comments, { minCount = 2, limit = 8 } = {}) {
  const counts = new Map();
  for (const comment of comments) {
    for (const word of new Set(tokenize(comment))) counts.set(word, (counts.get(word) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, n]) => n >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}

// ---------------------------------------------------------------------------
// Feature 17 · feedback intelligence
// ---------------------------------------------------------------------------

export function summariseFeedback(rows) {
  if (!rows.length) {
    return {
      available: false,
      total: 0,
      note: "No student has rated a resolved complaint yet. Feedback appears here once students rate their resolved reports."
    };
  }

  const ratings = rows.map((row) => row.feedback.rating);
  const distribution = [1, 2, 3, 4, 5].map((stars) => ({ stars, count: ratings.filter((r) => r === stars).length }));
  const sentiments = rows.map((row) => ({ row, sentiment: sentimentOf(row.feedback.comment, row.feedback.rating) }));
  const bySentiment = sentiments.reduce((acc, { sentiment }) => ({ ...acc, [sentiment.label]: (acc[sentiment.label] || 0) + 1 }), {});

  const groupBy = (keyOf) =>
    Object.values(
      rows.reduce((acc, row) => {
        const key = keyOf(row) || "UNASSIGNED";
        acc[key] ||= { key, ratings: [] };
        acc[key].ratings.push(row.feedback.rating);
        return acc;
      }, {})
    )
      .map((group) => ({ key: group.key, count: group.ratings.length, averageRating: round(group.ratings.reduce((a, b) => a + b, 0) / group.ratings.length, 2) }))
      .sort((a, b) => a.averageRating - b.averageRating);

  const lowRated = sentiments.filter(({ row }) => row.feedback.rating <= 2);
  const comments = rows.map((row) => row.feedback.comment).filter(Boolean);

  const record = ({ row, sentiment }) => ({
    id: String(row._id),
    reference: row.reference,
    title: row.title,
    category: row.category,
    department: row.department || null,
    rating: row.feedback.rating,
    comment: row.feedback.comment || null,
    sentiment: sentiment.label,
    submittedAt: row.feedback.submittedAt
  });

  return {
    available: true,
    total: rows.length,
    averageRating: round(ratings.reduce((a, b) => a + b, 0) / ratings.length, 2),
    distribution,
    sentiment: { POSITIVE: 0, NEUTRAL: 0, NEGATIVE: 0, ...bySentiment },
    byCategory: groupBy((row) => row.category),
    byDepartment: groupBy((row) => row.department),
    repeatedIssues: repeatedTerms(lowRated.map(({ row }) => row.feedback.comment).filter(Boolean)),
    repeatedTerms: repeatedTerms(comments),
    suggestions: sentiments.filter(({ row }) => isSuggestion(row.feedback.comment)).slice(0, 8).map(record),
    lowRated: lowRated.slice(0, 8).map(record),
    recent: sentiments.slice(0, 10).map(record)
  };
}

export async function feedbackAnalysis() {
  const rows = await Complaint.find({ "feedback.rating": { $exists: true } })
    .select("reference title category department feedback resolution.resolutionTimeHours")
    .sort({ "feedback.submittedAt": -1 })
    .limit(500)
    .lean();
  return {
    ...summariseFeedback(rows),
    method: "LEXICON_SENTIMENT + DATABASE_AGGREGATION",
    disclaimer:
      "Sentiment is a word-list score anchored to the student's own star rating, not a model's reading. " +
      "Every figure is counted from ratings students submitted."
  };
}

// ---------------------------------------------------------------------------
// Feature 16 · resolution learning loop
// ---------------------------------------------------------------------------

/**
 * Ranks resolved complaints by how well their resolution is likely to apply to
 * `complaint`. Pure. Text similarity dominates; the same building and a good
 * student rating move a precedent up.
 */
export function rankPrecedents(complaint, resolved, { limit = 3 } = {}) {
  const text = `${complaint.title} ${complaint.description}`;
  return resolved
    .filter((row) => String(row._id) !== String(complaint._id))
    .map((row) => {
      const textScore = similarity(text, `${row.title} ${row.description}`);
      const sameBuilding = complaint.building && row.building && String(complaint.building) === String(row.building) ? 0.1 : 0;
      const rating = row.feedback?.rating;
      const ratingBonus = Number.isFinite(rating) ? ((rating - 3) / 2) * 0.1 : 0;
      return { row, textScore, score: textScore * 0.8 + sameBuilding + ratingBonus };
    })
    .filter((entry) => entry.textScore > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ row, textScore, score }) => ({
      id: String(row._id),
      reference: row.reference,
      title: row.title,
      department: row.department || null,
      resolution: row.resolution?.resolutionDescription,
      resolutionTimeHours: row.resolution?.resolutionTimeHours ?? null,
      resolvedAt: row.resolution?.resolvedAt || null,
      rating: Number.isFinite(row.feedback?.rating) ? row.feedback.rating : null,
      textSimilarity: round(textScore * 100),
      rankScore: round(score * 100)
    }));
}

export async function resolutionPrecedents(complaint) {
  const resolved = await Complaint.find({
    status: "RESOLVED",
    category: complaint.category,
    "resolution.resolutionDescription": { $exists: true, $nin: [null, ""] }
  })
    .select("reference title description building department resolution feedback")
    .sort({ "resolution.resolvedAt": -1 })
    .limit(300)
    .lean();

  const times = resolved.map((row) => row.resolution?.resolutionTimeHours).filter(Number.isFinite);
  return {
    category: complaint.category,
    resolvedInCategory: resolved.length,
    medianResolutionHours: times.length ? round(quantile(times, 0.5), 1) : null,
    precedents: rankPrecedents(complaint, resolved),
    method: "KEYWORD_SIMILARITY_OVER_RESOLVED_HISTORY",
    note: resolved.length
      ? null
      : `No ${complaint.category} complaint has been resolved with a written resolution yet, so there is no history to learn from.`
  };
}
