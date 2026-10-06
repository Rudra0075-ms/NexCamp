import mongoose from "mongoose";
import { Notice } from "../../models/ext/Notice.js";
import { NoticeReceipt } from "../../models/ext/NoticeReceipt.js";
import { nextReference } from "../../models/ext/common.js";
import { ApiError } from "../../utils/ApiError.js";
import { round, similarity, sharedTerms } from "../../utils/text.js";
import { maskPhone, sendSms } from "../smsService.js";
import { audit } from "./extAudit.js";
import { QUIET_HOURS, inQuietHours, istDateKey, nextDigestAt } from "./istTime.js";
import { everyoneWithProfiles } from "./profileService.js";
import { emitEvent } from "../xo/eventService.js"; // EXCEPTION-ONLY HOOK

/**
 * Notice Center — targeted notices with delivery, read and action tracking.
 *
 * Runs alongside the existing Notification inbox and never writes to it.
 * Every count this service reports is a count of NoticeReceipt rows.
 */

export const DUPLICATE_WINDOW_DAYS = 7;
export const DUPLICATE_THRESHOLD = 0.35;
const SMS_LIMIT = 160;

const upper = (v) => String(v || "").trim().toUpperCase();
const pct = (n, d) => (d ? round((n / d) * 100, 1) : null);

/** Cleans an audience filter. Empty lists mean "no restriction on this field". */
export function normaliseAudience(input = {}) {
  const list = (value, fn = upper) =>
    [...new Set((Array.isArray(value) ? value : value ? [value] : []).map(fn).filter((v) => v !== "" && v !== null && !Number.isNaN(v)))];
  const audience = {
    branches: list(input.branches),
    years: list(input.years, (v) => Number(v)).filter((v) => Number.isInteger(v) && v >= 1 && v <= 6),
    hostels: list(input.hostels),
    batches: list(input.batches, (v) => String(v).trim()),
    sections: list(input.sections),
    roles: list(input.roles),
    departments: list(input.departments, (v) => String(v).trim()),
    users: list(input.users, (v) => String(v).trim()).filter((v) => mongoose.Types.ObjectId.isValid(v))
  };
  // With no roles and no department, a notice is for students.
  if (!audience.roles.length && !audience.departments.length && !audience.users.length) audience.roles = ["STUDENT"];
  return audience;
}

const hostelMatches = (wanted, hostelName) => {
  const name = upper(hostelName);
  if (!name) return false;
  // "HOSTEL B" or its code "HST-B" or just "B".
  const letter = /HOSTEL\s+([A-Z0-9]+)/.exec(name)?.[1];
  return wanted.some((w) => w === name || (letter && (w === `HST-${letter}` || w === letter)));
};

/**
 * Pure: does this person fall inside the audience? Every restricted field must
 * match; a person without that field (staff have no branch) does not.
 */
export function matchesAudience({ user, profile }, audience) {
  if (audience.users?.length) return audience.users.includes(String(user._id));
  if (audience.departments?.length) {
    const inDept = audience.departments.includes(user.managedDepartment) || user.role === "ADMIN";
    if (!inDept) return false;
    if (audience.roles?.length && !audience.roles.includes(user.role) && user.role !== "ADMIN") return false;
    return true;
  }
  if (audience.roles?.length && !audience.roles.includes(user.role)) return false;
  if (audience.branches?.length && !audience.branches.includes(upper(profile.branch))) return false;
  if (audience.years?.length && !audience.years.includes(Number(profile.year))) return false;
  if (audience.batches?.length && !audience.batches.includes(String(profile.batch || ""))) return false;
  if (audience.sections?.length && !audience.sections.includes(upper(profile.section))) return false;
  if (audience.hostels?.length && !hostelMatches(audience.hostels, user.hostelName)) return false;
  return true;
}

export async function resolveAudience(audience) {
  const everyone = await everyoneWithProfiles();
  return everyone.filter((entry) => matchesAudience(entry, audience));
}

function tally(entries, key) {
  const out = {};
  for (const entry of entries) {
    const value = key(entry) ?? "—";
    out[value] = (out[value] || 0) + 1;
  }
  return Object.entries(out)
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
}

