import { SAFETY_CRITICAL_PATTERNS } from "../../config/constants.js";
import { Building } from "../../models/Building.js";
import { GatePass } from "../../models/GatePass.js";
import { Intervention } from "../../models/Intervention.js";
import { Notification } from "../../models/Notification.js";
import { User } from "../../models/User.js";
import { ClassChange } from "../../models/ext/ClassChange.js";
import { ClassSchedule } from "../../models/ext/ClassSchedule.js";
import { Notice } from "../../models/ext/Notice.js";
import { NoticeReceipt } from "../../models/ext/NoticeReceipt.js";
import { SmsMessage } from "../../models/ext/SmsMessage.js";
import { CampusEvent } from "../../models/xo/CampusEvent.js";
import { ChangeEvent } from "../../models/xo/ChangeEvent.js";
import { SmsOutbox } from "../../models/xo/SmsOutbox.js";
import { decideEscalation } from "../escalationService.js";
import { slaForecast } from "../operationsIntelligenceService.js";
import { pendingQueue } from "../ext/requestTrackerService.js";
import { istDateKey, weekdayOf } from "../ext/istTime.js";
import { serviceEquity } from "../proof/equity.js";
import { interventionImpact } from "../proof/impactProof.js";
import { previewClassChange } from "../proof/preflight.js";
import { falseClosures } from "./closureService.js";
import { similarOpenIncident } from "./deflectionService.js";
import { frictionLedger } from "./ledgerService.js";
import { reachFunnel } from "./reachService.js";
import { activeRules, exceptionsInbox, preview, touchlessRate } from "./touchlessService.js";

/**
 * The 30-second proof reel (see CHANGES-REEL.md): one read-only aggregate of
 * ten scenes, each built by calling the service a page already uses. Nothing
 * here writes — previews are dry runs, the impact proof runs with
 * remember:false, and gate passes are read without reconcile(). Each scene is
 * computed on its own; one that fails is returned as INSUFFICIENT DATA with its
 * error and never fails the reel. Aggregates and references only: no student
 * names, and no array the reel draws from is longer than three entries, so the
 * ?lite=1 trim never changes what is shown.
 */

export const DEMO_STUDENT_EMAIL = "pritish@bput.ac.in";
export const SAFETY_SAMPLE = "sparks from the switchboard";
export const DUPLICATE_SAMPLE = "tap leaking in B-214";
const DAY = 864e5;

const nowIst = (offsetDays = 0, from = new Date()) => istDateKey(new Date(from.getTime() + offsetDays * DAY));
const nextOn = (weekday, fromDays, now) => {
  for (let i = fromDays; i < fromDays + 14; i += 1) if (weekdayOf(nowIst(i, now)) === weekday) return nowIst(i, now);
  return nowIst(fromDays, now);
};
const countBy = (list, key) => list.reduce((t, x) => ({ ...t, [key(x)]: (t[key(x)] || 0) + 1 }), {});
const sms = (s) => String(s || "").slice(0, 160);

async function demoStudent() {
  const user = await User.findOne({ email: DEMO_STUDENT_EMAIL, role: "STUDENT" });
  if (!user) throw new Error(`The seeded demo student (${DEMO_STUDENT_EMAIL}) is not in this database`);
  return user;
}

// 1 · Bonafide certificate — the written rule decides (dry run: nothing is filed).
async function certificate() {
  const verdict = await preview(await demoStudent(), { type: "BONAFIDE_CERTIFICATE" });
  const rows = [...(verdict.passedConditions || []), ...(verdict.failedConditions || [])];
  return {
    kind: verdict.kind,
    source: "POST /api/xo/policy/preview",
    data: {
      decision: verdict.decision,
      section: verdict.citation?.section || null,
      passed: (verdict.passedConditions || []).length,
      total: rows.length,
      // One tick per condition, in the rule's own order; object keyed by position so ?lite=1 never trims it.
      conditions: Object.fromEntries(rows.map((c, i) => [i, { label: c.label, passed: c.passed }])),
      failed: verdict.failedConditions?.[0]?.explanation || null,
      staffTouches: 0,
      dryRun: true
    }
  };
}

