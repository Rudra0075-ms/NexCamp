import { FrictionBaseline } from "../../models/ext/FrictionBaseline.js";
import { CampusEvent } from "../../models/xo/CampusEvent.js";
import { round } from "../../utils/text.js";
import { ensureBaselines } from "../ext/frictionService.js";
import { median } from "./responseStats.js";

/**
 * The measured Friction Ledger (Phase 3).
 *
 * Every figure per request comes from the Campus Event log:
 *   time to outcome  first request event → first outcome event (hours)
 *   handoffs         distinct people or offices that held the request after it was filed
 *   human touches    events whose actor was staff and whose channel was not POLICY
 *   channel          the channel of the first request event
 *   visit avoided    filed from the app or by SMS (not at a desk) for a request whose
 *                    old path needed an office visit (the baseline says how many)
 *
 * The old path is the FrictionBaseline row for the request type, labelled
 * ASSUMPTION with its stated source. Anything derived from both (hours
 * returned, visits avoided) is an ESTIMATE and says so.
 */

export const REQUEST_TYPES = {
  Complaint: { workflow: "COMPLAINT", label: "Complaint", start: ["COMPLAINT_CREATED"], end: ["COMPLAINT_RESOLVED"] },
  GatePass: { workflow: "GATE_PASS", label: "Gate pass", start: ["GATEPASS_APPLIED"], end: ["GATEPASS_APPROVED", "GATEPASS_REJECTED"] },
  DocumentRequest: { workflow: "DOCUMENT", label: "Certificate", start: ["CERTIFICATE_REQUESTED"], end: ["CERTIFICATE_ISSUED", "CERTIFICATE_REJECTED"] },
  ServiceRequest: { workflow: "FEE_RECEIPT", label: "Fee receipt copy", start: ["SERVICE_REQUESTED"], end: ["SERVICE_FULFILLED"] }
};

// The old path of each request type. ASSUMPTION — from students' and staff's
// descriptions of the paper process; editable (and audited) on page 10.
export const OLD_PATHS = {
  COMPLAINT: { hops: 6, touches: 4, officeVisits: 1, oldPath: ["WhatsApp group", "Warden", "Office", "Paper register", "Phone call", "Wait"] },
  GATE_PASS: { hops: 3, touches: 2, officeVisits: 1, oldPath: ["Paper slip", "Guardian phone call", "Warden signature at the office"] },
  DOCUMENT: { hops: 3, touches: 3, officeVisits: 2, oldPath: ["Form at the academic office", "Clerk and signatory", "Return to collect"] },
  FEE_RECEIPT: { hops: 2, touches: 2, officeVisits: 1, oldPath: ["Accounts office queue", "Clerk reprints"] }
};

export const FEE_RECEIPT_BASELINE = { workflow: "FEE_RECEIPT", task: "Get a copy of a fee receipt", oldProcess: "Queue at the accounts office; the clerk reprints it", hours: 24, studentActions: 2, studentMinutes: 45 };

const hoursBetween = (a, b) => (new Date(b) - new Date(a)) / 3600000;

/** Pure: one request's friction from its own events (sorted or not). */
export function requestFriction(events, { subjectType, baseline }) {
  const spec = REQUEST_TYPES[subjectType];
  const sorted = [...events].sort((a, b) => new Date(a.at) - new Date(b.at));
  const start = sorted.find((e) => spec.start.includes(e.type)) || sorted[0];
  const end = sorted.find((e) => spec.end.includes(e.type) && new Date(e.at) >= new Date(start?.at || 0));
  const staff = sorted.filter((e) => e.humanTouch);
  const holders = new Set(staff.map((e) => e.actorName || e.actorRole));
  // A request the policy sent to a person, or one assigned to a department, has at least that hand-off.
  if (!holders.size && sorted.some((e) => e.type === "COMPLAINT_ASSIGNED")) holders.add(sorted.find((e) => e.type === "COMPLAINT_ASSIGNED").department || "department");
  const channel = start?.channel || "APP";
  const policy = sorted.some((e) => e.channel === "POLICY" && spec.end.concat(["POLICY_DECISION"]).includes(e.type)) && !staff.length;
  const visitAvoided = channel !== "KIOSK" && (baseline?.officeVisits || 0) > 0;
  return {
    subjectType,
    subjectId: start?.subjectId,
    reference: start?.subjectRef,
    workflow: spec.workflow,
    startedAt: start?.at || null,
    closedAt: end?.at || null,
    hoursToOutcome: start && end ? round(hoursBetween(start.at, end.at), 2) : null,
    handoffs: holders.size,
    humanTouches: staff.length,
    channel,
    decidedByPolicy: policy,
    visitAvoided,
    cohort: sorted.find((e) => e.cohort?.hostel)?.cohort || null,
    week: start ? isoWeek(start.at) : null
  };
}