/** Live, server-computed reach for the composer. */
export async function reachPreview(rawAudience) {
  const audience = normaliseAudience(rawAudience);
  const everyone = await everyoneWithProfiles();
  const matched = everyone.filter((entry) => matchesAudience(entry, audience));
  const students = everyone.filter((e) => e.user.role === "STUDENT");
  const distinct = (fn) => [...new Set(students.map(fn).filter((v) => v !== null && v !== undefined && v !== ""))].sort();
  return {
    audience,
    count: matched.length,
    byHostel: tally(matched, (e) => e.user.hostelName),
    byBranch: tally(matched, (e) => e.profile.branch),
    byYear: tally(matched, (e) => e.profile.year),
    bySection: tally(matched, (e) => e.profile.section),
    options: {
      branches: distinct((e) => e.profile.branch),
      years: distinct((e) => e.profile.year),
      hostels: distinct((e) => e.user.hostelName),
      batches: distinct((e) => e.profile.batch),
      sections: distinct((e) => e.profile.section),
      roles: ["STUDENT", "WARDEN", "ADMIN", "FACILITY_MANAGER", "MESS_MANAGER"]
    },
    quietHours: quietHoursRule(),
    method: "DATABASE_FILTER",
    kind: "ACTUAL DATA"
  };
}

export function quietHoursRule() {
  return {
    start: QUIET_HOURS.start,
    end: QUIET_HOURS.end,
    digestAt: QUIET_HOURS.digestAt,
    timezone: "Asia/Kolkata",
    text: `Non-critical notices published between ${QUIET_HOURS.start} and ${QUIET_HOURS.end} IST are held and delivered together in one ${QUIET_HOURS.digestAt} morning digest. CRITICAL notices are never held.`
  };
}

/** Pure: what happens to a notice published at `now`. */
export function publishDecision({ priority, scheduledFor }, now = new Date()) {
  const when = scheduledFor ? new Date(scheduledFor) : null;
  if (when && when.getTime() > now.getTime() + 30000) return { status: "SCHEDULED", at: when };
  if (priority !== "CRITICAL" && inQuietHours(now)) return { status: "HELD_QUIET_HOURS", at: nextDigestAt(now) };
  return { status: "PUBLISHED", at: now };
}

/**
 * Duplicate warning: a notice in the last seven days whose wording overlaps
 * (Jaccard on content words) and whose recipients overlap this audience.
 */
export async function duplicateCheck({ title, body, audience }, { excludeId } = {}) {
  const since = new Date(Date.now() - DUPLICATE_WINDOW_DAYS * 864e5);
  const recent = await Notice.find({
    createdAt: { $gte: since },
    status: { $ne: "CANCELLED" },
    kind: { $ne: "DIGEST" },
    ...(excludeId ? { _id: { $ne: excludeId } } : {})
  })
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  const text = `${title || ""} ${body || ""}`;
  const candidates = recent
    .map((notice) => ({ notice, score: similarity(text, `${notice.title} ${notice.body}`) }))
    .filter((row) => row.score >= DUPLICATE_THRESHOLD);
  if (!candidates.length) return { duplicates: [], method: "WORD_OVERLAP_JACCARD", threshold: DUPLICATE_THRESHOLD };

  const everyone = await everyoneWithProfiles();
  const mine = new Set(everyone.filter((e) => matchesAudience(e, normaliseAudience(audience))).map((e) => String(e.user._id)));
  const duplicates = [];
  for (const { notice, score } of candidates) {
    const theirs = everyone.filter((e) => matchesAudience(e, normaliseAudience(notice.audience)));
    const overlap = theirs.filter((e) => mine.has(String(e.user._id))).length;
    if (overlap > 0) {
      duplicates.push({
        id: String(notice._id),
        reference: notice.reference,
        title: notice.title,
        publishedAt: notice.publishedAt || notice.createdAt,
        similarity: round(score * 100),
        sharedTerms: sharedTerms(text, `${notice.title} ${notice.body}`),
        overlappingRecipients: overlap
      });
    }
  }
  return {
    duplicates,
    method: "WORD_OVERLAP_JACCARD",
    threshold: DUPLICATE_THRESHOLD,
    note: "Word-overlap comparison with notices from the last 7 days whose recipients overlap. Not a semantic model."
  };
}

