import { ROLES } from "../../config/constants.js";
import { Complaint } from "../../models/Complaint.js";
import { GatePass } from "../../models/GatePass.js";
import { User } from "../../models/User.js";
import { DocumentRequest } from "../../models/ext/DocumentRequest.js";
import { NoticeReceipt } from "../../models/ext/NoticeReceipt.js";
import { ReopenRequest } from "../../models/ext/ReopenRequest.js";
import { round } from "../../utils/text.js";
import { complaintTimeline, gatePassTimeline } from "../timelineService.js";
import { ServiceRequest } from "../../models/xo/ServiceRequest.js"; // EXCEPTION-ONLY HOOK
import { complaintDecision, documentDecision, gatePassDecision, serviceDecision, serviceTimeline } from "../xo/decisionInfo.js"; // EXCEPTION-ONLY HOOK

/**
 * One view across every kind of request.
 *
 * Complaints and gate passes are projected by the existing timelineService,
 * unchanged and read-only. Document requests, action-required notices and
 * reopen requests are projected here onto the same shape
 * ({ kind, id, reference, title, status, stages[], events[], method }).
 */

function stage(id, label, at, state) {
  return { id, label, state, at: at || null };
}

const firstAt = (history, action) => (history || []).find((h) => h.action === action)?.at || null;

export function documentTimeline(doc) {
  const order = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "ISSUED"];
  const labels = { SUBMITTED: "Submitted", UNDER_REVIEW: "Under review", APPROVED: "Approved", ISSUED: "Issued" };
  const at = {
    SUBMITTED: doc.createdAt,
    UNDER_REVIEW: firstAt(doc.history, "DOCUMENT_START_REVIEW"),
    APPROVED: firstAt(doc.history, "DOCUMENT_APPROVE"),
    ISSUED: doc.certificate?.issuedAt
  };
  const rejected = doc.status === "REJECTED";
  const current = rejected ? order.indexOf(doc.history?.some((h) => h.action === "DOCUMENT_START_REVIEW") ? "UNDER_REVIEW" : "SUBMITTED") : order.indexOf(doc.status);
  const stages = order.map((id, i) => {
    let state = "PENDING";
    if (rejected && i > current) state = "SKIPPED";
    else if (i < current || (i === current && (doc.status === "ISSUED" || rejected))) state = "DONE";
    else if (i === current) state = "CURRENT";
    return stage(id, labels[id], state === "PENDING" || state === "SKIPPED" ? null : at[id], state);
  });
  if (rejected) stages.push(stage("REJECTED", "Rejected", doc.reviewedAt, "DONE"));
  if (doc.certificate?.revokedAt) stages.push(stage("REVOKED", "Certificate revoked", doc.certificate.revokedAt, "DONE"));
  return {
    kind: "document",
    id: String(doc._id),
    reference: doc.reference,
    title: `${doc.type.replace("_", " ")} — ${doc.purpose}`,
    status: doc.status,
    stages,
    events: (doc.history || []).map((h) => ({ at: h.at, actor: h.actorName, message: `${h.action}${h.note ? ` · ${h.note}` : ""}`, kind: h.kind })),
    method: "DERIVED_FROM_STORED_RECORD"
  };
}

export function noticeTimeline(receipt, notice) {
  const steps = [
    ["PUBLISHED", "Published", notice.publishedAt],
    ["DELIVERED", "Delivered", receipt.deliveredAt],
    ["READ", "Read", receipt.readAt],
    ["ACKNOWLEDGED", "Acknowledged", receipt.acknowledgedAt],
    ["DONE", notice.actionRequired?.label || "Action done", receipt.actionDoneAt]
  ];
  const lastDone = steps.reduce((idx, s, i) => (s[2] ? i : idx), -1);
  return {
    kind: "notice",
    id: String(notice._id),
    reference: notice.reference,
    title: notice.title,
    status: receipt.actionDoneAt ? "DONE" : "ACTION_REQUIRED",
    stages: steps.map(([id, label, at], i) => stage(id, label, at, i <= lastDone ? "DONE" : i === lastDone + 1 ? "CURRENT" : "PENDING")),
    events: [],
    deadline: notice.actionRequired?.deadline || null,
    method: "DERIVED_FROM_STORED_RECORD"
  };
}

export function reopenTimeline(reopen) {
  const order = ["OPEN", "ACKNOWLEDGED", "CLOSED"];
  const i = order.indexOf(reopen.status);
  return {
    kind: "reopen",
    id: String(reopen._id),
    reference: reopen.reference,
    title: `Reopen of ${reopen.complaintReference} — ${reopen.reason || "not fixed"}`,
    status: reopen.status,
    stages: order.map((id, k) => stage(id, id[0] + id.slice(1).toLowerCase(), k === 0 ? reopen.createdAt : k <= i ? reopen.updatedAt : null, k < i || (k === i && id === "CLOSED") ? "DONE" : k === i ? "CURRENT" : "PENDING")),
    events: (reopen.history || []).map((h) => ({ at: h.at, actor: h.actorName, message: `${h.action}${h.note ? ` · ${h.note}` : ""}`, kind: h.kind })),
    method: "DERIVED_FROM_STORED_RECORD"
  };
}

