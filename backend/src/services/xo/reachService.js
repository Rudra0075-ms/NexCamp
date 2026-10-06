import { Notice } from "../../models/ext/Notice.js";
import { NoticeReceipt } from "../../models/ext/NoticeReceipt.js";
import { CohortContact } from "../../models/xo/CohortContact.js";
import { ApiError } from "../../utils/ApiError.js";
import { round } from "../../utils/text.js";
import { sendSms } from "../smsService.js";
import { audit } from "../ext/extAudit.js";
import { inQuietHours } from "../ext/istTime.js";
import { createNotice, duplicateCheck, normaliseAudience, publishDecision, reachPreview, smsText } from "../ext/noticeService.js";
import { profileFor } from "../ext/profileService.js";
import { emitEvent } from "./eventService.js";

/**
 * Guaranteed reach (Phase 5, page 13).
 *
 * A critical notice can carry a reach target (e.g. 100% of its audience) and a
 * deadline. A sweep — the same timer pattern the gate-pass monitor uses —
 * moves every recipient who has not read it up a ladder as the deadline
 * approaches:
 *     in-app (at publish) → SMS (25% of the window) → class representative's
 *     list (50%) → kiosk list at the help desk (75%)
 * Each step is recorded on the receipt, audited and emitted as an event, so the
 * reach funnel can say who was reached how, and who is still unreached.
 */

export const LADDER = [
  { rung: "IN_APP", at: 0, label: "In-app notice" },
  { rung: "SMS", at: 0.25, label: "SMS through the campus provider" },
  { rung: "CLASS_REP", at: 0.5, label: "Class representative's list" },
  { rung: "KIOSK", at: 0.75, label: "Kiosk list at the help desk (printable)" }
];

const SUPERSEDE_WORDS = /\b(revised|revision|updated|update|correction|corrected|postponed|rescheduled|changed|change of|cancelled|canceled|new time|instead|replaces)\b/i;

/** Pure: which rungs are due at `now` for a notice published at `from` with deadline `to`. */
export function dueRungs(from, to, now = new Date()) {
  const span = new Date(to) - new Date(from);
  if (!(span > 0)) return LADDER.map((l) => l.rung);
  const f = (new Date(now) - new Date(from)) / span;
  return LADDER.filter((l) => f >= l.at).map((l) => l.rung);
}

/** Pure: what the notice text says it is about (hostels, sections, years, branches). */
export function mentionedCohort(text, options = {}) {
  const t = String(text || "");
  const hostels = [...new Set([...t.matchAll(/\bhostel\s+([a-z])\b/gi)].map((m) => `HOSTEL ${m[1].toUpperCase()}`))];
  const sections = [...new Set([...t.matchAll(/\bsection\s+([a-z])\b/gi)].map((m) => m[1].toUpperCase()))];
  const years = [...new Set([...t.matchAll(/\b(?:year\s+(\d)|(\d)(?:st|nd|rd|th)\s+year)\b/gi)].map((m) => Number(m[1] || m[2])))];
  const branches = (options.branches || []).filter((b) => new RegExp(`\\b${b}\\b`, "i").test(t));
  return { hostels, sections, years, branches };
}

/** Pure: a warning when the audience is much broader than the cohort the text names. */
export function breadthWarning({ audienceCount, mentionedCount, mentioned }) {
  const named = [...mentioned.hostels, ...mentioned.sections.map((s) => `section ${s}`), ...mentioned.years.map((y) => `year ${y}`), ...mentioned.branches];
  if (!named.length || !mentionedCount || audienceCount <= mentionedCount * 1.5) return null;
  return {
    audienceCount,
    mentionedCount,
    named,
    text: `This goes to ${audienceCount} people, but the message is about ${named.join(", ")} (${mentionedCount} people). Narrow the audience so the others are not trained to ignore notices.`
  };
}

