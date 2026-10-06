import { STAFF_ROLES } from "../../config/constants.js";
import { AuditEntry } from "../../models/AuditEntry.js";
import { Complaint } from "../../models/Complaint.js";
import { GatePass } from "../../models/GatePass.js";
import { ClassChange } from "../../models/ext/ClassChange.js";
import { DocumentRequest } from "../../models/ext/DocumentRequest.js";
import { FeeAccount } from "../../models/ext/FeeAccount.js";
import { FixConfirmation } from "../../models/ext/FixConfirmation.js";
import { MenuChange } from "../../models/ext/MenuChange.js";
import { Notice } from "../../models/ext/Notice.js";
import { NoticeReceipt } from "../../models/ext/NoticeReceipt.js";
import { SmsMessage } from "../../models/ext/SmsMessage.js";
import { User } from "../../models/User.js";
import { CampusEvent } from "../../models/xo/CampusEvent.js";
import { record } from "../auditChainService.js";
import { everyoneWithProfiles } from "../ext/profileService.js";
import { buildEvent } from "./eventService.js";

/**
 * Backfill (Phase 1): derives Campus Events for records that existed before the
 * event log did — the seeded history, and anything created while emission was
 * off. Every derived event is marked origin BACKFILL and carries
 * payload.derivedFrom naming the stored field it was read from.
 *
 * Idempotent: it deletes its own earlier BACKFILL events first, and never
 * derives an event whose (type, subject) pair already has a LIVE event.
 */

const STATUS_TO_GATEPASS_EVENT = {
  PENDING_PARENT_VERIFICATION: "GATEPASS_APPLIED",
  PARENT_VERIFIED: "GATEPASS_OTP_VERIFIED",
  APPROVED: "GATEPASS_APPROVED",
  REJECTED: "GATEPASS_REJECTED",
  ACTIVE: "GATEPASS_EXITED",
  RETURNED: "GATEPASS_RETURNED",
  RETURNED_LATE: "GATEPASS_RETURNED",
  OVERDUE: "GATEPASS_OVERDUE"
};

const DOCUMENT_ACTION_TO_EVENT = {
  DOCUMENT_REQUESTED: "CERTIFICATE_REQUESTED",
  DOCUMENT_START_REVIEW: "CERTIFICATE_REVIEWED",
  DOCUMENT_APPROVE: "CERTIFICATE_REVIEWED",
  DOCUMENT_REJECT: "CERTIFICATE_REJECTED",
  DOCUMENT_ISSUED: "CERTIFICATE_ISSUED"
};