/** Creates the receipts and marks the notice published. */
export async function publish(notice, { now = new Date(), actor, digestBatch } = {}) {
  const recipients = await resolveAudience(normaliseAudience(notice.audience));
  if (recipients.length) {
    await NoticeReceipt.insertMany(
      recipients.map(({ user, profile }) => ({
        notice: notice._id,
        student: user._id,
        channel: "APP",
        snapshot: {
          hostel: user.hostelName || null,
          branch: profile.branch || null,
          year: profile.year || null,
          section: profile.section || null,
          role: user.role
        }
      })),
      { ordered: false }
    ).catch((error) => {
      if (error?.code !== 11000 && !error?.writeErrors) throw error;
    });
  }
  notice.status = "PUBLISHED";
  notice.publishedAt = now;
  notice.reach = recipients.length;
  if (digestBatch) notice.digestBatch = digestBatch;
  await audit(notice, {
    entityType: "Notice",
    action: digestBatch ? "NOTICE_RELEASED_IN_DIGEST" : "NOTICE_PUBLISHED",
    actor,
    field: "status",
    newValue: "PUBLISHED",
    note: `${recipients.length} recipient${recipients.length === 1 ? "" : "s"}${digestBatch ? ` · ${digestBatch}` : ""}`
  });
  await notice.save();
  // EXCEPTION-ONLY HOOK: campus event log (fire-and-forget — never blocks or fails this request).
  emitEvent({ type: "NOTICE_PUBLISHED", actor: actor || null, subjectType: "Notice", subjectId: notice._id, subjectRef: notice.reference, channel: actor ? "APP" : "SYSTEM", humanTouch: false, payload: { reach: recipients.length, priority: notice.priority, kind: notice.kind, digestBatch } });
  return notice;
}

/** POST a new notice: scheduled, held for quiet hours, or published now. */
export async function createNotice(input, actor, { now = new Date(), related, kind } = {}) {
  const audience = normaliseAudience(input.audience);
  const notice = new Notice({
    reference: await nextReference("NTC"),
    title: input.title,
    body: input.body,
    priority: input.priority || "NORMAL",
    kind: kind || input.kind || "GENERAL",
    audience,
    actionRequired: input.actionRequired?.label ? input.actionRequired : undefined,
    author: actor?._id,
    authorName: actor?.name || "system",
    authorRole: actor?.role || "SYSTEM",
    scheduledFor: input.scheduledFor || undefined,
    escalateAfterHours: input.escalateAfterHours || 6,
    related
  });
  let decision = publishDecision(notice, now);
  // EXCEPTION-ONLY HOOK: a transactional notice to one person (e.g. "your approval was undone") may skip the
  // quiet-hours hold when the caller says so explicitly. Nothing else changes the rule above.
  if (input.overrideQuietHours && decision.status === "HELD_QUIET_HOURS") decision = { status: "PUBLISHED", at: now, overridden: true };
  await audit(notice, {
    entityType: "Notice",
    action: "NOTICE_CREATED",
    actor,
    note: `${notice.priority} · ${decision.status}${decision.status !== "PUBLISHED" ? ` until ${decision.at.toISOString()}` : ""}`
  });
  if (decision.status === "PUBLISHED") return publish(notice, { now, actor });
  notice.status = decision.status;
  if (decision.status === "HELD_QUIET_HOURS") {
    notice.heldForQuietHours = true;
    notice.releaseAt = decision.at;
  }
  await notice.save();
  return notice;
}

// ---- background work (services/ext/extMonitor.js) --------------------------

export async function releaseScheduled(now = new Date()) {
  const due = await Notice.find({ status: "SCHEDULED", scheduledFor: { $lte: now } });
  for (const notice of due) {
    const decision = publishDecision({ priority: notice.priority }, now);
    if (decision.status === "HELD_QUIET_HOURS") {
      notice.status = "HELD_QUIET_HOURS";
      notice.heldForQuietHours = true;
      notice.releaseAt = decision.at;
      await audit(notice, { entityType: "Notice", action: "NOTICE_HELD_QUIET_HOURS", note: `release ${decision.at.toISOString()}` });
      await notice.save();
    } else {
      await publish(notice, { now });
    }
  }
  return due.length;
}