/** "2026-W39" of a date (ISO week). */
export function isoWeek(at) {
  const d = new Date(Date.UTC(new Date(at).getUTCFullYear(), new Date(at).getUTCMonth(), new Date(at).getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 864e5 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Pure: totals for a list of per-request rows against their baselines. */
export function summarise(rows, baselines) {
  const closed = rows.filter((r) => r.hoursToOutcome !== null);
  const byWorkflow = (w) => baselines.get(w);
  const visits = rows.filter((r) => r.visitAvoided).reduce((t, r) => t + (byWorkflow(r.workflow)?.officeVisits || 0), 0);
  const minutesReturned = rows.filter((r) => r.visitAvoided).reduce((t, r) => t + (byWorkflow(r.workflow)?.studentMinutes || 0), 0);
  // Touches and hand-offs are averaged over closed requests: an open one has not been worked yet.
  const mean = (list, fn) => (list.length ? round(list.reduce((t, r) => t + fn(r), 0) / list.length, 2) : null);
  const touchesNow = mean(closed, (r) => r.humanTouches);
  const touchesOld = mean(closed, (r) => byWorkflow(r.workflow)?.touches ?? 0);
  return {
    requests: rows.length,
    closed: closed.length,
    medianHours: closed.length ? round(median(closed.map((r) => r.hoursToOutcome)), 2) : null,
    baselineMedianHours: rows.length ? round(median(rows.map((r) => byWorkflow(r.workflow)?.hours).filter((h) => h !== undefined)), 2) : null,
    handoffsNow: mean(closed, (r) => r.handoffs),
    handoffsOld: mean(closed, (r) => byWorkflow(r.workflow)?.hops ?? 0),
    touchesPerRequestNow: touchesNow,
    touchesPerRequestOld: touchesOld,
    zeroTouch: rows.filter((r) => r.humanTouches === 0 && r.hoursToOutcome !== null).length,
    officeVisitsAvoided: visits,
    studentHoursReturned: round(minutesReturned / 60, 1)
  };
}

const groupBy = (rows, key) => {
  const out = new Map();
  for (const r of rows) {
    const k = key(r) ?? "—";
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(r);
  }
  return out;
};

export async function baselineMap() {
  await ensureBaselines();
  if (!(await FrictionBaseline.exists({ workflow: FEE_RECEIPT_BASELINE.workflow }))) {
    await FrictionBaseline.create({ ...FEE_RECEIPT_BASELINE, source: "Team estimate — not a measurement", ...OLD_PATHS.FEE_RECEIPT });
  }
  const rows = await FrictionBaseline.find().lean();
  // Rows written before the old-path fields existed read the defaults above.
  return new Map(rows.map((b) => [b.workflow, { ...OLD_PATHS[b.workflow], ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && !v.length))) }]));
}

/** Per-request rows for requests filed in the window. */
export async function requestRows({ days = 30, now = new Date(), studentId } = {}) {
  const since = new Date(now - days * 864e5);
  const starts = await CampusEvent.find({ type: { $in: Object.values(REQUEST_TYPES).flatMap((t) => t.start) }, at: { $gte: since }, ...(studentId ? { studentId } : {}) }).select("subjectId subjectType").lean();
  const ids = [...new Set(starts.map((e) => e.subjectId))];
  const events = await CampusEvent.find({ subjectId: { $in: ids } }).lean();
  const baselines = await baselineMap();
  const bySubject = groupBy(events, (e) => e.subjectId);
  const rows = [];
  for (const [, list] of bySubject) {
    const subjectType = list[0].subjectType;
    if (!REQUEST_TYPES[subjectType]) continue;
    rows.push(requestFriction(list, { subjectType, baseline: baselines.get(REQUEST_TYPES[subjectType].workflow) }));
  }
  return { rows, baselines, since };
}