// 2 · A duplicate report — the open incident is offered while the student types.
async function duplicate() {
  const hostelB = await Building.findOne({ code: "HST-B" }).select("code").lean();
  const r = await similarOpenIncident(await demoStudent(), { text: DUPLICATE_SAMPLE, buildingCode: hostelB?.code });
  const m = r.match;
  if (!m) return { kind: "INSUFFICIENT DATA", source: "POST /api/xo/report/similar", data: { match: false, text: r.planned?.text || r.reason || `No open incident matches “${DUPLICATE_SAMPLE}”.` } };
  return {
    kind: r.kind || "ACTUAL DATA",
    source: "POST /api/xo/report/similar",
    data: { match: true, typed: DUPLICATE_SAMPLE, reference: m.reference, reports: m.reports, followers: m.followers, assignedTo: m.assignedTo, eta: { p50Hours: m.eta?.p50Hours ?? null, p80Hours: m.eta?.p80Hours ?? null, text: m.eta?.text || null, kind: m.eta?.kind || "INSUFFICIENT DATA" } }
  };
}

// 3 · Safety wording — the deterministic rule, run on a sample sentence (no complaint is saved).
async function safety() {
  const d = decideEscalation({ text: SAFETY_SAMPLE, basePriority: "LOW" });
  return {
    kind: "SIMULATED",
    source: "SAFETY_CRITICAL_PATTERNS · escalationService",
    data: {
      sample: SAFETY_SAMPLE,
      groups: SAFETY_CRITICAL_PATTERNS.length,
      ids: Object.fromEntries(SAFETY_CRITICAL_PATTERNS.map((p, i) => [i, p.id])),
      priority: d.priority,
      rule: d.safetyMatches[0]?.id || d.rule,
      decidedBy: d.rule,
      modelCanLower: false
    }
  };
}

// 4 · False closures, and did the Hostel B pump fix work?
async function provenFix() {
  const closures = await falseClosures();
  const hostelB = await Building.findOne({ code: "HST-B" }).select("_id").lean();
  const pump = (hostelB && (await Intervention.findOne({ status: "COMPLETED", building: hostelB._id }).sort({ "outcome.completedAt": 1 }).select("_id reference").lean())) || (await Intervention.findOne({ status: "COMPLETED" }).sort({ "outcome.completedAt": 1 }).select("_id reference").lean());
  const impact = pump ? await interventionImpact(pump._id, { remember: false }) : null;
  const flag = closures.flags[0];
  return {
    kind: closures.kind,
    source: "GET /api/xo/closures · GET /api/interventions/:id/impact",
    data: {
      flagged: closures.totals.flagged,
      total: closures.totals.resolved,
      firstRule: flag?.reasons?.[0]?.rule || null,
      firstText: flag?.reasons?.[0]?.text || null,
      fix: impact
        ? { reference: impact.intervention?.reference, building: impact.treated?.name || null, verdict: impact.verdict || null, low: impact.interval?.low ?? null, estimate: impact.did ?? null, high: impact.interval?.high ?? null, level: impact.interval?.level ?? null, avoided: impact.complaintsAvoided ?? null, text: impact.text, kind: impact.kind }
        : { verdict: null, text: "No completed intervention to measure.", kind: "INSUFFICIENT DATA" }
    }
  };
}

// 5 · A class change → its notice → attendance, plus a pre-flight of a sample reschedule (dry run).
async function classChange({ now }) {
  const latest = await ChangeEvent.findOne({ type: { $in: ["CLASS_CANCEL", "CLASS_RESCHEDULE", "CLASS_ROOM"] } }).sort({ createdAt: -1 }).select("reference type title notice effects.recipients effects.attendance.students").lean();
  let preflight = null;
  const [schedules, changes] = await Promise.all([ClassSchedule.find({ startTime: { $lt: "12:00" }, weekday: { $ne: 3 } }).sort({ weekday: 1, startTime: 1 }).lean(), ClassChange.find().select("schedule sessionDate").lean()]);
  const taken = new Set(changes.map((c) => `${c.schedule}|${c.sessionDate}`));
  // The same sample the proof demo uses: a morning class moved into Wednesday's lunch hour.
  outer: for (const sc of schedules) {
    for (let from = 1; from < 22; from += 7) {
      const sessionDate = nextOn(sc.weekday, from, now);
      if (taken.has(`${sc._id}|${sessionDate}`)) continue;
      const r = await previewClassChange({ scheduleId: String(sc._id), sessionDate, type: "RESCHEDULE", newDate: nextOn(3, from, now), newStartTime: "13:00" }, { now });
      const att = r.lines.find((l) => l.section === "ATTENDANCE");
      const mess = r.lines.find((l) => l.section === "MESS");
      const affected = r.lines.find((l) => l.section === "AFFECTED");
      preflight = { change: `${r.change.subject} ${r.change.cohort} → ${r.change.newSlot}`, students: affected?.rows?.length ?? null, atEdge: att?.rows?.length ?? 0, lunchClash: Boolean(mess && mess.severity === "WARN"), messText: mess?.severity === "WARN" ? mess.text : null, writes: r.writes, kind: r.kind };
      break outer;
    }
  }
  if (!latest && !preflight) return { kind: "INSUFFICIENT DATA", source: "GET /api/xo/changes", data: { text: "No class change on record." } };
  return {
    kind: latest ? "ACTUAL DATA" : "SIMULATED",
    source: "GET /api/xo/changes · POST /api/changes/preview",
    data: {
      change: latest ? { reference: latest.reference, title: latest.title, notice: latest.notice?.reference || null, recipients: latest.effects?.recipients ?? null, projections: latest.effects?.attendance?.students ?? null } : null,
      preflight
    }
  };
}

