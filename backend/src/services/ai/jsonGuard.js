/**
 * Validation for AI-produced structured output.
 *
 * Nothing a model returns is written to the database or rendered in the
 * interface until it has been through here. A model that invents a category,
 * a department that does not exist, a confidence of 400, or six paragraphs
 * where a sentence was asked for gets its value dropped — the caller then
 * keeps the deterministic value it already had.
 */

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/** One line of model prose, length-capped and stripped of control characters. */
export function safeText(value, { max = 240 } = {}) {
  if (typeof value !== "string") return null;
  const clean = value.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** A list of short strings. Anything that is not one is dropped, not coerced. */
export function safeTextList(value, { max = 240, limit = 6 } = {}) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => safeText(item, { max })).filter(Boolean).slice(0, limit);
}

/** Case-insensitive membership of a fixed vocabulary. Returns null on a miss. */
export function safeEnum(value, allowed) {
  if (typeof value !== "string") return null;
  const needle = value.trim().toUpperCase();
  const hit = allowed.find((option) => String(option).toUpperCase() === needle);
  return hit ?? null;
}

/** A number inside a range. Rejects NaN, Infinity and out-of-range values. */
export function safeNumber(value, { min = 0, max = 100, integer = true } = {}) {
  let num = value;
  if (typeof value === "string") {
    // Models write "94%" and "about 94". Pull the first number out, but reject
    // a string with no number in it rather than letting it collapse to 0.
    const match = /-?\d+(?:\.\d+)?/.exec(value);
    if (!match) return null;
    num = Number(match[0]);
  }
  if (typeof num !== "number" || !Number.isFinite(num)) return null;
  if (num < min || num > max) return null;
  return integer ? Math.round(num) : num;
}

export function safeBoolean(value) {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

/**
 * Applies a field spec to one model object.
 *
 * Returns { value, accepted, rejected } — `rejected` names every field the
 * model got wrong, which the AI status surface shows so a misbehaving model is
 * visible rather than silently papered over.
 */
export function guard(json, spec) {
  const value = {};
  const accepted = [];
  const rejected = [];

  for (const [field, rule] of Object.entries(spec)) {
    const raw = json?.[field];
    let out = null;

    if (rule.type === "enum") out = safeEnum(raw, rule.values);
    else if (rule.type === "number") out = safeNumber(raw, rule);
    else if (rule.type === "text") out = safeText(raw, rule);
    else if (rule.type === "list") out = safeTextList(raw, rule);
    else if (rule.type === "boolean") out = safeBoolean(raw);

    const empty = out === null || (Array.isArray(out) && out.length === 0);
    if (empty) {
      if (raw !== undefined) rejected.push(field);
      continue;
    }
    value[field] = out;
    accepted.push(field);
  }

  return { value, accepted, rejected };
}