/** Pure: complaint → derived events. `staffNames` maps a name to a role. */
export function complaintEvents(c, { staffById = new Map() } = {}) {
  const base = { subjectType: "Complaint", subjectId: c._id, subjectRef: c.reference, student: c.student?._id || c.student, department: c.department };
  const out = [
    { ...base, type: "COMPLAINT_CREATED", at: c.createdAt, actor: { _id: c.student?._id || c.student, role: "STUDENT", name: c.student?.name }, channel: c.channel || "APP", payload: { category: c.category, derivedFrom: "createdAt" } }
  ];
  const classified = (c.audit || []).find((a) => /classification/i.test(a.message || ""));
  if (classified) out.push({ ...base, type: "COMPLAINT_CLASSIFIED", at: classified.at, actor: { name: classified.actor, role: "SYSTEM" }, channel: "SYSTEM", payload: { derivedFrom: "audit" } });
  const assigned = (c.audit || []).find((a) => /^(Assigned to|Merged into)/.test(a.message || ""));
  if (assigned) out.push({ ...base, type: "COMPLAINT_ASSIGNED", at: assigned.at, actor: { name: assigned.actor, role: "SYSTEM" }, channel: "SYSTEM", payload: { derivedFrom: "audit" } });
  // ROUND-3 HOOK (see CHANGES-ROUND3.md): later hand-offs the audit trail records — "Reassigned to …"
  // and "Investigation started …" — become events too, so process mining sees loops and waits.
  const staffByName = new Map([...staffById.values()].map((u) => [u.name, u]));
  for (const a of (c.audit || []).filter((x) => /^Reassigned to/.test(x.message || ""))) out.push({ ...base, type: "COMPLAINT_ASSIGNED", at: a.at, actor: { _id: staffByName.get(a.actor)?._id, name: a.actor, role: staffByName.get(a.actor)?.role || "ADMIN" }, channel: "APP", payload: { reassigned: true, note: a.message, derivedFrom: "audit" } });
  for (const a of (c.audit || []).filter((x) => /^Investigation started/.test(x.message || ""))) out.push({ ...base, type: "COMPLAINT_STATUS_CHANGED", at: a.at, actor: { _id: staffByName.get(a.actor)?._id, name: a.actor, role: staffByName.get(a.actor)?.role || "FACILITY_MANAGER" }, channel: "APP", payload: { to: "INVESTIGATING", derivedFrom: "audit" } });
  if (c.aiRouting?.decidedAt) out.push({ ...base, type: "COMPLAINT_ASSIGNED", at: c.aiRouting.decidedAt, actor: { _id: c.aiRouting.decidedBy, name: c.aiRouting.decidedByName, role: c.aiRouting.decidedByRole || "ADMIN" }, channel: "APP", payload: { decision: c.aiRouting.decision, derivedFrom: "aiRouting" } });
  if (c.status === "RESOLVED" && c.resolution?.resolvedAt) {
    const resolver = staffById.get(String(c.resolution.resolvedBy));
    out.push({ ...base, type: "COMPLAINT_RESOLVED", at: c.resolution.resolvedAt, actor: { _id: c.resolution.resolvedBy, name: resolver?.name, role: resolver?.role || "FACILITY_MANAGER" }, channel: "APP", payload: { hours: c.resolution.resolutionTimeHours, derivedFrom: "resolution.resolvedAt" } });
  }
  return out;
}

/** Pure: gate pass → derived events (first occurrence of each stage). */
export function gatePassEvents(g) {
  const base = { subjectType: "GatePass", subjectId: g._id, subjectRef: g.reference, student: g.student?._id || g.student };
  const seen = new Set();
  const out = [];
  for (const e of g.events || []) {
    const type = STATUS_TO_GATEPASS_EVENT[e.status];
    if (!type || seen.has(type)) continue;
    seen.add(type);
    const approving = type === "GATEPASS_APPROVED" || type === "GATEPASS_REJECTED";
    const policy = approving && g.decidedBy === "POLICY";
    out.push({
      ...base,
      type,
      at: e.at,
      actor: approving ? { _id: g.approval?.decidedBy, name: g.approval?.decidedByName || e.actor, role: policy ? "SYSTEM" : "WARDEN" } : { name: e.actor, role: type === "GATEPASS_APPLIED" || type === "GATEPASS_OTP_VERIFIED" ? "STUDENT" : "SYSTEM" },
      channel: policy ? "POLICY" : type === "GATEPASS_APPLIED" ? g.channel || "APP" : approving ? "APP" : "SYSTEM",
      payload: { derivedFrom: "events" }
    });
  }
  if (!seen.has("GATEPASS_APPLIED")) out.unshift({ ...base, type: "GATEPASS_APPLIED", at: g.createdAt, actor: { role: "STUDENT" }, channel: g.channel || "APP", payload: { derivedFrom: "createdAt" } });
  return out;
}