/** Composer check: quiet hours, duplicates / supersession, and breadth. Writes nothing. */
export async function hygiene({ title = "", body = "", audience = {}, priority = "NORMAL", scheduledFor } = {}, { now = new Date() } = {}) {
  const text = `${title} ${body}`;
  const [preview, dup] = await Promise.all([reachPreview(audience), title || body ? duplicateCheck({ title, body, audience }) : { duplicates: [] }]);
  const mentioned = mentionedCohort(text, preview.options);
  let mentionedCount = null;
  if (mentioned.hostels.length || mentioned.sections.length || mentioned.years.length || mentioned.branches.length) {
    mentionedCount = (await reachPreview({ hostels: mentioned.hostels, sections: mentioned.sections, years: mentioned.years, branches: mentioned.branches, roles: ["STUDENT"] })).count;
  }
  const decision = publishDecision({ priority, scheduledFor }, now);
  const candidate = dup.duplicates?.[0] && SUPERSEDE_WORDS.test(text) ? dup.duplicates[0] : null;
  return {
    quietHours: {
      held: decision.status === "HELD_QUIET_HOURS",
      releaseAt: decision.status === "HELD_QUIET_HOURS" ? decision.at : null,
      inQuietHours: inQuietHours(now),
      text: decision.status === "HELD_QUIET_HOURS" ? `Composed during quiet hours (22:00–07:00 IST) and not CRITICAL — it will be held for the morning digest at ${decision.at.toISOString()}. Override only if it cannot wait.` : null
    },
    duplicates: dup.duplicates || [],
    supersedes: candidate ? { id: candidate.id, reference: candidate.reference, title: candidate.title, text: `This replaces ${candidate.reference} (“${candidate.title}”) — ${candidate.similarity}% word overlap, ${candidate.overlappingRecipients} shared recipients. Mark it superseded so recipients see the change.` } : null,
    breadth: breadthWarning({ audienceCount: preview.count, mentionedCount, mentioned }),
    reach: preview.count,
    method: "RULE_BASED_NOTICE_HYGIENE",
    kind: "ACTUAL DATA"
  };
}

/** Creates a notice with a reach target, an optional supersession and an audited quiet-hours override. */
export async function createReachNotice(input, actor, { now = new Date() } = {}) {
  const dup = await duplicateCheck(input);
  const supersedesId = input.supersedes ? String(input.supersedes) : null;
  const dupOthers = (dup.duplicates || []).filter((d) => d.id !== supersedesId);
  if (dupOthers.length && !input.confirmDuplicate) throw new ApiError(409, "A similar notice went to an overlapping audience in the last 7 days. Mark it as superseded, or send again with confirmDuplicate: true.", dup);
  if (input.reachTarget && (!input.reachTarget.deadline || new Date(input.reachTarget.deadline) <= now)) throw ApiError.badRequest("A reach target needs a deadline in the future");
  const old = supersedesId ? await Notice.findById(supersedesId) : null;
  if (supersedesId && !old) throw ApiError.notFound("The notice to supersede was not found");
  const override = Boolean(input.overrideQuietHours);
  const notice = await createNotice({ ...input, overrideQuietHours: override }, actor, { now });
  const fresh = await Notice.findById(notice._id);
  if (input.reachTarget) fresh.reachTarget = { pct: Number(input.reachTarget.pct) || 100, deadline: new Date(input.reachTarget.deadline) };
  if (override && inQuietHours(now) && fresh.priority !== "CRITICAL") fresh.quietHoursOverride = { byName: actor.name, at: now, reason: input.overrideReason || "Could not wait for the morning digest" };
  if (old) fresh.supersedes = { id: String(old._id), reference: old.reference, title: old.title };
  await audit(fresh, { entityType: "Notice", action: "NOTICE_REACH_SETUP", actor, note: [fresh.reachTarget ? `reach ${fresh.reachTarget.pct}% by ${fresh.reachTarget.deadline.toISOString()}` : null, fresh.quietHoursOverride ? "quiet hours overridden" : null, old ? `supersedes ${old.reference}` : null].filter(Boolean).join(" · ") || "no reach settings" });
  await fresh.save();
  if (old) {
    old.supersededBy = { id: String(fresh._id), reference: fresh.reference, title: fresh.title, at: now };
    await audit(old, { entityType: "Notice", action: "NOTICE_SUPERSEDED", actor, note: `replaced by ${fresh.reference}` });
    await old.save();
  }
  return fresh;
}

