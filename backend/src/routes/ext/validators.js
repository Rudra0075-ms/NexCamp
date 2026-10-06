import { CATEGORIES } from "../../config/constants.js";
import { DOCUMENT_TYPES } from "../../models/ext/DocumentRequest.js";
import { NOTICE_PRIORITIES } from "../../models/ext/Notice.js";
import { CLASS_CHANGE_TYPES } from "../../models/ext/ClassChange.js";
import { arrayOf, boolean, isoDate, number, objectId, oneOf, optional, required, schema, string } from "../../validations/rules.js";

/**
 * Request schemas for the extension routes. Built on the project's own tiny
 * schema runner (validations/rules.js) so errors look exactly like the
 * existing API's.
 */

const plainObject = (value, field) =>
  value && typeof value === "object" && !Array.isArray(value) ? { value } : { error: `${field} must be an object` };

const audienceShape = (value, field) => {
  const base = plainObject(value, field);
  if (base.error) return base;
  const allowed = ["branches", "years", "hostels", "batches", "sections", "roles", "departments", "users"];
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) return { error: `${field}.${key} is not a recognised audience filter` };
    if (!Array.isArray(value[key])) return { error: `${field}.${key} must be a list` };
    if (value[key].length > 50) return { error: `${field}.${key} may hold at most 50 entries` };
  }
  return { value };
};

const actionShape = (value, field) => {
  const base = plainObject(value, field);
  if (base.error) return base;
  const label = typeof value.label === "string" ? value.label.trim().slice(0, 80) : "";
  if (!label) return { value: undefined };
  let deadline;
  if (value.deadline) {
    deadline = new Date(value.deadline);
    if (Number.isNaN(deadline.getTime())) return { error: `${field}.deadline must be a valid date` };
  }
  return { value: { label, deadline } };
};

const hhmm = (value, field) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value)) ? { value: String(value) } : { error: `${field} must be HH:MM` });
const dateKey = (value, field) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? { value: String(value) } : { error: `${field} must be YYYY-MM-DD` });

export const noticeCreateSchema = schema({
  title: [required, string(160)],
  body: [required, string(2000)],
  priority: [optional, oneOf(NOTICE_PRIORITIES)],
  audience: [optional, audienceShape],
  actionRequired: [optional, actionShape],
  scheduledFor: [optional, isoDate],
  escalateAfterHours: [optional, number(0.05, 168)],
  confirmDuplicate: [optional, boolean]
});

export const noticePreviewSchema = schema({
  title: [optional, string(160)],
  body: [optional, string(2000)],
  audience: [optional, audienceShape]
});

export const reasonSchema = schema({ reason: [optional, string(400)] });
export const requiredReasonSchema = schema({ reason: [required, string(400)] });

export const documentCreateSchema = schema({
  type: [required, oneOf(DOCUMENT_TYPES)],
  purpose: [required, string(300)]
});

export const documentReviewSchema = schema({
  decision: [required, oneOf(["START_REVIEW", "APPROVE", "REJECT"])],
  reason: [optional, string(400)]
});

export const verifyCopySchema = schema({ content: [required, string(4000)] });

export const classChangeSchema = schema({
  scheduleId: [required, objectId],
  sessionDate: [required, dateKey],
  type: [required, oneOf(CLASS_CHANGE_TYPES)],
  newDate: [optional, dateKey],
  newStartTime: [optional, hhmm],
  newRoom: [optional, string(40)],
  reason: [optional, string(300)]
});

export const menuChangeSchema = schema({
  date: [required, dateKey],
  meal: [required, oneOf(["BREAKFAST", "LUNCH", "SNACKS", "DINNER"])],
  items: [required, arrayOf(string(80), 12)],
  reason: [optional, string(300)],
  hostels: [optional, arrayOf(string(40), 10)]
});

export const askSchema = schema({ question: [required, string(300)] });

export const dayQuerySchema = schema({
  day: [optional, string(12)],
  subject: [optional, string(60)]
});

export const pendingQuerySchema = schema({
  department: [optional, string(80)],
  staff: [optional, string(120)],
  kind: [optional, oneOf(["complaint", "gatepass", "document", "reopen"])],
  lite: [optional, string(5)]
});

export { CATEGORIES };
