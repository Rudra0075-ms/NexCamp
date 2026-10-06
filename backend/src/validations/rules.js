import mongoose from "mongoose";

// A tiny schema runner: each field is a list of check functions returning either
// a cleaned value or an error string. Enough for this API, and no extra deps.
export function schema(shape) {
  return (input) => {
    const value = {};
    const errors = {};
    for (const [field, checks] of Object.entries(shape)) {
      let current = input[field];
      for (const check of [].concat(checks)) {
        const result = check(current, field, input);
        if (result && result.error) {
          errors[field] = result.error;
          break;
        }
        if (result && "value" in result) current = result.value;
        if (result && result.stop) break;
      }
      if (!(field in errors) && current !== undefined) value[field] = current;
    }
    return { value, errors };
  };
}

export const optional = (value) =>
  value === undefined || value === null || value === "" ? { stop: true } : undefined;

export const required = (value, field) =>
  value === undefined || value === null || String(value).trim() === ""
    ? { error: `${field} is required` }
    : undefined;

export const string = (max = 500) => (value, field) => {
  if (typeof value !== "string") return { error: `${field} must be text` };
  const trimmed = value.trim();
  if (trimmed.length > max) return { error: `${field} must be at most ${max} characters` };
  return { value: trimmed };
};

export const minLength = (min) => (value, field) =>
  String(value).length < min ? { error: `${field} must be at least ${min} characters` } : undefined;

export const email = (value, field) => {
  const normalised = String(value).trim().toLowerCase();
  // Deliberately permissive: one @, a dot in the domain, no whitespace.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalised)) {
    return { error: `${field} must be a valid email address` };
  }
  return { value: normalised };
};

export const password = (value, field) => {
  const text = String(value);
  if (text.length < 8) return { error: `${field} must be at least 8 characters` };
  if (!/[A-Za-z]/.test(text) || !/[0-9]/.test(text)) {
    return { error: `${field} must contain both letters and numbers` };
  }
  return { value: text };
};

// Case-insensitive, and hands back the allowed value's own spelling — so a
// lowercase vocabulary (timeline kinds) validates as well as an uppercase one.
export const oneOf = (allowed) => (value, field) => {
  const upper = String(value).trim().toUpperCase();
  const match = allowed.find((entry) => String(entry).toUpperCase() === upper);
  if (match === undefined) {
    return { error: `${field} must be one of: ${allowed.join(", ")}` };
  }
  return { value: match };
};

export const number = (min, max) => (value, field) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return { error: `${field} must be a number` };
  if (min !== undefined && parsed < min) return { error: `${field} must be at least ${min}` };
  if (max !== undefined && parsed > max) return { error: `${field} must be at most ${max}` };
  return { value: parsed };
};

export const integer = (min, max) => (value, field) => {
  const result = number(min, max)(value, field);
  if (result?.error) return result;
  return { value: Math.trunc(result.value) };
};

export const boolean = (value) => ({ value: value === true || value === "true" });

export const objectId = (value, field) =>
  mongoose.Types.ObjectId.isValid(String(value))
    ? { value: String(value) }
    : { error: `${field} must be a valid id` };

export const isoDate = (value, field) => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return { error: `${field} must be a valid date` };
  return { value: parsed };
};

export const arrayOf = (check, max = 50) => (value, field) => {
  if (!Array.isArray(value)) return { error: `${field} must be a list` };
  if (value.length > max) return { error: `${field} may hold at most ${max} entries` };
  const out = [];
  for (const item of value) {
    const result = check(item, field);
    if (result?.error) return result;
    out.push(result && "value" in result ? result.value : item);
  }
  return { value: out };
};

// A fixed-length numeric string — one-time codes, kept as text so a leading
// zero survives the round trip.
export const digits = (min = 4, max = 8) => (value, field) => {
  const text = String(value).trim();
  if (!new RegExp(`^\\d{${min},${max}}$`).test(text)) {
    return { error: `${field} must be ${min === max ? min : `${min}–${max}`} digits` };
  }
  return { value: text };
};