/** Releases every held notice due by `now` as one morning digest batch. */
export async function releaseDigest(now = new Date()) {
  const due = await Notice.find({ status: "HELD_QUIET_HOURS", releaseAt: { $lte: now } }).sort({ createdAt: 1 });
  if (!due.length) return 0;
  for (const notice of due) {
    // The batch is named after the 07:30 it was held for, and a sweep that
    // runs late (a restarted server) still dates the release to that digest.
    const at = notice.releaseAt && notice.releaseAt <= now ? notice.releaseAt : now;
    await publish(notice, { now: at, digestBatch: `DIGEST ${istDateKey(at)} ${QUIET_HOURS.digestAt}` });
  }
  return due.length;
}

export function smsText(notice) {
  const head = `[${notice.priority === "CRITICAL" ? "URGENT" : "NOTICE"} ${notice.reference}] `;
  const action = notice.actionRequired?.label ? ` Action: ${notice.actionRequired.label}.` : "";
  const text = `${head}${notice.title}.${action} Reply NOTICE to read.`;
  return text.length > SMS_LIMIT ? `${text.slice(0, SMS_LIMIT - 1)}…` : text;
}

/**
 * SMS escalation: a CRITICAL or action-required notice still unread after its
 * notice's `escalateAfterHours` goes out through the existing SMS provider.
 */
export async function escalateUnread(now = new Date(), { phoneFor } = {}) {
  const candidates = await Notice.find({
    status: "PUBLISHED",
    $or: [{ priority: "CRITICAL" }, { "actionRequired.label": { $exists: true, $ne: "" } }]
  });
  let sent = 0;
  for (const notice of candidates) {
    const dueAt = new Date(notice.publishedAt).getTime() + notice.escalateAfterHours * 3600000;
    if (dueAt > now.getTime()) continue;
    const receipts = await NoticeReceipt.find({ notice: notice._id, readAt: null, smsSentAt: null });
    if (!receipts.length) continue;
    let count = 0;
    for (const receipt of receipts) {
      const phone = phoneFor ? await phoneFor(receipt.student) : null;
      if (!phone) {
        receipt.smsError = "No registered phone";
        receipt.smsSentAt = now;
        await receipt.save();
        continue;
      }
      const delivery = await sendSms(phone, smsText(notice));
      receipt.channel = "SMS";
      receipt.smsSentAt = now;
      receipt.smsMode = delivery.mode;
      receipt.smsError = delivery.error;
      if (delivery.delivered && !receipt.deliveredAt) receipt.deliveredAt = now;
      await receipt.save();
      count += 1;
    }
    notice.escalatedAt = now;
    await audit(notice, {
      entityType: "Notice",
      action: "NOTICE_ESCALATED_SMS",
      channel: "SMS",
      note: `${count} unread recipient${count === 1 ? "" : "s"} sent an SMS after ${notice.escalateAfterHours}h`
    });
    // EXCEPTION-ONLY HOOK: campus event log (fire-and-forget — never blocks or fails this request).
    emitEvent({ type: "NOTICE_ESCALATED", actor: null, subjectType: "Notice", subjectId: notice._id, subjectRef: notice.reference, channel: "SMS", payload: { rung: "SMS", count } });
    await notice.save();
    sent += count;
  }
  return sent;
}

// ---- recipients -------------------------------------------------------------

function shapeForRecipient(receipt, notice) {
  return {
    id: String(notice._id),
    receiptId: String(receipt._id),
    reference: notice.reference,
    title: notice.title,
    body: notice.body,
    priority: notice.priority,
    kind: notice.kind,
    actionRequired: notice.actionRequired || null,
    publishedAt: notice.publishedAt,
    digestBatch: notice.digestBatch || null,
    authorName: notice.authorName,
    channel: receipt.channel,
    deliveredAt: receipt.deliveredAt,
    readAt: receipt.readAt || null,
    acknowledgedAt: receipt.acknowledgedAt || null,
    actionDoneAt: receipt.actionDoneAt || null,
    // EXCEPTION-ONLY HOOK: the recipient sees when a notice was replaced by a newer one.
    supersededBy: notice.supersededBy || null,
    supersedes: notice.supersedes || null
  };
}