// ---- the ladder --------------------------------------------------------------------------

async function repFor(profile) {
  if (!profile?.section) return null;
  return CohortContact.findOne({ branch: profile.branch, year: profile.year, section: profile.section, role: "CLASS_REP" }).populate("student", "name studentId").lean();
}

/** Moves unread recipients of reach-target notices up the ladder. Returns what it did. */
export async function reachSweep({ now = new Date(), phoneFor } = {}) {
  const notices = await Notice.find({ status: "PUBLISHED", "reachTarget.deadline": { $exists: true }, "reachTarget.reachedAt": { $exists: false } });
  const done = { notices: notices.length, sms: 0, classRep: 0, kiosk: 0, reached: 0 };
  for (const notice of notices) {
    const receipts = await NoticeReceipt.find({ notice: notice._id }).populate("student", "name role hostelName studentId department semester");
    const readPct = receipts.length ? (receipts.filter((r) => r.readAt).length / receipts.length) * 100 : 100;
    if (readPct >= notice.reachTarget.pct) {
      notice.reachTarget.reachedAt = now;
      notice.markModified("reachTarget");
      await audit(notice, { entityType: "Notice", action: "NOTICE_REACH_TARGET_MET", note: `${round(readPct)}% read (target ${notice.reachTarget.pct}%)` });
      await notice.save();
      done.reached += 1;
      continue;
    }
    const due = dueRungs(notice.publishedAt, notice.reachTarget.deadline, now);
    const moved = { SMS: 0, CLASS_REP: 0, KIOSK: 0 };
    for (const receipt of receipts.filter((r) => !r.readAt)) {
      const ladder = receipt.ladder || [];
      const has = (rung) => ladder.some((l) => l.rung === rung);
      if (!has("IN_APP")) ladder.push({ rung: "IN_APP", at: notice.publishedAt, note: receipt.deliveredAt ? "delivered to the app" : "not opened in the app" });
      if (due.includes("SMS") && !has("SMS")) {
        if (receipt.smsSentAt) ladder.push({ rung: "SMS", at: receipt.smsSentAt, note: `already sent by the CRITICAL escalation rule (${receipt.smsMode || "sms"})` });
        else {
          const phone = phoneFor ? await phoneFor(receipt.student._id) : null;
          if (phone) {
            const delivery = await sendSms(phone, smsText(notice));
            receipt.smsSentAt = now;
            receipt.smsMode = delivery.mode;
            receipt.smsError = delivery.error;
            receipt.channel = "SMS";
            if (delivery.delivered && !receipt.deliveredAt) receipt.deliveredAt = now;
            ladder.push({ rung: "SMS", at: now, note: `SMS ${delivery.mode}${delivery.error ? ` · ${delivery.error}` : ""}` });
          } else ladder.push({ rung: "SMS", at: now, note: "no registered phone — skipped to the next rung" });
          moved.SMS += 1;
        }
      }
      if (due.includes("CLASS_REP") && !has("CLASS_REP") && receipt.student?.role === "STUDENT") {
        const rep = await repFor(await profileFor(receipt.student));
        ladder.push({ rung: "CLASS_REP", at: now, note: rep ? `on ${rep.student?.name}'s class-rep list` : "no class representative recorded for this section" });
        moved.CLASS_REP += 1;
      }
      if (due.includes("KIOSK") && !has("KIOSK")) {
        ladder.push({ rung: "KIOSK", at: now, note: "on the help-desk kiosk list (page 12)" });
        moved.KIOSK += 1;
      }
      receipt.ladder = ladder;
      receipt.markModified("ladder");
      await receipt.save();
    }
    for (const [rung, n] of Object.entries(moved)) {
      if (!n) continue;
      await audit(notice, { entityType: "Notice", action: `NOTICE_LADDER_${rung}`, channel: rung === "SMS" ? "SMS" : undefined, note: `${n} unread recipient${n === 1 ? "" : "s"} moved to ${LADDER.find((l) => l.rung === rung).label}` });
      emitEvent({ type: "NOTICE_ESCALATED", actor: null, subjectType: "Notice", subjectId: notice._id, subjectRef: notice.reference, channel: rung === "SMS" ? "SMS" : rung === "KIOSK" ? "KIOSK" : "SYSTEM", payload: { rung, count: n } });
    }
    if (Object.values(moved).some(Boolean)) await notice.save();
    done.sms += moved.SMS;
    done.classRep += moved.CLASS_REP;
    done.kiosk += moved.KIOSK;
  }
  return done;
}

