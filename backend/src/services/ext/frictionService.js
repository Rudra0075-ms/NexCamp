import { Complaint } from "../../models/Complaint.js";
import { GatePass } from "../../models/GatePass.js";
import { DocumentRequest } from "../../models/ext/DocumentRequest.js";
import { FrictionBaseline } from "../../models/ext/FrictionBaseline.js";
import { NoticeReceipt } from "../../models/ext/NoticeReceipt.js";
import { ApiError } from "../../utils/ApiError.js";
import { round } from "../../utils/text.js";
import { audit } from "./extAudit.js";

/**
 * Friction Ledger (PS07 extension 2A) — measures the "30% less friction" claim.
 *
 * ACTUAL DATA: time from request to completion and the number of student
 * actions, read from timestamps and audit trails the existing workflows
 * already store. Nothing here writes to those records.
 * BASELINE ESTIMATE: how long the old paper / queue / diary process takes, one
 * editable row per workflow, each with its stated source.
 * ESTIMATE: hours saved = baseline − actual, which inherits the baseline's
 * uncertainty and is labelled accordingly.
 */

export const TARGET_REDUCTION_PCT = 30;

export const DEFAULT_BASELINES = [
  { workflow: "COMPLAINT", task: "Report a hostel problem", oldProcess: "Written in the warden's diary, then chased in person", hours: 72, studentActions: 3, studentMinutes: 45 },
  { workflow: "GATE_PASS", task: "Get a gate pass", oldProcess: "Paper slip, guardian phone call, warden signature at the office", hours: 6, studentActions: 3, studentMinutes: 40 },
  { workflow: "DOCUMENT", task: "Get a bonafide / other certificate", oldProcess: "Form at the academic office, queue, return to collect", hours: 48, studentActions: 3, studentMinutes: 120 },
  { workflow: "NOTICE", task: "Receive a notice that applies to you", oldProcess: "WhatsApp forward or the notice board", hours: 12, studentActions: 1, studentMinutes: 10 },
  { workflow: "CLASS_CHECK", task: "Find out whether tomorrow's class is cancelled", oldProcess: "Ask the class representative / group chat", hours: 2, studentActions: 2, studentMinutes: 15 },
  { workflow: "MENU_CHECK", task: "Check a changed mess menu", oldProcess: "Walk to the mess notice board", hours: 0.25, studentActions: 1, studentMinutes: 15 }
];

export const BASELINE_SOURCE =
  "Team CodexFlow estimate from students' descriptions of the current process — not a measurement. Replace with your campus's own figure; every edit is audited.";

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Pure: ledger row for one workflow from completed items and its baseline. */
export function ledgerRow(workflow, items, baseline) {
  const hours = items.map((i) => i.hours);
  const actions = items.map((i) => i.actions);
  const actualMedian = median(hours);
  const saved = baseline ? items.reduce((t, i) => t + Math.max(0, baseline.hours - i.hours), 0) : null;
  const students = new Set(items.map((i) => i.student)).size;
  const reduction = baseline && actualMedian !== null && baseline.hours > 0 ? round((1 - actualMedian / baseline.hours) * 100, 1) : null;
  return {
    workflow,
    task: baseline?.task || workflow,
    completed: items.length,
    students,
    actual: items.length
      ? {
          medianHours: round(actualMedian, 2),
          meanHours: round(hours.reduce((t, h) => t + h, 0) / hours.length, 2),
          medianActions: median(actions),
          kind: "ACTUAL DATA"
        }
      : { kind: "INSUFFICIENT DATA", note: "Insufficient data — nothing completed in this window." },
    baseline: baseline
      ? { hours: baseline.hours, studentActions: baseline.studentActions, studentMinutes: baseline.studentMinutes, oldProcess: baseline.oldProcess, source: baseline.source, kind: "BASELINE ESTIMATE" }
      : null,
    saved: items.length && baseline
      ? { hours: round(saved, 1), perStudentHours: students ? round(saved / students, 1) : null, reductionPct: reduction, meetsTarget: reduction !== null ? reduction >= TARGET_REDUCTION_PCT : null, kind: "ESTIMATE", basis: "baseline hours − actual hours, summed over completed items (never negative)" }
      : null
  };
}

const hoursBetween = (a, b) => (new Date(b) - new Date(a)) / 3600000;

async function completedItems(since) {
  const [complaints, passes, docs, receipts] = await Promise.all([
    Complaint.find({ status: "RESOLVED", "resolution.resolvedAt": { $gte: since } }).populate("student", "name").lean(),
    GatePass.find({ "approval.decidedAt": { $gte: since } }).populate("student", "name").lean(),
    DocumentRequest.find({ status: "ISSUED", "certificate.issuedAt": { $gte: since } }).lean(),
    NoticeReceipt.find({ readAt: { $gte: since } }).populate("notice", "publishedAt kind").lean()
  ]);
  return {
    COMPLAINT: complaints.map((c) => ({
      ref: c.reference,
      student: String(c.student?._id || c.student),
      hours: hoursBetween(c.createdAt, c.resolution.resolvedAt),
      // Student actions: the audit rows the student themselves wrote.
      actions: Math.max(1, (c.audit || []).filter((a) => a.actor === c.student?.name).length),
      channel: c.channel || "APP"
    })),
    GATE_PASS: passes.map((g) => ({
      ref: g.reference,
      student: String(g.student?._id || g.student),
      hours: hoursBetween(g.createdAt, g.approval.decidedAt),
      actions: Math.max(1, (g.events || []).filter((e) => e.actor === g.student?.name).length),
      channel: g.channel || "APP"
    })),
    DOCUMENT: docs.map((d) => ({
      ref: d.reference,
      student: String(d.student),
      hours: hoursBetween(d.createdAt, d.certificate.issuedAt),
      actions: Math.max(1, (d.history || []).filter((h) => h.actorRole === "STUDENT").length),
      channel: d.channel
    })),
    NOTICE: receipts
      .filter((r) => r.notice?.publishedAt && new Date(r.readAt) >= new Date(r.notice.publishedAt))
      .map((r) => ({ ref: String(r.notice._id), student: String(r.student), hours: hoursBetween(r.notice.publishedAt, r.readAt), actions: 1, channel: r.channel }))
  };
}