/** The recipient's feed. Fetching it is what counts as in-app delivery. */
export async function feedFor(user, { channel = "APP", limit = 50 } = {}) {
  const receipts = await NoticeReceipt.find({ student: user._id }).sort({ createdAt: -1 }).limit(limit).populate("notice").lean();
  const live = receipts.filter((r) => r.notice && r.notice.status === "PUBLISHED");
  const undelivered = live.filter((r) => !r.deliveredAt).map((r) => r._id);
  const now = new Date();
  if (undelivered.length) {
    await NoticeReceipt.updateMany({ _id: { $in: undelivered } }, { $set: { deliveredAt: now } });
    // EXCEPTION-ONLY HOOK: campus event log (fire-and-forget — never blocks or fails this request).
    for (const r of live) if (!r.deliveredAt) emitEvent({ type: "NOTICE_DELIVERED", actor: user, student: user, subjectType: "Notice", subjectId: r.notice._id, subjectRef: r.notice.reference, channel, payload: { via: "FEED" } });
    for (const r of live) if (!r.deliveredAt) r.deliveredAt = now;
  }
  const notices = live.map((r) => shapeForRecipient(r, r.notice));
  return {
    notices,
    unread: notices.filter((n) => !n.readAt).length,
    actionsOpen: notices.filter((n) => n.actionRequired?.label && !n.actionDoneAt).length,
    channel,
    method: "DATABASE_RECORDS",
    kind: "ACTUAL DATA"
  };
}

const STEPS = { read: "readAt", ack: "acknowledgedAt", done: "actionDoneAt" };

/** Read / acknowledge / mark done. Later steps imply the earlier ones. */
export async function markReceipt(user, noticeId, step, { channel = "APP" } = {}) {
  if (!STEPS[step]) throw ApiError.badRequest("Unknown step");
  const receipt = await NoticeReceipt.findOne({ notice: noticeId, student: user._id }).populate("notice");
  if (!receipt || !receipt.notice) throw ApiError.notFound("This notice was not sent to you");
  if (step === "done" && !receipt.notice.actionRequired?.label) throw ApiError.badRequest("This notice has no action to complete");
  const now = new Date();
  if (!receipt.deliveredAt) receipt.deliveredAt = now;
  if (!receipt.readAt) receipt.readAt = now;
  if ((step === "ack" || step === "done") && !receipt.acknowledgedAt) receipt.acknowledgedAt = now;
  if (step === "done" && !receipt.actionDoneAt) receipt.actionDoneAt = now;
  if (channel !== "APP") receipt.channel = channel;
  await receipt.save();
  // EXCEPTION-ONLY HOOK: campus event log (fire-and-forget — never blocks or fails this request).
  emitEvent({ type: step === "done" ? "NOTICE_ACTED" : "NOTICE_READ", actor: user, student: user, subjectType: "Notice", subjectId: receipt.notice._id, subjectRef: receipt.notice.reference, channel, payload: { step } });
  return shapeForRecipient(receipt.toObject(), receipt.notice.toObject());
}

// ---- staff views ------------------------------------------------------------

function breakdown(receipts, field) {
  const groups = new Map();
  for (const r of receipts) {
    const key = r.snapshot?.[field] ?? "—";
    if (!groups.has(key)) groups.set(key, { value: key, targeted: 0, delivered: 0, read: 0, acknowledged: 0, actionDone: 0 });
    const g = groups.get(key);
    g.targeted += 1;
    if (r.deliveredAt) g.delivered += 1;
    if (r.readAt) g.read += 1;
    if (r.acknowledgedAt) g.acknowledged += 1;
    if (r.actionDoneAt) g.actionDone += 1;
  }
  return [...groups.values()]
    .map((g) => ({ ...g, readPct: pct(g.read, g.targeted), actionPct: pct(g.actionDone, g.targeted) }))
    .sort((a, b) => String(a.value).localeCompare(String(b.value)));
}

export function summarise(receipts) {
  const targeted = receipts.length;
  const count = (fn) => receipts.filter(fn).length;
  const delivered = count((r) => r.deliveredAt);
  const read = count((r) => r.readAt);
  const acknowledged = count((r) => r.acknowledgedAt);
  const actionDone = count((r) => r.actionDoneAt);
  const bySms = count((r) => r.channel === "SMS");
  return {
    targeted,
    delivered,
    read,
    acknowledged,
    actionDone,
    viaSms: bySms,
    pct: {
      delivered: pct(delivered, targeted),
      read: pct(read, targeted),
      acknowledged: pct(acknowledged, targeted),
      actionDone: pct(actionDone, targeted)
    }
  };
}