// 6 · A notice's reach: funnel, ladder rungs and the morning-digest hold.
async function noticeReach() {
  const notice = (await Notice.findOne({ status: "PUBLISHED", "reachTarget.deadline": { $exists: true } }).sort({ publishedAt: -1 }).select("_id").lean()) || (await Notice.findOne({ status: "PUBLISHED" }).sort({ publishedAt: -1 }).select("_id").lean());
  if (!notice) return { kind: "INSUFFICIENT DATA", source: "GET /api/xo/notices/:id/reach", data: { text: "No published notice." } };
  const [r, acknowledged, done, held] = await Promise.all([
    reachFunnel(notice._id),
    NoticeReceipt.countDocuments({ notice: notice._id, acknowledgedAt: { $ne: null } }),
    NoticeReceipt.countDocuments({ notice: notice._id, actionDoneAt: { $ne: null } }),
    Notice.countDocuments({ status: "HELD_QUIET_HOURS" })
  ]);
  const f = r.funnel;
  const pct = (x) => (f.targeted ? Math.round((x / f.targeted) * 1000) / 10 : null);
  const rung = Object.fromEntries(r.ladder.map((l) => [l.rung, l.recipients]));
  return {
    kind: r.kind,
    source: "GET /api/xo/notices/:id/reach",
    data: {
      reference: r.notice.reference,
      title: r.notice.title,
      targeted: f.targeted,
      funnel: { delivered: f.pct.delivered, read: f.pct.read, acknowledged: pct(acknowledged), done: pct(done) },
      unread: f.unreached,
      ladder: { SMS: rung.SMS ?? 0, CLASS_REP: rung.CLASS_REP ?? 0, KIOSK: rung.KIOSK ?? 0 },
      digestHeld: held
    }
  };
}

// 7 · Gate pass: the written rules, and the latest pass's own log (roles only).
async function gatePass() {
  const rules = (await activeRules("GATE_PASS")).filter((r) => r.action === "AUTO_APPROVE");
  const pass = (await GatePass.findOne({ status: "OVERDUE" }).sort({ updatedAt: -1 }).select("reference status decidedBy policyDecision.citation events").lean()) || (await GatePass.findOne({ decidedBy: "POLICY" }).sort({ updatedAt: -1 }).select("reference status decidedBy policyDecision.citation events").lean()) || (await GatePass.findOne().sort({ updatedAt: -1 }).select("reference status decidedBy policyDecision.citation events").lean());
  const alerts = pass ? await Notification.find({ gatePass: pass._id, kind: "GATE_PASS_OVERDUE" }).select("audience").lean() : [];
  const audiences = countBy(alerts, (a) => a.audience);
  const sections = [...new Set(rules.map((r) => r.citation?.section).filter(Boolean))].sort();
  return {
    kind: "ACTUAL DATA",
    source: "GET /api/xo/policy/rules · gate-pass log",
    data: {
      sections: sections.join(" / "),
      rules: rules.length,
      conditions: rules.reduce((t, r) => t + (r.conditions || []).length, 0),
      latest: pass ? { reference: pass.reference, status: pass.status, decidedBy: pass.decidedBy || "HUMAN", section: pass.policyDecision?.citation?.section || null, logEntries: (pass.events || []).length } : null,
      // Roles alerted for this pass, from its notifications (STUDENT / WARDEN / ADMIN / PARENT). Empty when it never went overdue.
      alerted: audiences
    }
  };
}