/** Page 10 — the Friction Ledger panel. */
export async function frictionLedger({ days = 30, now = new Date() } = {}) {
  const { rows, baselines, since } = await requestRows({ days, now });
  const summary = summarise(rows, baselines);
  const cut = (key, label) =>
    [...groupBy(rows, key)].map(([value, list]) => ({ [label]: value, ...summarise(list, baselines) })).sort((a, b) => String(a[label]).localeCompare(String(b[label])));
  return {
    window: { days, since },
    totals: summary,
    byType: Object.values(REQUEST_TYPES).map((spec) => {
      const list = rows.filter((r) => r.workflow === spec.workflow);
      const b = baselines.get(spec.workflow);
      return { workflow: spec.workflow, label: spec.label, ...summarise(list, baselines), baseline: b ? { hours: b.hours, hops: b.hops, touches: b.touches, officeVisits: b.officeVisits, studentMinutes: b.studentMinutes, oldPath: b.oldPath, source: b.source, kind: "ASSUMPTION" } : null };
    }),
    byWeek: cut((r) => r.week, "week"),
    byHostel: cut((r) => r.cohort?.hostel, "hostel"),
    byBranch: cut((r) => r.cohort?.branch, "branch"),
    byYear: cut((r) => r.cohort?.year, "year"),
    byChannel: cut((r) => r.channel, "channel"),
    definitions: {
      hoursToOutcome: "First request event to first outcome event in the Campus Event log (ACTUAL DATA).",
      handoffs: "Distinct people or offices that acted on the request after it was filed (ACTUAL DATA).",
      humanTouches: "Events on the request by staff, excluding POLICY decisions (ACTUAL DATA). Touches and hand-offs per request are averaged over closed requests.",
      baseline: "The old paper path per request type — hops, touches, visits and time — is an ASSUMPTION with its stated source, editable on this page.",
      officeVisitsAvoided: "ESTIMATE: requests filed from the app or by SMS × the office visits the old path needed.",
      studentHoursReturned: "ESTIMATE: requests that avoided a visit × the baseline minutes of the student's own time, ÷ 60."
    },
    insufficient: rows.length < 5 ? "Insufficient data — fewer than 5 requests in the window." : null,
    method: "CAMPUS_EVENT_LOG_VS_BASELINE",
    kind: rows.length < 5 ? "INSUFFICIENT DATA" : "ACTUAL DATA"
  };
}

/** Page 01 — the Friction Map, measured: old path (ASSUMPTION) vs new path (ACTUAL DATA). Public, no names. */
export async function publicFrictionMap({ days = 30 } = {}) {
  const { rows, baselines } = await requestRows({ days });
  const complaintRows = rows.filter((r) => r.workflow === "COMPLAINT");
  const all = summarise(rows, baselines);
  const complaints = summarise(complaintRows, baselines);
  const old = baselines.get("COMPLAINT");
  return {
    window: { days },
    old: { hops: old?.hops ?? null, hours: old?.hours ?? null, path: old?.oldPath || [], kind: "ASSUMPTION", source: old?.source || null },
    now: {
      requests: all.requests,
      closed: all.closed,
      medianHours: all.medianHours,
      complaintMedianHours: complaints.medianHours,
      handoffs: all.handoffsNow,
      touchesPerRequest: all.touchesPerRequestNow,
      zeroTouch: all.zeroTouch,
      officeVisitsAvoided: all.officeVisitsAvoided,
      kind: rows.length < 5 ? "INSUFFICIENT DATA" : "ACTUAL DATA"
    },
    method: "CAMPUS_EVENT_LOG_VS_BASELINE"
  };
}

/** Page 02 — "Time you saved this month" for one student. */
export async function mySavings(student, { now = new Date() } = {}) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 330 * 60000);
  const days = Math.max(1, (now - monthStart) / 864e5);
  const { rows, baselines } = await requestRows({ days, now, studentId: student._id });
  const s = summarise(rows, baselines);
  return {
    month: now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", month: "long", year: "numeric" }),
    requests: s.requests,
    officeVisitsAvoided: s.officeVisitsAvoided,
    hoursSaved: s.studentHoursReturned,
    kind: s.requests ? "ESTIMATE" : "INSUFFICIENT DATA",
    basis: "Your requests filed from the app or by SMS this month × the minutes the old office process takes (ASSUMPTION, page 10 baselines).",
    method: "CAMPUS_EVENT_LOG_VS_BASELINE"
  };
}
