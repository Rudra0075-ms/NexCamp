const STOP_WORDS = new Set([
  "the", "a", "an", "in", "on", "at", "of", "for", "to", "is", "are", "was",
  "were", "and", "or", "but", "my", "our", "it", "this", "that", "there",
  "has", "have", "had", "not", "no", "since", "from", "with", "been", "be",
  "very", "please", "again", "still", "all", "any", "am", "pm"
]);

export function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

// Jaccard overlap on content words. Deterministic keyword matching, not
// semantic embedding — see services/README notes and the API's `method` field.
export function similarity(a, b) {
  const left = new Set(tokenize(a));
  const right = new Set(tokenize(b));
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  const union = left.size + right.size - shared;
  return union ? shared / union : 0;
}

export function sharedTerms(a, b, limit = 6) {
  const right = new Set(tokenize(b));
  const seen = new Set();
  const out = [];
  for (const word of tokenize(a)) {
    if (right.has(word) && !seen.has(word)) {
      seen.add(word);
      out.push(word);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function round(value, digits = 0) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

export function pct(value) {
  return `${round(value)}%`;
}