function shapeNotice(notice) {
  return {
    id: String(notice._id),
    reference: notice.reference,
    title: notice.title,
    body: notice.body,
    priority: notice.priority,
    kind: notice.kind,
    status: notice.status,
    audience: notice.audience,
    actionRequired: notice.actionRequired || null,
    authorName: notice.authorName,
    scheduledFor: notice.scheduledFor || null,
    releaseAt: notice.releaseAt || null,
    heldForQuietHours: notice.heldForQuietHours,
    publishedAt: notice.publishedAt || null,
    digestBatch: notice.digestBatch || null,
    escalateAfterHours: notice.escalateAfterHours,
    escalatedAt: notice.escalatedAt || null,
    reach: notice.reach,
    related: notice.related || null,
    createdAt: notice.createdAt
  };
}

export async function listForStaff({ limit = 30 } = {}) {
  const notices = await Notice.find().sort({ createdAt: -1 }).limit(limit).lean();
  const ids = notices.map((n) => n._id);
  const rows = await NoticeReceipt.aggregate([
    { $match: { notice: { $in: ids } } },
    {
      $group: {
        _id: "$notice",
        targeted: { $sum: 1 },
        delivered: { $sum: { $cond: [{ $ifNull: ["$deliveredAt", false] }, 1, 0] } },
        read: { $sum: { $cond: [{ $ifNull: ["$readAt", false] }, 1, 0] } },
        actionDone: { $sum: { $cond: [{ $ifNull: ["$actionDoneAt", false] }, 1, 0] } }
      }
    }
  ]);
  const byId = new Map(rows.map((r) => [String(r._id), r]));
  return {
    notices: notices.map((n) => {
      const r = byId.get(String(n._id)) || { targeted: 0, delivered: 0, read: 0, actionDone: 0 };
      return { ...shapeNotice(n), counts: { targeted: r.targeted, delivered: r.delivered, read: r.read, actionDone: r.actionDone, readPct: pct(r.read, r.targeted) } };
    }),
    quietHours: quietHoursRule(),
    method: "DATABASE_AGGREGATION",
    kind: "ACTUAL DATA"
  };
}

/** Delivery dashboard for one notice. */
export async function dashboard(noticeId) {
  const notice = await Notice.findById(noticeId).lean();
  if (!notice) throw ApiError.notFound("No notice with that id");
  const receipts = await NoticeReceipt.find({ notice: notice._id }).populate("student", "name studentId hostelName room role").lean();
  const person = (r) => ({
    name: r.student?.name,
    studentId: r.student?.studentId || null,
    hostel: r.snapshot?.hostel || null,
    section: r.snapshot?.section || null,
    channel: r.channel,
    smsSentAt: r.smsSentAt || null,
    smsMode: r.smsMode || null
  });
  return {
    notice: shapeNotice(notice),
    summary: summarise(receipts),
    byHostel: breakdown(receipts, "hostel"),
    byBranch: breakdown(receipts, "branch"),
    byYear: breakdown(receipts, "year"),
    notRead: receipts.filter((r) => !r.readAt).map(person),
    notActed: notice.actionRequired?.label ? receipts.filter((r) => !r.actionDoneAt).map(person) : [],
    history: notice.history || [],
    definitions: {
      delivered: "The notice reached the person: their app fetched it, an SMS was handed to the gateway, or it was shown at a kiosk.",
      read: "The person opened it or tapped Read.",
      acknowledged: "The person tapped Acknowledge (or Mark done).",
      actionDone: "The person tapped Mark done on an action-required notice."
    },
    smsNote: "SMS in development mode is written to the server log (smsMode: console) — nothing reaches a handset until a gateway is configured.",
    method: "DATABASE_RECORDS",
    kind: "ACTUAL DATA"
  };
}

export async function cancelNotice(noticeId, actor, reason) {
  const notice = await Notice.findById(noticeId);
  if (!notice) throw ApiError.notFound("No notice with that id");
  if (notice.status === "PUBLISHED") throw ApiError.badRequest("A published notice cannot be withdrawn; publish a correction instead");
  const previous = notice.status;
  notice.status = "CANCELLED";
  await audit(notice, { entityType: "Notice", action: "NOTICE_CANCELLED", actor, field: "status", previousValue: previous, newValue: "CANCELLED", note: reason });
  await notice.save();
  return shapeNotice(notice);
}

export { maskPhone };