// 8 · No smartphone: the SMS lines as stored, and kiosk requests with their operator.
async function noSmartphone() {
  const [complaint, staffDone, asked, yes, kiosk, kioskNamed] = await Promise.all([
    SmsMessage.findOne({ command: "COMPLAINT", outcome: "OK" }).sort({ createdAt: -1 }).select("body reply").lean(),
    SmsMessage.findOne({ command: "DONE", outcome: "OK" }).sort({ createdAt: -1 }).select("body reply relatedRef").lean(),
    SmsOutbox.findOne({ purpose: "FIX_CHECK" }).sort({ createdAt: -1 }).select("body relatedRef").lean(),
    SmsMessage.findOne({ command: "CONFIRM_YES" }).sort({ createdAt: -1 }).select("body reply").lean(),
    CampusEvent.countDocuments({ channel: "KIOSK" }),
    CampusEvent.countDocuments({ channel: "KIOSK", actorName: { $nin: [null, ""] } })
  ]);
  const lines = {};
  if (complaint) Object.assign(lines, { 1: { from: "STUDENT", text: sms(complaint.body) }, 2: { from: "CAMPUS", text: sms(complaint.reply) } });
  if (staffDone) lines[3] = { from: "STAFF", text: sms(staffDone.body) };
  if (asked) lines[4] = { from: "CAMPUS", text: sms(asked.body) };
  if (yes) Object.assign(lines, { 5: { from: "STUDENT", text: sms(yes.body) } });
  // With no SMS work loop on record yet, the latest keyword answer stands in — still a stored message, never a made-up one.
  if (!Object.keys(lines).length) {
    const latest = await SmsMessage.findOne({ outcome: "OK", student: { $ne: null } }).sort({ createdAt: -1 }).select("body reply").lean();
    if (latest) Object.assign(lines, { 1: { from: "STUDENT", text: sms(latest.body) }, 2: { from: "CAMPUS", text: sms(latest.reply) } });
  }
  return {
    kind: Object.keys(lines).length || kiosk ? "SIMULATED" : "INSUFFICIENT DATA",
    source: "SMS log · GET /api/xo/sms/outbox · GET /api/xo/events/summary",
    data: { lines, smsLabel: "SIMULATED SMS", loop: Boolean(complaint && staffDone && asked && yes), kiosk, kioskOperatorRecorded: kioskNamed }
  };
}

// 9 · What staff see: exceptions only, ageing, SLA breaches and the equity check.
async function adminView({ now }) {
  const [inbox, rate, queue, sla, equity] = await Promise.all([exceptionsInbox({ now }), touchlessRate({ now }), pendingQueue({ now }), slaForecast({ limit: 1 }), serviceEquity({ now })]);
  return {
    kind: "ACTUAL DATA",
    source: "GET /api/xo/policy/exceptions · touchless-rate · /api/requests/pending · /api/admin/equity",
    data: {
      exceptions: inbox.counts.exceptions,
      fyi: inbox.counts.fyi,
      touchlessPct: rate.ratePct ?? null,
      touchlessClosed: rate.closed ?? null,
      pending: queue.total,
      buckets: Object.fromEntries(queue.buckets.map((b) => [b.bucket, b.count])),
      slaBreached: sla.counts.BREACHED,
      equityGap: (equity.flagged || []).length > 0,
      equityHeadline: equity.headline
    }
  };
}

// 10 · The ledger, per request type: now (event log) vs the old path (assumption).
async function ledger({ now }) {
  const l = await frictionLedger({ now });
  const types = Object.fromEntries(
    l.byType.map((t) => [t.workflow, { label: t.label, closed: t.closed, nowHours: t.medianHours, oldHours: t.baseline?.hours ?? null, touchesNow: t.touchesPerRequestNow, touchesOld: t.baseline?.touches ?? null }])
  );
  return { kind: l.kind, source: "GET /api/xo/ledger", data: { types, nowKind: "ACTUAL DATA", nowNote: "seeded DEMO DATA", oldKind: "ASSUMPTION", windowDays: l.window.days } };
}

export const REEL_SCENES = [
  ["certificate", certificate],
  ["duplicate", duplicate],
  ["safety", safety],
  ["provenFix", provenFix],
  ["classChange", classChange],
  ["noticeReach", noticeReach],
  ["gatePass", gatePass],
  ["noSmartphone", noSmartphone],
  ["adminView", adminView],
  ["ledger", ledger]
];

/** GET /api/xo/reel — all ten scenes, computed independently. Writes nothing. */
export async function proofReel({ now = new Date() } = {}) {
  const scenes = [];
  for (const [key, build] of REEL_SCENES) {
    try {
      scenes.push({ key, ...(await build({ now })) });
    } catch (error) {
      scenes.push({ key, kind: "INSUFFICIENT DATA", source: "—", error: String(error.message || error).slice(0, 200) });
    }
  }
  return { generatedAt: now, scenes, method: "EXISTING_SERVICES_READ_ONLY", note: "Every figure is read from the live database at request time; previews are dry runs and nothing is written." };
}