// ---- views ------------------------------------------------------------------------------------

/** Pure: the funnel counts from receipts. */
export function funnel(receipts) {
  const n = receipts.length;
  const pct = (x) => (n ? round((x / n) * 100, 1) : null);
  const delivered = receipts.filter((r) => r.deliveredAt).length;
  const read = receipts.filter((r) => r.readAt).length;
  const acted = receipts.filter((r) => r.actionDoneAt || r.acknowledgedAt).length;
  const unreached = n - read;
  return { targeted: n, delivered, read, acted, unreached, pct: { delivered: pct(delivered), read: pct(read), acted: pct(acted), unreached: pct(unreached) } };
}

export async function reachFunnel(noticeId) {
  const notice = await Notice.findById(noticeId).lean();
  if (!notice) throw ApiError.notFound("No notice with that id");
  const receipts = await NoticeReceipt.find({ notice: notice._id }).populate("student", "name studentId hostelName").lean();
  const f = funnel(receipts);
  const byRung = Object.fromEntries(LADDER.map((l) => [l.rung, receipts.filter((r) => (r.ladder || []).some((x) => x.rung === l.rung)).length]));
  const readVia = { APP: receipts.filter((r) => r.readAt && r.channel === "APP").length, SMS: receipts.filter((r) => r.readAt && r.channel === "SMS").length, KIOSK: receipts.filter((r) => r.readAt && r.channel === "KIOSK").length };
  return {
    notice: { id: String(notice._id), reference: notice.reference, title: notice.title, priority: notice.priority, publishedAt: notice.publishedAt, reachTarget: notice.reachTarget || null, supersedes: notice.supersedes || null, supersededBy: notice.supersededBy || null, quietHoursOverride: notice.quietHoursOverride || null },
    funnel: f,
    targetMet: notice.reachTarget ? (f.pct.read ?? 0) >= notice.reachTarget.pct : null,
    ladder: LADDER.map((l) => ({ ...l, recipients: byRung[l.rung] })),
    readVia,
    unreached: receipts
      .filter((r) => !r.readAt)
      .map((r) => ({ name: r.student?.name, studentId: r.student?.studentId || null, hostel: r.snapshot?.hostel || r.student?.hostelName || null, section: r.snapshot?.section || null, lastRung: (r.ladder || []).slice(-1)[0] || { rung: r.deliveredAt ? "IN_APP" : "NOT_DELIVERED", note: r.deliveredAt ? "delivered, not read" : "not delivered yet" }, ladder: r.ladder || [] })),
    dueNext: notice.reachTarget ? LADDER.filter((l) => !dueRungs(notice.publishedAt, notice.reachTarget.deadline).includes(l.rung)).map((l) => ({ rung: l.rung, at: new Date(new Date(notice.publishedAt).getTime() + l.at * (new Date(notice.reachTarget.deadline) - new Date(notice.publishedAt))) })) : [],
    method: "NOTICE_RECEIPTS_AND_LADDER",
    kind: "ACTUAL DATA"
  };
}