/** Pure: document request → derived events from its own history rows. */
export function documentEvents(d) {
  const base = { subjectType: "DocumentRequest", subjectId: d._id, subjectRef: d.reference, student: d.student, department: "ACADEMIC OFFICE" };
  const out = [];
  for (const h of d.history || []) {
    const type = h.action === "POLICY_AUTO_APPROVED" ? "POLICY_DECISION" : DOCUMENT_ACTION_TO_EVENT[h.action];
    if (!type) continue;
    const policy = h.channel === "POLICY" || h.actorRole === "POLICY";
    out.push({ ...base, type, at: h.at, actor: { name: h.actorName, role: policy ? "SYSTEM" : h.actorRole || "SYSTEM" }, channel: policy ? "POLICY" : type === "CERTIFICATE_REQUESTED" ? d.channel || "APP" : "APP", humanTouch: policy || type === "CERTIFICATE_REQUESTED" ? false : undefined, payload: { action: h.action, derivedFrom: "history" } });
  }
  if (!out.some((e) => e.type === "CERTIFICATE_REQUESTED")) out.unshift({ ...base, type: "CERTIFICATE_REQUESTED", at: d.createdAt, actor: { role: "STUDENT" }, channel: d.channel || "APP", payload: { derivedFrom: "createdAt" } });
  return out;
}