const CLOSED = {
  complaint: ["RESOLVED"],
  gatepass: ["RETURNED", "RETURNED_LATE", "REJECTED", "CANCELLED"],
  document: ["ISSUED", "REJECTED"],
  notice: ["DONE"],
  reopen: ["CLOSED"],
  service: ["FULFILLED", "REJECTED"] // EXCEPTION-ONLY HOOK: fee-receipt copies (Touchless Lane)
};

export async function myRequests(user) {
  const [complaints, passes, docs, receipts, reopens] = await Promise.all([
    Complaint.find({ student: user._id }).sort({ createdAt: -1 }).limit(40).lean(),
    GatePass.find({ student: user._id }).sort({ createdAt: -1 }).limit(20).lean(),
    DocumentRequest.find({ student: user._id }).sort({ createdAt: -1 }).limit(20).lean(),
    NoticeReceipt.find({ student: user._id }).populate("notice").sort({ createdAt: -1 }).limit(60).lean(),
    ReopenRequest.find({ student: user._id }).sort({ createdAt: -1 }).limit(20).lean()
  ]);
  const services = await ServiceRequest.find({ student: user._id }).sort({ createdAt: -1 }).limit(20).lean(); // EXCEPTION-ONLY HOOK
  const items = [
    ...complaints.map((c) => ({ ...complaintTimeline(c), createdAt: c.createdAt, channel: c.channel || "APP" })),
    ...passes.map((g) => ({ ...gatePassTimeline(g), createdAt: g.createdAt, channel: g.channel || "APP" })),
    ...docs.map((d) => ({ ...documentTimeline(d), createdAt: d.createdAt, channel: d.channel })),
    ...receipts
      .filter((r) => r.notice?.status === "PUBLISHED" && r.notice.actionRequired?.label)
      .map((r) => ({ ...noticeTimeline(r, r.notice), createdAt: r.notice.publishedAt, channel: r.channel })),
    ...reopens.map((r) => ({ ...reopenTimeline(r), createdAt: r.createdAt, channel: "APP" })),
    // EXCEPTION-ONLY HOOK: fee-receipt copy requests, in the same timeline shape.
    ...services.map(serviceTimeline)
  ]
    .map((item) => ({ ...item, open: !CLOSED[item.kind].includes(item.status) }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  // EXCEPTION-ONLY HOOK: every request says who decided (written policy or a named person) and why.
  const resolverNames = new Map((await User.find({ _id: { $in: complaints.map((c) => c.resolution?.resolvedBy).filter(Boolean) } }).select("name").lean()).map((u) => [String(u._id), u.name]));
  const sources = { complaint: new Map(complaints.map((c) => [String(c._id), c])), gatepass: new Map(passes.map((g) => [String(g._id), g])), document: new Map(docs.map((d) => [String(d._id), d])), service: new Map(services.map((s) => [String(s._id), s])) };
  for (const item of items) {
    const src = sources[item.kind]?.get(item.id);
    if (!src) continue;
    item.decision = item.kind === "complaint" ? complaintDecision(src, resolverNames.get(String(src.resolution?.resolvedBy))) : item.kind === "gatepass" ? gatePassDecision(src) : item.kind === "document" ? documentDecision(src) : serviceDecision(src);
  }
  const count = (kind) => items.filter((i) => i.kind === kind).length;
  return {
    items,
    summary: {
      total: items.length,
      open: items.filter((i) => i.open).length,
      byKind: { complaint: count("complaint"), gatepass: count("gatepass"), document: count("document"), notice: count("notice"), reopen: count("reopen"), service: count("service") }
    },
    method: "DERIVED_FROM_STORED_RECORD",
    kind: "ACTUAL DATA"
  };
}

// ---- staff: the unified pending queue -----------------------------------------

export const GATE_PASS_TARGET_HOURS = 4;
export const REOPEN_TARGET_HOURS = 24;

export function ageBucket(hours) {
  if (hours < 24) return "<24h";
  if (hours < 72) return "1–3d";
  if (hours < 168) return "3–7d";
  return ">7d";
}

export const BUCKETS = ["<24h", "1–3d", "3–7d", ">7d"];

export async function pendingQueue({ department, staff, kind, now = new Date() } = {}) {
  const [complaints, passes, docs, reopens, staffUsers] = await Promise.all([
    Complaint.find({ status: { $ne: "RESOLVED" } }).populate("assignedTo", "name").populate("student", "studentId").lean(),
    GatePass.find({ status: { $in: ["PENDING_PARENT_VERIFICATION", "PARENT_VERIFIED", "PENDING_WARDEN_APPROVAL"] } }).lean(),
    DocumentRequest.find({ status: { $in: ["SUBMITTED", "UNDER_REVIEW", "APPROVED"] } }).lean(),
    ReopenRequest.find({ status: { $in: ["OPEN", "ACKNOWLEDGED"] } }).lean(),
    User.find({ role: { $ne: ROLES.STUDENT } }).select("name role managedDepartment hostel hostelName").lean()
  ]);
  const deptOwner = (dept) => staffUsers.find((u) => u.managedDepartment === dept)?.name || null;
  const warden = (hostelId) => staffUsers.find((u) => u.role === ROLES.WARDEN && String(u.hostel) === String(hostelId))?.name || null;
  const hoursSince = (at) => round((now - new Date(at)) / 3600000, 1);

  const row = (base) => {
    const age = hoursSince(base.createdAt);
    const breached = base.slaHours ? age > base.slaHours : null;
    return {
      ...base,
      ageHours: age,
      bucket: ageBucket(age),
      sla: base.slaHours ? { hours: base.slaHours, state: breached ? "BREACHED" : age > base.slaHours * 0.75 ? "AT_RISK" : "ON_TRACK", basis: base.slaBasis } : { hours: null, state: "NO_SLA", basis: base.slaBasis }
    };
  };

  let items = [
    ...complaints.map((c) =>
      row({
        kind: "complaint",
        id: String(c._id),
        reference: c.reference,
        title: c.title,
        status: c.status,
        department: c.department || "UNROUTED",
        owner: c.assignedTo?.name || deptOwner(c.department) || "Unassigned",
        ownerBasis: c.assignedTo?.name ? "ASSIGNED" : deptOwner(c.department) ? "DEPARTMENT QUEUE OWNER" : "UNASSIGNED",
        priority: c.priority,
        channel: c.channel || "APP",
        createdAt: c.createdAt,
        slaHours: c.aiClassification?.slaHours || null,
        slaBasis: "Complaint SLA from its classification"
      })
    ),
    ...passes.map((g) =>
      row({
        kind: "gatepass",
        id: String(g._id),
        reference: g.reference,
        title: g.reason,
        status: g.status,
        department: "HOSTEL OFFICE",
        owner: g.status === "PENDING_WARDEN_APPROVAL" || g.status === "PARENT_VERIFIED" ? warden(g.hostel) || "Warden (unassigned)" : "Guardian (OTP pending)",
        ownerBasis: "GATE PASS STAGE",
        priority: "MEDIUM",
        channel: g.channel || "APP",
        createdAt: g.createdAt,
        slaHours: GATE_PASS_TARGET_HOURS,
        slaBasis: `Extension target: ${GATE_PASS_TARGET_HOURS}h from application to decision`
      })
    ),
    ...docs.map((d) =>
      row({
        kind: "document",
        id: String(d._id),
        reference: d.reference,
        title: `${d.type.replace("_", " ")} — ${d.purpose}`,
        status: d.status,
        department: "ACADEMIC OFFICE",
        owner: d.reviewerName || deptOwner("ACADEMIC OFFICE") || "Unassigned",
        ownerBasis: d.reviewerName ? "REVIEWER" : "UNASSIGNED",
        priority: "MEDIUM",
        channel: d.channel,
        createdAt: d.createdAt,
        slaHours: d.slaHours,
        slaBasis: `Document SLA for ${d.type}`
      })
    ),
    ...reopens.map((r) =>
      row({
        kind: "reopen",
        id: String(r._id),
        reference: r.reference,
        title: `Reopen ${r.complaintReference}: ${r.reason || "not fixed"}`,
        status: r.status,
        department: r.department || "UNROUTED",
        owner: deptOwner(r.department) || "Unassigned",
        ownerBasis: deptOwner(r.department) ? "DEPARTMENT QUEUE OWNER" : "UNASSIGNED",
        priority: "HIGH",
        channel: "APP",
        createdAt: r.createdAt,
        slaHours: r.slaHours || REOPEN_TARGET_HOURS,
        slaBasis: `Extension target: ${REOPEN_TARGET_HOURS}h to act on a reopen`
      })
    )
  ];

  const departments = [...new Set(items.map((i) => i.department))].sort();
  const owners = [...new Set(items.map((i) => i.owner))].sort();
  if (department) items = items.filter((i) => i.department === department);
  if (staff) items = items.filter((i) => i.owner === staff);
  if (kind) items = items.filter((i) => i.kind === kind);
  items.sort((a, b) => b.ageHours - a.ageHours);

  const buckets = BUCKETS.map((b) => ({ bucket: b, count: items.filter((i) => i.bucket === b).length }));
  const workload = owners
    .map((owner) => {
      const mine = items.filter((i) => i.owner === owner);
      return { owner, total: mine.length, breached: mine.filter((i) => i.sla.state === "BREACHED").length, oldestHours: mine[0]?.ageHours ?? null, byKind: Object.fromEntries(["complaint", "gatepass", "document", "reopen"].map((k) => [k, mine.filter((i) => i.kind === k).length])) };
    })
    .filter((w) => w.total > 0)
    .sort((a, b) => b.total - a.total);

  return {
    items,
    total: items.length,
    breached: items.filter((i) => i.sla.state === "BREACHED").length,
    buckets,
    workload,
    filters: { departments, owners, kinds: ["complaint", "gatepass", "document", "reopen"] },
    applied: { department: department || null, staff: staff || null, kind: kind || null },
    method: "DATABASE_RECORDS",
    kind: "ACTUAL DATA"
  };
}
