import mongoose from "mongoose";
import { STAFF_ROLES } from "../../config/constants.js";
import { AuditEntry } from "../../models/AuditEntry.js";
import { User } from "../../models/User.js";
import { CampusEvent, EVENT_CHANNELS, EVENT_TYPES } from "../../models/xo/CampusEvent.js";
import { profileFor } from "../ext/profileService.js";

/**
 * The Campus Event log's writer (Phase 1).
 *
 * emitEvent() is called from inside the existing controllers and services, one
 * line after the thing it records has been saved. It is fire-and-forget: it
 * returns immediately, never throws and never rejects, so an event that fails
 * to write can never fail or slow the request it describes. Failures are
 * logged. flushEvents() lets tests and scripts wait for pending writes.
 */

const pending = new Set();
let enabled = true;

/** Tests without a database can switch emission off entirely. */
export function setEventsEnabled(value) {
  enabled = Boolean(value);
}

const idOf = (value) => (value && typeof value === "object" ? value._id || value.id : value) || null;

/** Pure: is this actor's action a human touch? */
export function isHumanTouch({ actorRole, channel }) {
  return channel !== "POLICY" && STAFF_ROLES.includes(actorRole);
}

/** Pure: the event document, before the async enrichment (cohort, audit ref). */
export function buildEvent({ type, actor, subjectType, subjectId, subjectRef, student, channel = "APP", department, payload, at, humanTouch, origin = "LIVE" } = {}) {
  if (!EVENT_TYPES.includes(type)) throw new Error(`Unknown event type ${type}`);
  if (!subjectType || !subjectId) throw new Error("An event needs a subjectType and subjectId");
  const actorRole = actor?.role || "SYSTEM";
  const safeChannel = EVENT_CHANNELS.includes(channel) ? channel : "APP";
  return {
    type,
    actorId: mongoose.Types.ObjectId.isValid(String(idOf(actor) || "")) ? idOf(actor) : undefined,
    actorRole,
    actorName: actor?.name || (actorRole === "SYSTEM" ? "system" : undefined),
    subjectType,
    subjectId: String(subjectId),
    subjectRef: subjectRef || undefined,
    studentId: mongoose.Types.ObjectId.isValid(String(idOf(student) || "")) ? idOf(student) : undefined,
    channel: safeChannel,
    department: department || undefined,
    humanTouch: humanTouch ?? isHumanTouch({ actorRole, channel: safeChannel }),
    payload: payload && Object.keys(payload).length ? payload : undefined,
    at: at ? new Date(at) : new Date(),
    origin
  };
}

async function cohortFor(student) {
  const id = idOf(student);
  if (!id) return undefined;
  const user = student?.role ? student : await User.findById(id).select("name role studentId department semester hostelName room phone").lean();
  if (!user || user.role !== "STUDENT") return undefined;
  const profile = await profileFor(user);
  return { hostel: user.hostelName || undefined, branch: profile.branch || undefined, year: profile.year || undefined, section: profile.section || undefined };
}

async function write(draft, { auditEntityId } = {}) {
  const [cohort, audit] = await Promise.all([
    cohortFor(draft.studentId),
    AuditEntry.findOne({ entityId: String(auditEntityId || draft.subjectId) }).sort({ sequence: -1 }).select("sequence at").lean()
  ]);
  // Only an audit entry written around the same moment is the one this event mirrors.
  const auditRef = audit && Math.abs(new Date(audit.at) - draft.at) < 120000 ? `#${audit.sequence}` : undefined;
  return CampusEvent.create({ ...draft, cohort, auditRef });
}

/**
 * Records one event. Returns a promise that always resolves (to the stored
 * event, or null) — callers do not await it.
 */
export function emitEvent(input, options = {}) {
  if (!enabled || mongoose.connection.readyState !== 1) return Promise.resolve(null);
  let draft;
  try {
    draft = buildEvent(input);
  } catch (error) {
    console.error("eventService: event not recorded —", error.message);
    return Promise.resolve(null);
  }
  const job = write(draft, options)
    .catch((error) => {
      console.error(`eventService: could not record ${draft.type} —`, error.message);
      return null;
    })
    .finally(() => pending.delete(job));
  pending.add(job);
  return job;
}

/** Waits for every event emitted so far to be written (tests, scripts, the Tuesday Test). */
export async function flushEvents() {
  while (pending.size) await Promise.all([...pending]);
}

/** Recent events for one subject, oldest first. */
export async function eventsFor(subjectType, subjectId) {
  return CampusEvent.find({ subjectType, subjectId: String(subjectId) }).sort({ at: 1 }).lean();
}

/** Staff view: the latest events, filterable. */
export async function recentEvents({ type, subjectType, channel, limit = 50 } = {}) {
  const filter = {};
  if (type) filter.type = type;
  if (subjectType) filter.subjectType = subjectType;
  if (channel) filter.channel = channel;
  const rows = await CampusEvent.find(filter).sort({ at: -1 }).limit(Math.min(200, limit)).lean();
  const counts = await CampusEvent.aggregate([{ $group: { _id: { type: "$type", origin: "$origin" }, n: { $sum: 1 } } }]);
  return {
    events: rows.map((e) => ({ ...e, id: String(e._id), _id: undefined })),
    counts: counts.map((c) => ({ type: c._id.type, origin: c._id.origin, count: c.n })).sort((a, b) => b.count - a.count),
    method: "CAMPUS_EVENT_LOG",
    kind: "ACTUAL DATA"
  };
}