export async function backfillEvents({ actor } = {}) {
  const removed = (await CampusEvent.deleteMany({ origin: "BACKFILL" })).deletedCount || 0;
  const live = new Set((await CampusEvent.find({ origin: "LIVE" }).select("type subjectId").lean()).map((e) => `${e.type}|${e.subjectId}`));
  const [complaints, passes, docs, notices, receipts, classChanges, menuChanges, sms, confirmations, fees, staff, people] = await Promise.all([
    Complaint.find().populate("student", "name").lean(),
    GatePass.find().lean(),
    DocumentRequest.find().lean(),
    Notice.find({ status: "PUBLISHED" }).lean(),
    NoticeReceipt.find({ deliveredAt: { $ne: null } }).populate("notice", "reference status").lean(),
    ClassChange.find().lean(),
    MenuChange.find().lean(),
    SmsMessage.find({ student: { $ne: null } }).lean(),
    FixConfirmation.find({ response: { $in: ["YES", "NOT_FIXED"] } }).lean(),
    FeeAccount.find().lean(),
    User.find({ role: { $in: STAFF_ROLES } }).select("name role").lean(),
    everyoneWithProfiles({ roles: ["STUDENT"] })
  ]);
  const staffById = new Map(staff.map((u) => [String(u._id), u]));
  const cohorts = new Map(people.map(({ user, profile }) => [String(user._id), { hostel: user.hostelName, branch: profile.branch, year: profile.year, section: profile.section }]));

  const drafts = [
    ...complaints.flatMap((c) => complaintEvents(c, { staffById })),
    ...passes.flatMap(gatePassEvents),
    ...docs.flatMap(documentEvents),
    ...notices.map((n) => ({ type: "NOTICE_PUBLISHED", subjectType: "Notice", subjectId: n._id, subjectRef: n.reference, at: n.publishedAt || n.createdAt, actor: { name: n.authorName, role: n.authorRole || "SYSTEM" }, channel: "SYSTEM", humanTouch: false, payload: { reach: n.reach, derivedFrom: "publishedAt" } })),
    ...receipts
      .filter((r) => r.notice?.status === "PUBLISHED")
      .flatMap((r) => {
        const base = { subjectType: "Notice", subjectId: r.notice._id, subjectRef: r.notice.reference, student: r.student, actor: { _id: r.student, role: "STUDENT" }, channel: r.channel || "APP" };
        return [
          { ...base, type: "NOTICE_DELIVERED", at: r.deliveredAt, payload: { derivedFrom: "deliveredAt", receipt: String(r._id) } },
          r.readAt ? { ...base, type: "NOTICE_READ", at: r.readAt, payload: { derivedFrom: "readAt", receipt: String(r._id) } } : null,
          r.actionDoneAt ? { ...base, type: "NOTICE_ACTED", at: r.actionDoneAt, payload: { derivedFrom: "actionDoneAt", receipt: String(r._id) } } : null
        ].filter(Boolean);
      }),
    ...classChanges.map((c) => ({ type: "CLASS_CHANGED", subjectType: "ClassChange", subjectId: c._id, subjectRef: c.reference, at: c.createdAt, actor: { _id: c.by, name: c.byName, role: "ADMIN" }, channel: "APP", department: "ACADEMIC OFFICE", payload: { changeType: c.type, subject: c.subject, sessionDate: c.sessionDate, derivedFrom: "createdAt" } })),
    ...menuChanges.map((m) => ({ type: "MENU_CHANGED", subjectType: "MenuChange", subjectId: m._id, subjectRef: m.reference, at: m.createdAt, actor: { _id: m.by, name: m.byName, role: "ADMIN" }, channel: "APP", department: "MESS ADMINISTRATION", payload: { date: m.date, meal: m.meal, derivedFrom: "createdAt" } })),
    ...sms.map((m) => ({ type: "SMS_REQUEST", subjectType: "SmsMessage", subjectId: m._id, subjectRef: m.relatedRef, at: m.createdAt, student: m.student, actor: { _id: m.student, role: "STUDENT" }, channel: "SMS", payload: { command: m.command, outcome: m.outcome, derivedFrom: "createdAt" } })),
    ...confirmations.map((f) => ({ type: f.response === "YES" ? "COMPLAINT_CONFIRMED_FIXED" : "COMPLAINT_REOPENED", subjectType: "Complaint", subjectId: f.complaint, subjectRef: f.complaintReference, at: f.respondedAt || f.updatedAt, student: f.student, actor: { _id: f.student, role: "STUDENT" }, channel: "APP", department: f.department, payload: { response: f.response, derivedFrom: "FixConfirmation" } })),
    ...fees
      .filter((a) => (a.heads || []).length && a.heads.every((h) => h.paid >= h.amount))
      .map((a) => ({ type: "FEES_CLEARED", subjectType: "FeeAccount", subjectId: a._id, at: a.updatedAt || a.createdAt, student: a.student, actor: { _id: a.student, role: "STUDENT" }, channel: "APP", payload: { derivedFrom: "FeeAccount.heads" } }))
  ];

  // Audit refs: nearest chain entry for the same record within five minutes.
  const ids = [...new Set(drafts.map((d) => String(d.subjectId)))];
  const audits = await AuditEntry.find({ entityId: { $in: ids } }).select("entityId sequence at").lean();
  const auditsBy = new Map();
  for (const a of audits) {
    if (!auditsBy.has(a.entityId)) auditsBy.set(a.entityId, []);
    auditsBy.get(a.entityId).push(a);
  }

  const docsToWrite = [];
  for (const d of drafts) {
    if (!d.at || live.has(`${d.type}|${String(d.subjectId)}`)) continue;
    let event;
    try {
      event = buildEvent({ ...d, origin: "BACKFILL" });
    } catch {
      continue;
    }
    const near = (auditsBy.get(event.subjectId) || []).map((a) => ({ a, gap: Math.abs(new Date(a.at) - event.at) })).sort((x, y) => x.gap - y.gap)[0];
    if (near && near.gap < 300000) event.auditRef = `#${near.a.sequence}`;
    if (event.studentId) event.cohort = cohorts.get(String(event.studentId));
    docsToWrite.push(event);
  }
  for (let i = 0; i < docsToWrite.length; i += 500) await CampusEvent.insertMany(docsToWrite.slice(i, i + 500), { ordered: false });

  const byType = {};
  for (const e of docsToWrite) byType[e.type] = (byType[e.type] || 0) + 1;
  await record({
    entityType: "CampusEvent",
    entityId: "backfill",
    action: "EVENTS_BACKFILLED",
    actor,
    newValue: String(docsToWrite.length),
    note: `${docsToWrite.length} events derived from stored records (${removed} earlier backfilled events replaced)`
  });
  return { written: docsToWrite.length, replaced: removed, skippedLive: live.size, byType, method: "DERIVED_FROM_STORED_RECORDS" };
}