export async function ensureBaselines() {
  const count = await FrictionBaseline.countDocuments();
  if (count) return;
  await FrictionBaseline.insertMany(DEFAULT_BASELINES.map((b) => ({ ...b, source: BASELINE_SOURCE })));
}

export async function ledger({ days = 7 } = {}) {
  await ensureBaselines();
  const since = new Date(Date.now() - days * 864e5);
  const [items, baselines] = await Promise.all([completedItems(since), FrictionBaseline.find().lean()]);
  const byWorkflow = new Map(baselines.map((b) => [b.workflow, b]));
  const rows = Object.entries(items).map(([workflow, list]) => ledgerRow(workflow, list, byWorkflow.get(workflow)));
  const allStudents = new Set(Object.values(items).flat().map((i) => i.student));
  const totalSaved = rows.reduce((t, r) => t + (r.saved?.hours || 0), 0);
  return {
    window: { days, since },
    rows,
    totals: {
      completed: rows.reduce((t, r) => t + r.completed, 0),
      students: allStudents.size,
      hoursSaved: round(totalSaved, 1),
      hoursSavedPerStudent: allStudents.size ? round(totalSaved / allStudents.size, 1) : null,
      kind: "ESTIMATE",
      basis: "Sum of (baseline − actual) per completed item. Actual durations are ACTUAL DATA; baselines are BASELINE ESTIMATE."
    },
    target: { reductionPct: TARGET_REDUCTION_PCT, text: "PS07 success criterion: at least 30% less friction than the old process." },
    baselines: baselines.map((b) => ({ workflow: b.workflow, task: b.task, oldProcess: b.oldProcess, hours: b.hours, studentActions: b.studentActions, studentMinutes: b.studentMinutes, source: b.source, label: b.label, updatedAt: b.updatedAt, edits: (b.history || []).length })),
    method: "RECORD_TIMESTAMPS_VS_BASELINE",
    source: "DETERMINISTIC",
    kind: "ACTUAL DATA"
  };
}

export async function updateBaseline(workflow, actor, input) {
  await ensureBaselines();
  const row = await FrictionBaseline.findOne({ workflow });
  if (!row) throw ApiError.notFound("No baseline for that workflow");
  const before = `${row.hours}h / ${row.studentActions} actions / ${row.studentMinutes} min`;
  for (const key of ["hours", "studentActions", "studentMinutes", "source", "oldProcess"]) if (input[key] !== undefined) row[key] = input[key];
  const after = `${row.hours}h / ${row.studentActions} actions / ${row.studentMinutes} min`;
  await audit(row, { entityType: "FrictionBaseline", action: "BASELINE_EDITED", actor, field: workflow, previousValue: before, newValue: after, note: input.source ? `source: ${input.source}` : undefined, kind: "BASELINE ESTIMATE" });
  await row.save();
  return row.toObject();
}

/**
 * Tuesday Mode: the time a student spent in the app on each task (measured by
 * the demo's own stopwatch, labelled as such) against the old-process baseline.
 */
export async function compare(steps = []) {
  await ensureBaselines();
  const baselines = new Map((await FrictionBaseline.find().lean()).map((b) => [b.workflow, b]));
  const rows = steps.map((step) => {
    const b = baselines.get(step.workflow);
    const minutes = round(step.seconds / 60, 2);
    return {
      workflow: step.workflow,
      label: step.label || b?.task || step.workflow,
      channel: step.channel || "APP",
      reference: step.reference || null,
      measured: { seconds: step.seconds, minutes, actions: step.actions ?? 1, kind: "MEASURED IN THIS DEMO", basis: "Browser stopwatch around the real API calls" },
      baseline: b ? { minutes: b.studentMinutes, actions: b.studentActions, turnaroundHours: b.hours, oldProcess: b.oldProcess, kind: "BASELINE ESTIMATE", source: b.source } : null,
      savedMinutes: b ? round(Math.max(0, b.studentMinutes - minutes), 1) : null,
      reductionPct: b && b.studentMinutes ? round((1 - minutes / b.studentMinutes) * 100, 1) : null
    };
  });
  const measured = rows.reduce((t, r) => t + r.measured.minutes, 0);
  const baseline = rows.reduce((t, r) => t + (r.baseline?.minutes || 0), 0);
  return {
    rows,
    totals: {
      measuredMinutes: round(measured, 1),
      baselineMinutes: round(baseline, 1),
      reductionPct: baseline ? round((1 - measured / baseline) * 100, 1) : null,
      meetsTarget: baseline ? (1 - measured / baseline) * 100 >= TARGET_REDUCTION_PCT : null,
      kind: "ESTIMATE",
      basis: "Measured demo minutes against BASELINE ESTIMATE minutes of student time"
    },
    method: "STOPWATCH_VS_BASELINE",
    kind: "ESTIMATE"
  };
}