/** Page 12: students with unread CRITICAL notices, for the help-desk operator (printable). */
export async function kioskList() {
  const notices = await Notice.find({ status: "PUBLISHED", $or: [{ priority: "CRITICAL" }, { "reachTarget.deadline": { $exists: true } }] }).select("reference title priority publishedAt reachTarget").lean();
  const byId = new Map(notices.map((n) => [String(n._id), n]));
  const receipts = await NoticeReceipt.find({ notice: { $in: notices.map((n) => n._id) }, readAt: null }).populate("student", "name studentId hostelName room role").lean();
  const people = new Map();
  for (const r of receipts) {
    if (!r.student || r.student.role !== "STUDENT") continue;
    const key = String(r.student._id);
    if (!people.has(key)) people.set(key, { name: r.student.name, studentId: r.student.studentId, hostel: r.student.hostelName, room: r.student.room, notices: [] });
    const n = byId.get(String(r.notice));
    people.get(key).notices.push({ reference: n.reference, title: n.title, priority: n.priority, onKioskList: (r.ladder || []).some((l) => l.rung === "KIOSK") });
  }
  const rows = [...people.values()].sort((a, b) => b.notices.length - a.notices.length || String(a.name).localeCompare(String(b.name)));
  return { students: rows, notices: notices.length, generatedAt: new Date(), note: "Read the notice to the student at the desk and mark it read with them (channel KIOSK).", method: "UNREAD_CRITICAL_RECEIPTS", kind: "ACTUAL DATA" };
}

/** Page 13: the class representative's list — classmates who have not read a reach-target notice. */
export async function classRepList(user) {
  const rep = await CohortContact.findOne({ student: user._id, role: "CLASS_REP" }).lean();
  if (!rep) return { isRep: false };
  const receipts = await NoticeReceipt.find({ readAt: null, "ladder.rung": "CLASS_REP", "snapshot.section": rep.section, "snapshot.branch": rep.branch, "snapshot.year": rep.year })
    .populate("student", "name studentId room hostelName")
    .populate("notice", "reference title priority status")
    .lean();
  return {
    isRep: true,
    cohort: { branch: rep.branch, year: rep.year, section: rep.section },
    items: receipts.filter((r) => r.notice?.status === "PUBLISHED" && String(r.student?._id) !== String(user._id)).map((r) => ({ name: r.student?.name, room: r.student?.room, hostel: r.student?.hostelName, notice: { reference: r.notice.reference, title: r.notice.title, priority: r.notice.priority } })),
    note: "These classmates have not opened a notice that has to reach everyone. Tell them in class or in person.",
    kind: "ACTUAL DATA"
  };
}

/** Marks a notice read for a student at the kiosk (operator present). */
export async function markReadAtKiosk(operator, noticeReference, studentId) {
  const notice = await Notice.findOne({ reference: noticeReference }).lean();
  if (!notice) throw ApiError.notFound("No notice with that reference");
  const { User } = await import("../../models/User.js");
  const student = await User.findOne({ studentId });
  if (!student) throw ApiError.notFound("No student with that ID");
  const receipt = await NoticeReceipt.findOne({ notice: notice._id, student: student._id });
  if (!receipt) throw ApiError.notFound("This notice was not sent to that student");
  const now = new Date();
  if (!receipt.deliveredAt) receipt.deliveredAt = now;
  if (!receipt.readAt) receipt.readAt = now;
  receipt.channel = "KIOSK";
  await receipt.save();
  await audit({ _id: notice._id, reference: notice.reference }, { entityType: "Notice", action: "NOTICE_READ_AT_KIOSK", actor: operator, channel: "KIOSK", note: `${student.studentId}` });
  emitEvent({ type: "NOTICE_READ", actor: student, student, subjectType: "Notice", subjectId: notice._id, subjectRef: notice.reference, channel: "KIOSK", payload: { operator: operator.name } });
  return { reference: notice.reference, studentId, readAt: receipt.readAt, channel: "KIOSK" };
}

export { normaliseAudience };
