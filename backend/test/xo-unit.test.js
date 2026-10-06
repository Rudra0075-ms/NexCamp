/**
 * The Exception-Only Campus — unit tests (no database needed).
 *
 * Phase 0  median response time verdict (ACTUAL DATA vs ASSUMPTION)
 * Phase 1  event building, human-touch rule, backfill derivation
 */
import assert from "node:assert/strict";
import test from "node:test";

process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/test";
process.env.JWT_SECRET ||= "a-test-secret-that-is-long-enough-1234";

const stats = await import("../src/services/xo/responseStats.js");
const events = await import("../src/services/xo/eventService.js");
const backfill = await import("../src/services/xo/backfillService.js");

const oid = (n) => `64b000000000000000000${String(n).padStart(3, "0")}`;

// ---- Phase 0 -------------------------------------------------------------------------

test("median response: category history wins when it has enough samples", () => {
  const verdict = stats.medianVerdict([1, 2, 3, 4, 10], [1, 2, 3, 4, 10, 20, 30], { category: "WATER" });
  assert.equal(verdict.days, 3);
  assert.equal(verdict.kind, "ACTUAL DATA");
  assert.equal(verdict.samples, 5);
  assert.match(verdict.scope, /WATER/);
});

test("median response: falls back to campus-wide, then to the labelled 3.8-day ASSUMPTION", () => {
  const campus = stats.medianVerdict([1, 2], [1, 2, 3, 4, 5, 6], { category: "MESS" });
  assert.equal(campus.kind, "ACTUAL DATA");
  assert.equal(campus.days, 3.5);
  assert.match(campus.scope, /too few in this category/);
  const thin = stats.medianVerdict([], [2, 3]);
  assert.equal(thin.kind, "ASSUMPTION");
  assert.equal(thin.days, stats.ASSUMED_MEDIAN_DAYS);
  assert.equal(thin.days, 3.8);
  assert.match(thin.note, /Only 2 resolved/);
});

test("median of an even-length list averages the middle pair; empty is null", () => {
  assert.equal(stats.median([4, 1, 3, 2]), 2.5);
  assert.equal(stats.median([]), null);
});

// ---- Phase 1 -------------------------------------------------------------------------

test("an event is built with its channel, subject and the human-touch rule applied", () => {
  const e = events.buildEvent({ type: "GATEPASS_APPROVED", actor: { _id: oid(1), name: "Warden", role: "WARDEN" }, subjectType: "GatePass", subjectId: oid(2), subjectRef: "GP-1", student: oid(3), channel: "APP" });
  assert.equal(e.type, "GATEPASS_APPROVED");
  assert.equal(e.actorRole, "WARDEN");
  assert.equal(e.humanTouch, true);
  assert.equal(e.subjectId, oid(2));
  assert.equal(String(e.studentId), oid(3));
  assert.equal(e.origin, "LIVE");
});

test("a POLICY decision and a student action are never human touches", () => {
  assert.equal(events.isHumanTouch({ actorRole: "ADMIN", channel: "POLICY" }), false);
  assert.equal(events.isHumanTouch({ actorRole: "STUDENT", channel: "APP" }), false);
  assert.equal(events.isHumanTouch({ actorRole: "SYSTEM", channel: "SYSTEM" }), false);
  assert.equal(events.isHumanTouch({ actorRole: "FACILITY_MANAGER", channel: "SMS" }), true);
  const policy = events.buildEvent({ type: "POLICY_DECISION", actor: { role: "SYSTEM" }, subjectType: "DocumentRequest", subjectId: "x", channel: "POLICY" });
  assert.equal(policy.humanTouch, false);
});

test("an unknown event type or a missing subject is refused by the builder", () => {
  assert.throws(() => events.buildEvent({ type: "NOT_A_TYPE", subjectType: "X", subjectId: "1" }), /Unknown event type/);
  assert.throws(() => events.buildEvent({ type: "COMPLAINT_CREATED" }), /subjectType/);
});

test("an unknown channel is stored as APP rather than rejected", () => {
  assert.equal(events.buildEvent({ type: "COMPLAINT_CREATED", subjectType: "Complaint", subjectId: "1", channel: "PIGEON" }).channel, "APP");
});

test("emitting without a database connection resolves to null and never throws", async () => {
  const result = await events.emitEvent({ type: "COMPLAINT_CREATED", subjectType: "Complaint", subjectId: "1" });
  assert.equal(result, null);
  // a bad event is swallowed too
  assert.equal(await events.emitEvent({ type: "BOGUS" }), null);
  await events.flushEvents();
});

test("backfill derives a complaint's lifecycle from its stored fields and audit trail", () => {
  const at = new Date("2026-05-01T10:00:00Z");
  const c = {
    _id: oid(10), reference: "CMP-1801", student: { _id: oid(11), name: "A" }, department: "MAINTENANCE · PLUMBING", channel: "KIOSK", category: "WATER", status: "RESOLVED", createdAt: at,
    audit: [
      { at, actor: "A", message: "Report submitted" },
      { at: new Date(at.getTime() + 60000), actor: "classificationService", message: "rule-based classification: WATER / HIGH" },
      { at: new Date(at.getTime() + 1500000), actor: "system", message: "Assigned to MAINTENANCE · PLUMBING" }
    ],
    resolution: { resolvedAt: new Date(at.getTime() + 9 * 3600000), resolvedBy: oid(12), resolutionTimeHours: 9 }
  };
  const staffById = new Map([[oid(12), { name: "Plumber", role: "FACILITY_MANAGER" }]]);
  const out = backfill.complaintEvents(c, { staffById });
  assert.deepEqual(out.map((e) => e.type), ["COMPLAINT_CREATED", "COMPLAINT_CLASSIFIED", "COMPLAINT_ASSIGNED", "COMPLAINT_RESOLVED"]);
  assert.equal(out[0].channel, "KIOSK");
  const resolved = events.buildEvent(out[3]);
  assert.equal(resolved.humanTouch, true);
  assert.equal(resolved.actorName, "Plumber");
});

test("backfill maps a gate pass's event log to one event per stage, and marks a POLICY approval", () => {
  const t = (m) => new Date(Date.UTC(2026, 4, 1, 10, m));
  const g = {
    _id: oid(20), reference: "GP-1", student: oid(21), channel: "APP", createdAt: t(0), decidedBy: "POLICY", approval: { decidedByName: "Policy engine" },
    events: [
      { at: t(0), status: "PENDING_PARENT_VERIFICATION", actor: "S" },
      { at: t(1), status: "PENDING_PARENT_VERIFICATION", actor: "otpService" },
      { at: t(5), status: "PARENT_VERIFIED", actor: "otpService" },
      { at: t(5), status: "APPROVED", actor: "policyEngine" },
      { at: t(60), status: "ACTIVE", actor: "gate" },
      { at: t(200), status: "RETURNED", actor: "gate" }
    ]
  };
  const out = backfill.gatePassEvents(g);
  assert.deepEqual(out.map((e) => e.type), ["GATEPASS_APPLIED", "GATEPASS_OTP_VERIFIED", "GATEPASS_APPROVED", "GATEPASS_EXITED", "GATEPASS_RETURNED"]);
  const approved = events.buildEvent(out[2]);
  assert.equal(approved.channel, "POLICY");
  assert.equal(approved.humanTouch, false);
});

test("backfill reads a document's own history rows; a kiosk filing is not a decision touch", () => {
  const d = {
    _id: oid(30), reference: "DOC-1", student: oid(31), channel: "KIOSK", createdAt: new Date(),
    history: [
      { at: new Date(), action: "DOCUMENT_REQUESTED", actorName: "Operator", actorRole: "WARDEN" },
      { at: new Date(), action: "DOCUMENT_APPROVE", actorName: "Office", actorRole: "ADMIN" },
      { at: new Date(), action: "DOCUMENT_ISSUED", actorName: "Office", actorRole: "ADMIN" }
    ]
  };
  const out = backfill.documentEvents(d).map((e) => events.buildEvent(e));
  assert.deepEqual(out.map((e) => e.type), ["CERTIFICATE_REQUESTED", "CERTIFICATE_REVIEWED", "CERTIFICATE_ISSUED"]);
  assert.equal(out[0].channel, "KIOSK");
  assert.equal(out[0].humanTouch, false);
  assert.equal(out[1].humanTouch, true);
});

// ---- Phase 2 · policy engine -----------------------------------------------------------

const engine = await import("../src/services/xo/policyEngine.js");
const { DEFAULT_RULES } = await import("../src/services/xo/policyRules.js");
const facts = await import("../src/services/xo/policyFacts.js");
const decisionInfo = await import("../src/services/xo/decisionInfo.js");
const { touchlessRateFrom } = await import("../src/services/xo/touchlessService.js");

const live = (rules) => rules.map((r, i) => ({ ...r, version: 1, active: true, status: "ACTIVE", _id: `r${i}` }));
const RULES = live(DEFAULT_RULES);
const BONAFIDE_OK = { enrolled: true, overdueDues: 200, requestsLast30Days: 1, purposeVisa: false };

test("policy: an in-policy bonafide is approved with its rule, citation and every condition checked", () => {
  const v = engine.evaluate({ type: "BONAFIDE_CERTIFICATE", facts: BONAFIDE_OK }, RULES);
  assert.equal(v.decision, "AUTO_APPROVE");
  assert.equal(v.matchedRule.key, "BONAFIDE-INSTANT");
  assert.equal(v.citation.section, "§4.2");
  assert.equal(v.passedConditions.length, 3);
  assert.equal(v.failedConditions.length, 0);
  assert.equal(v.method, "DETERMINISTIC_POLICY_RULES");
});

test("policy: overdue dues above the limit route to a person and say what is missing", () => {
  const v = engine.evaluate({ type: "BONAFIDE_CERTIFICATE", facts: { ...BONAFIDE_OK, overdueDues: 18500 } }, RULES);
  assert.equal(v.decision, "ROUTE_TO_HUMAN");
  assert.equal(v.failedConditions.length, 1);
  assert.equal(v.failedConditions[0].field, "overdueDues");
  assert.match(v.failedConditions[0].explanation, /18500 is overdue/);
  assert.match(v.reason, /1 condition of §4.2 is not met/);
});

test("policy: an exception rule (visa use) overrides an otherwise passing request", () => {
  const v = engine.evaluate({ type: "BONAFIDE_CERTIFICATE", facts: { ...BONAFIDE_OK, purposeVisa: true } }, RULES);
  assert.equal(v.decision, "ROUTE_TO_HUMAN");
  assert.equal(v.matchedRule.key, "BONAFIDE-VISA-CHECK");
  assert.equal(v.citation.section, "§4.3");
});

test("policy: a missing fact never approves — it is Insufficient data and goes to a person", () => {
  const v = engine.evaluate({ type: "BONAFIDE_CERTIFICATE", facts: { enrolled: true, overdueDues: null, requestsLast30Days: 0, purposeVisa: false } }, RULES);
  assert.equal(v.decision, "ROUTE_TO_HUMAN");
  assert.equal(v.failedConditions[0].missing, true);
  assert.match(v.failedConditions[0].explanation, /Insufficient data/);
});

test("policy: no active rule for a type means a person decides; drafts and retired rules are ignored", () => {
  const drafts = DEFAULT_RULES.map((r) => ({ ...r, active: false, status: "DRAFT" }));
  const v = engine.evaluate({ type: "BONAFIDE_CERTIFICATE", facts: BONAFIDE_OK }, drafts);
  assert.equal(v.decision, "ROUTE_TO_HUMAN");
  assert.equal(v.matchedRule, null);
  assert.match(v.reason, /No active policy rule/);
});

test("policy: the newest active version of a rule wins", () => {
  const v1 = { ...RULES[0], version: 1 };
  const v2 = { ...RULES[0], version: 2, conditions: [{ field: "enrolled", op: "isTrue", value: true, label: "Enrolled" }] };
  const v = engine.evaluate({ type: "BONAFIDE_CERTIFICATE", facts: { ...BONAFIDE_OK, overdueDues: 50000 } }, [v1, v2]);
  assert.equal(v.decision, "AUTO_APPROVE");
  assert.equal(v.matchedRule.version, 2);
});

test("policy: a day outing after guardian confirmation is approved; the guardian step is a hard condition", () => {
  const ok = { guardianOtpVerified: true, leadTimeHours: 20, durationHours: 4, returnBeforeCutoff: true, lateReturnsLast30Days: 0 };
  assert.equal(engine.evaluate({ type: "GATE_PASS", facts: ok }, RULES).decision, "AUTO_APPROVE");
  const noGuardian = engine.evaluate({ type: "GATE_PASS", facts: { ...ok, guardianOtpVerified: false } }, RULES);
  assert.equal(noGuardian.decision, "ROUTE_TO_HUMAN");
  assert.equal(noGuardian.failedConditions[0].field, "guardianOtpVerified");
  const late = engine.evaluate({ type: "GATE_PASS", facts: { ...ok, lateReturnsLast30Days: 2, leadTimeHours: 1 } }, RULES);
  assert.deepEqual(late.failedConditions.map((c) => c.field).sort(), ["lateReturnsLast30Days", "leadTimeHours"]);
});

test("policy: every operator behaves as written", () => {
  const f = { n: 5, s: "A", b: true };
  const c = (op, field, value) => engine.checkCondition({ field, op, value }, f).passed;
  assert.equal(c("eq", "n", 5), true);
  assert.equal(c("neq", "n", 5), false);
  assert.equal(c("lt", "n", 6), true);
  assert.equal(c("lte", "n", 5), true);
  assert.equal(c("gt", "n", 5), false);
  assert.equal(c("gte", "n", 5), true);
  assert.equal(c("in", "s", ["A", "B"]), true);
  assert.equal(c("nin", "s", ["A"]), false);
  assert.equal(c("isTrue", "b"), true);
  assert.equal(c("isFalse", "b"), false);
  assert.equal(c("bogus", "n", 1), false);
});

test("policy: the same input always gives the same verdict (deterministic, no clock)", () => {
  const a = JSON.stringify(engine.evaluate({ type: "FEE_RECEIPT_COPY", facts: { receiptOnLedger: true, copiesLast30Days: 0 } }, RULES));
  const b = JSON.stringify(engine.evaluate({ type: "FEE_RECEIPT_COPY", facts: { receiptOnLedger: true, copiesLast30Days: 0 } }, RULES));
  assert.equal(a, b);
});

test("policy: rule validation refuses a rule without a citation or with a malformed condition", () => {
  assert.deepEqual(engine.validateRule(DEFAULT_RULES[0]), []);
  const errors = engine.validateRule({ requestType: "GATE_PASS", action: "AUTO_APPROVE", conditions: [{ field: "x y", op: "lte", value: "abc" }], citation: {} });
  assert.ok(errors.some((e) => /field is not valid/.test(e)));
  assert.ok(errors.some((e) => /needs a number/.test(e)));
  assert.ok(errors.some((e) => /cite a written policy/.test(e)));
});

test("policy facts: gate-pass timing — lead time, duration and the 21:00 same-day cutoff (IST)", () => {
  const leave = new Date("2026-09-28T04:30:00Z"); // 10:00 IST
  const t = facts.gatePassTimingFacts({ leaveAt: leave, expectedReturnAt: new Date("2026-09-28T12:30:00Z"), appliedAt: new Date("2026-09-27T14:30:00Z") });
  assert.deepEqual([t.leadTimeHours, t.durationHours, t.returnBeforeCutoff, t.returnTimeIst], [14, 8, true, "18:00"]);
  const late = facts.gatePassTimingFacts({ leaveAt: leave, expectedReturnAt: new Date("2026-09-28T15:45:00Z"), appliedAt: leave });
  assert.equal(late.returnBeforeCutoff, false, "21:15 IST is after the cutoff");
  const overnight = facts.gatePassTimingFacts({ leaveAt: leave, expectedReturnAt: new Date("2026-09-29T04:00:00Z"), appliedAt: leave });
  assert.equal(overnight.returnBeforeCutoff, false, "returning the next day is not a day outing");
});

test("policy facts: overdue dues come from the fee ledger; no ledger is null (Insufficient data)", () => {
  const now = new Date("2026-09-26T00:00:00Z");
  const account = { heads: [{ head: "TUITION", amount: 1000, paid: 400, dueDate: new Date("2026-09-01") }, { head: "MESS", amount: 500, paid: 0, dueDate: new Date("2026-10-10") }] };
  assert.equal(facts.overdueFrom([account], now), 600);
  assert.equal(facts.overdueFrom([], now), null);
  assert.equal(facts.VISA_PATTERN.test("Student visa application"), true);
  assert.equal(facts.VISA_PATTERN.test("Bank loan"), false);
});

test("page 17: every request says who decided — written policy, a named person, or who it waits on", () => {
  const policy = decisionInfo.documentDecision({ status: "ISSUED", decidedBy: "POLICY", type: "BONAFIDE", policyDecision: { citation: { section: "§4.2" }, reason: "ok", passedConditions: [{ label: "Enrolled" }], failedConditions: [] } });
  assert.equal(policy.by, "POLICY");
  assert.equal(policy.name, "Written policy §4.2");
  assert.equal(policy.conditions[0].passed, true);
  const human = decisionInfo.gatePassDecision({ status: "APPROVED", decidedBy: "HUMAN", approval: { decision: "APPROVED", decidedByName: "Hostel B Warden", note: "Back early" } });
  assert.deepEqual([human.by, human.name, human.why], ["HUMAN", "Hostel B Warden", "Back early"]);
  const waiting = decisionInfo.gatePassDecision({ status: "PENDING_WARDEN_APPROVAL", policyDecision: { reason: "1 condition not met", failedConditions: [{ label: "Applied 2h ahead", explanation: "short notice" }] } });
  assert.equal(waiting.waitingOn, "Hostel warden");
  assert.equal(waiting.conditions[0].passed, false);
  assert.equal(decisionInfo.complaintDecision({ status: "ASSIGNED", department: "IT · NETWORK" }).waitingOn, "IT · NETWORK");
});

test("Touchless Rate: zero-touch closures over all closures, null when nothing closed", () => {
  assert.deepEqual(touchlessRateFrom([{ closed: 10, zeroTouch: 7 }, { closed: 10, zeroTouch: 3 }]), { closed: 20, zeroTouch: 10, ratePct: 50 });
  assert.equal(touchlessRateFrom([{ closed: 0, zeroTouch: 0 }]).ratePct, null);
});

// ---- Phase 3 · Friction Ledger ---------------------------------------------------------

const ledgerSvc = await import("../src/services/xo/ledgerService.js");
const etaSvc = await import("../src/services/xo/etaService.js");
const closure = await import("../src/services/xo/closureService.js");
const impactSvc = await import("../src/services/xo/impactService.js");
const assetSvc = await import("../src/services/xo/assetService.js");

const ev = (type, minutes, extra = {}) => ({ type, at: new Date(Date.UTC(2026, 8, 1, 10, minutes)), subjectId: "s1", subjectRef: "DOC-1", channel: "APP", humanTouch: false, ...extra });
const BASELINES = new Map([
  ["DOCUMENT", { hours: 48, hops: 3, touches: 3, officeVisits: 2, studentMinutes: 120 }],
  ["COMPLAINT", { hours: 72, hops: 6, touches: 4, officeVisits: 1, studentMinutes: 45 }]
]);

test("ledger: a policy-issued certificate has 0 touches, 0 hand-offs, its time to outcome, and a visit avoided", () => {
  const row = ledgerSvc.requestFriction([ev("CERTIFICATE_REQUESTED", 0), ev("POLICY_DECISION", 0, { channel: "POLICY" }), ev("CERTIFICATE_ISSUED", 1, { channel: "POLICY" })], { subjectType: "DocumentRequest", baseline: BASELINES.get("DOCUMENT") });
  assert.deepEqual([row.humanTouches, row.handoffs, row.hoursToOutcome, row.decidedByPolicy, row.visitAvoided], [0, 0, 0.02, true, true]);
});

test("ledger: a human path counts each staff touch and each distinct person as a hand-off; a kiosk filing avoids no visit", () => {
  const row = ledgerSvc.requestFriction(
    [ev("CERTIFICATE_REQUESTED", 0, { channel: "KIOSK" }), ev("CERTIFICATE_REVIEWED", 60, { humanTouch: true, actorName: "Clerk" }), ev("CERTIFICATE_ISSUED", 600, { humanTouch: true, actorName: "Registrar" })],
    { subjectType: "DocumentRequest", baseline: BASELINES.get("DOCUMENT") }
  );
  assert.deepEqual([row.humanTouches, row.handoffs, row.hoursToOutcome, row.visitAvoided], [2, 2, 10, false]);
});

test("ledger: totals — medians, touches per closed request now vs baseline, visits avoided and hours returned (ESTIMATE)", () => {
  const rows = [
    { workflow: "DOCUMENT", hoursToOutcome: 0, humanTouches: 0, handoffs: 0, visitAvoided: true },
    { workflow: "DOCUMENT", hoursToOutcome: 10, humanTouches: 2, handoffs: 2, visitAvoided: false },
    { workflow: "COMPLAINT", hoursToOutcome: null, humanTouches: 0, handoffs: 1, visitAvoided: true }
  ];
  const s = ledgerSvc.summarise(rows, BASELINES);
  assert.equal(s.requests, 3);
  assert.equal(s.closed, 2);
  assert.equal(s.medianHours, 5);
  assert.equal(s.touchesPerRequestNow, 1, "averaged over the 2 closed requests");
  assert.equal(s.touchesPerRequestOld, 3);
  assert.equal(s.officeVisitsAvoided, 3, "2 visits (certificate) + 1 (complaint)");
  assert.equal(s.studentHoursReturned, 2.8, "(120 + 45) minutes ÷ 60");
  assert.equal(s.zeroTouch, 1);
});

test("ledger: ISO weeks group requests by week", () => {
  assert.equal(ledgerSvc.isoWeek("2026-09-26T10:00:00Z"), "2026-W39");
  assert.equal(ledgerSvc.isoWeek("2026-01-01T10:00:00Z"), "2026-W01");
});

// ---- Phase 4 · ETA, false closure, asset history -----------------------------------------

test("ETA: P50 and P80 by linear interpolation; under 5 samples says Insufficient history", () => {
  assert.equal(etaSvc.percentile([1, 2, 3, 4, 5], 0.5), 3);
  assert.equal(etaSvc.percentile([1, 2, 3, 4, 5], 0.8), 4.2);
  const e = etaSvc.etaFrom([2, 4, 6, 8, 10, 30]);
  assert.deepEqual([e.p50Hours, e.p80Hours, e.kind, e.samples], [7, 10, "ACTUAL DATA", 6]);
  const thin = etaSvc.etaFrom([1, 2, 3, 4]);
  assert.equal(thin.kind, "INSUFFICIENT DATA");
  assert.equal(thin.p50Hours, null);
  assert.match(thin.text, /Insufficient history — 4 finished/);
  assert.equal(etaSvc.fmt(0.5), "30 min");
  assert.equal(etaSvc.fmt(72), "3 days");
});

test("false closure: the same room within 7 days, the same asset, or a Not fixed answer; never a different room", () => {
  const b = "bld1";
  const resolved = [
    { _id: "r1", reference: "CMP-1", location: "HOSTEL A · A-118", building: b, category: "WATER", department: "PLUMB", title: "Tap leak", description: "tap", resolution: { resolvedAt: new Date("2026-09-01") } },
    { _id: "r2", reference: "CMP-2", location: "HOSTEL B · Pump room", building: b, category: "WATER", department: "PLUMB", title: "No water", description: "booster pump 2 tripped", resolution: { resolvedAt: new Date("2026-09-01") } },
    { _id: "r3", reference: "CMP-3", location: "HOSTEL C · C-121", building: b, category: "ELECTRICITY", department: "ELEC", title: "Fan", description: "fan", resolution: { resolvedAt: new Date("2026-09-01") } },
    { _id: "r4", reference: "CMP-4", location: "HOSTEL A · A-212", building: b, category: "WATER", department: "PLUMB", title: "Basin", description: "blocked", resolution: { resolvedAt: new Date("2026-09-01") } }
  ];
  const later = [
    { _id: "l1", reference: "CMP-10", location: "HOSTEL A · A-118", building: b, category: "WATER", title: "Tap again", description: "leaking again", createdAt: new Date("2026-09-04") },
    { _id: "l2", reference: "CMP-11", location: "HOSTEL B · B-302", building: b, category: "WATER", title: "Dry taps", description: "booster pump 2 not running", createdAt: new Date("2026-09-06") },
    { _id: "l3", reference: "CMP-12", location: "HOSTEL A · A-212", building: b, category: "WATER", title: "Basin", description: "blocked", createdAt: new Date("2026-09-20") },
    { _id: "l4", reference: "CMP-13", location: "HOSTEL A · A-107", building: b, category: "WATER", title: "Other room", description: "leak", createdAt: new Date("2026-09-02") }
  ];
  const flags = closure.falseClosureFlags(resolved, later, [{ complaint: "r3", response: "NOT_FIXED", comment: "still broken" }], { assetKeywords: ["booster pump 2"] });
  assert.deepEqual(flags.map((f) => f.reference).sort(), ["CMP-1", "CMP-2", "CMP-3"]);
  assert.equal(flags.find((f) => f.reference === "CMP-1").reasons[0].rule, "CAME_BACK_WITHIN_7_DAYS");
  assert.match(flags.find((f) => f.reference === "CMP-2").reasons[0].text, /same asset/);
  assert.equal(flags.find((f) => f.reference === "CMP-3").reasons[0].rule, "NOT_FIXED_ANSWER");
  const rates = closure.reopenRates(resolved, flags);
  assert.deepEqual(rates.find((r) => r.department === "PLUMB"), { department: "PLUMB", resolved: 3, flagged: 2, ratePct: 66.7, kind: "INSUFFICIENT DATA" });
  assert.equal(closure.roomOf("HOSTEL B · FLOOR 2 · B-214"), "B-214");
});

test("before/after: complaints per week, median time to fix and reopen rate either side of a fix", () => {
  const fixAt = new Date("2026-08-01");
  const c = (d, hours, id) => ({ _id: id, createdAt: new Date(fixAt.getTime() + d * 864e5), resolution: hours === null ? undefined : { resolvedAt: new Date(fixAt.getTime() + d * 864e5 + hours * 3600000) } });
  const list = [c(-20, 10, "a"), c(-10, 30, "b"), c(-5, 20, "c"), c(3, 5, "d")];
  const before = impactSvc.windowStats(list, new Set(["b"]), new Date(fixAt - 28 * 864e5), fixAt);
  assert.deepEqual([before.complaints, before.perWeek, before.medianHoursToFix, before.reopenRatePct], [3, 0.75, 20, 33.3]);
  const tooShort = impactSvc.windowStats(list, new Set(), fixAt, new Date(fixAt.getTime() + 3 * 864e5));
  assert.equal(tooShort.perWeek, null, "fewer than 7 days after the fix is not a rate");
});

test("asset: replace when failures and repair spend cross the stated rule; the arithmetic is shown", () => {
  const replace = assetSvc.repairOrReplace({ failures12m: 5, typicalRepairCost: 14000, replacementCost: 85000, ageMonths: 41 });
  assert.equal(replace.action, "REPLACE");
  assert.equal(replace.kind, "RECOMMENDED ACTION");
  assert.match(replace.arithmetic, /₹70,000 — 82% of the ₹85,000/);
  assert.equal(assetSvc.repairOrReplace({ failures12m: 5, typicalRepairCost: 2000, replacementCost: 85000 }).action, "KEEP REPAIRING");
  assert.equal(assetSvc.repairOrReplace({ failures12m: 2, typicalRepairCost: 90000, replacementCost: 85000 }).action, "KEEP REPAIRING");
});

// ---- Phase 5 · guaranteed reach ---------------------------------------------------------

const reachSvc = await import("../src/services/xo/reachService.js");

test("reach ladder: rungs fall due at 0, 25, 50 and 75% of the window; a past deadline means every rung", () => {
  const from = new Date("2026-09-26T08:00:00Z");
  const to = new Date("2026-09-26T12:00:00Z");
  assert.deepEqual(reachSvc.dueRungs(from, to, new Date("2026-09-26T08:30:00Z")), ["IN_APP"]);
  assert.deepEqual(reachSvc.dueRungs(from, to, new Date("2026-09-26T09:00:00Z")), ["IN_APP", "SMS"]);
  assert.deepEqual(reachSvc.dueRungs(from, to, new Date("2026-09-26T10:30:00Z")), ["IN_APP", "SMS", "CLASS_REP"]);
  assert.deepEqual(reachSvc.dueRungs(from, to, new Date("2026-09-26T11:10:00Z")), ["IN_APP", "SMS", "CLASS_REP", "KIOSK"]);
  assert.equal(reachSvc.dueRungs(from, from, new Date()).length, 4);
});

test("reach funnel: delivered / read / acted / unreached from receipts", () => {
  const f = reachSvc.funnel([{ deliveredAt: 1, readAt: 1, actionDoneAt: 1 }, { deliveredAt: 1, readAt: 1 }, { deliveredAt: 1 }, {}]);
  assert.deepEqual([f.targeted, f.delivered, f.read, f.acted, f.unreached], [4, 3, 2, 1, 2]);
  assert.deepEqual(f.pct, { delivered: 75, read: 50, acted: 25, unreached: 50 });
  assert.equal(reachSvc.funnel([]).pct.read, null);
});

test("hygiene: the text's cohort is read, and a much broader audience is warned about", () => {
  const m = reachSvc.mentionedCohort("Water off in Hostel B for section A, 3rd year CSE students", { branches: ["CSE", "ECE"] });
  assert.deepEqual(m, { hostels: ["HOSTEL B"], sections: ["A"], years: [3], branches: ["CSE"] });
  const w = reachSvc.breadthWarning({ audienceCount: 900, mentionedCount: 130, mentioned: m });
  assert.match(w.text, /900 people, but the message is about HOSTEL B, section A, year 3, CSE \(130 people\)/);
  assert.equal(reachSvc.breadthWarning({ audienceCount: 150, mentionedCount: 130, mentioned: m }), null, "close enough is fine");
  assert.equal(reachSvc.breadthWarning({ audienceCount: 900, mentionedCount: null, mentioned: reachSvc.mentionedCohort("General notice") }), null);
});

// ---- Phase 6 · change propagation -------------------------------------------------------

const changeSvc = await import("../src/services/xo/changeService.js");

test("change: sessions left counts the subject's weekdays up to semester end, minus cancelled dates", () => {
  // 2026-09-28 is a Monday; Mondays and Wednesdays until 2026-10-09 → 28, 30 Sep, 5, 7 Oct = 4
  assert.equal(changeSvc.sessionsLeft([1, 3], "2026-09-28", "2026-10-09"), 4);
  assert.equal(changeSvc.sessionsLeft([1, 3], "2026-09-28", "2026-10-09", new Set(["2026-09-30"])), 3);
});

test("change: a cancellation already in the register moves the adjusted % (official record untouched)", () => {
  const record = { subject: "DBMS", attendedClasses: 9, totalClasses: 11, attendancePercentage: 81.8, sessions: [{ date: new Date("2026-09-21T02:30:00Z"), present: false, status: "ABSENT" }] };
  const e = changeSvc.attendanceEffect(record, { priorCancelled: new Set(), dateKey: "2026-09-21", weekdays: [1], todayKey: "2026-09-26", endKey: "2026-10-05" });
  assert.deepEqual([e.adjusted.before, e.adjusted.after, e.adjusted.changed, e.inRegister], [81.8, 90, true, true]);
  assert.match(changeSvc.effectSentence(e), /moves 81.8% → 90%/);
  assert.equal(record.attendancePercentage, 81.8, "the record itself is not modified");
});

test("change: a future cancellation leaves today's figure and lowers the best case", () => {
  const record = { subject: "OS", attendedClasses: 8, totalClasses: 10, sessions: [] };
  const e = changeSvc.attendanceEffect(record, { priorCancelled: new Set(), dateKey: "2026-09-28", weekdays: [1], todayKey: "2026-09-26", endKey: "2026-10-12" });
  assert.equal(e.adjusted.changed, false);
  assert.deepEqual([e.remaining.before, e.remaining.after], [3, 2]);
  assert.deepEqual([e.bestCase.before, e.bestCase.after], [84.6, 83.3]);
  assert.match(changeSvc.effectSentence(e), /3 → 2 classes left/);
});

test("change: menu demand estimate from uptake of new vs replaced items; thin history is Insufficient data", () => {
  const e = changeSvc.demandEstimate({ baselineDemand: 700, oldTaken: [50, 60, 55], newTaken: [66, 66, 70] });
  assert.equal(e.kind, "ESTIMATE");
  assert.equal(e.estimate, 840);
  assert.equal(e.deltaPct, 20);
  assert.equal(changeSvc.demandEstimate({ baselineDemand: 700, oldTaken: [50], newTaken: [60, 60, 60] }).kind, "INSUFFICIENT DATA");
});

// ---- Phase 7 · WhatsApp import ------------------------------------------------------------

const wa = await import("../src/services/xo/whatsappService.js");
const { readFileSync } = await import("node:fs");

test("WhatsApp: the Android format parses, with continuation lines and system lines dropped", () => {
  const p = wa.parseExport(["12/09/2026, 23:40 - Messages and calls are end-to-end encrypted.", "12/09/2026, 23:41 - Warden Sir: Water off tomorrow", "10 AM to 1 PM", "13/09/26, 7:05 am - Rahul Das: ok"].join("\n"));
  assert.equal(p.format, "ANDROID");
  assert.equal(p.messages.length, 2);
  assert.equal(p.messages[0].text, "Water off tomorrow\n10 AM to 1 PM");
  assert.equal(p.messages[0].at.toISOString(), "2026-09-12T18:11:00.000Z", "23:41 IST");
  assert.equal(p.messages[1].at.toISOString(), "2026-09-13T01:35:00.000Z", "7:05 am IST, two-digit year");
});

test("WhatsApp: the iOS format parses (seconds, AM/PM, bracketed stamp)", () => {
  const p = wa.parseExport("[25/08/26, 9:05:12 PM] Warden Sir (Hostel B): Attention: water off\n[26/08/26, 12:13:00 AM] Rahul Das: <Media omitted>");
  assert.equal(p.format, "IOS");
  assert.deepEqual(p.messages.map((m) => m.sender), ["Warden Sir (Hostel B)", "Rahul Das"]);
  assert.equal(p.messages[0].at.toISOString(), "2026-08-25T15:35:00.000Z");
  assert.equal(p.messages[1].at.toISOString(), "2026-08-25T18:43:00.000Z", "12:13 AM is 00:13");
});

test("WhatsApp: keyword rules label notices, complaints, questions, requests and noise", () => {
  const c = (sender, text) => wa.classifyMessage({ sender, text }).label;
  assert.equal(c("Academic Office", "All students are informed that the exam form must be submitted by 12 Sept."), "NOTICE");
  assert.equal(c("Rahul Das", "No water in 2nd floor washroom since morning"), "COMPLAINT");
  assert.equal(c("Rahul Das", "Is tomorrow's class cancelled?"), "QUESTION");
  assert.equal(c("Sneha Patnaik", "Sir please send the bonafide certificate format"), "REQUEST");
  assert.equal(c("Sneha Patnaik", "👍"), "NOISE");
  assert.equal(c("Warden Sir (Hostel B)", "Will check today"), "NOISE", "a staff acknowledgement is a reply, not a question");
});

test("WhatsApp report on the shipped samples: night notices, corrections, unacknowledged complaints, repeated questions", () => {
  for (const [file, expectFormat] of [["seed/sample-whatsapp-android.txt", "ANDROID"], ["seed/sample-whatsapp-ios.txt", "IOS"]]) {
    const parsed = wa.parseExport(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"));
    assert.equal(parsed.format, expectFormat);
    const msgs = parsed.messages.map((m) => ({ ...m, label: wa.classifyMessage(m).label || "NOISE" }));
    const r = wa.analyse(msgs);
    assert.ok(r.findings.nightNotices.count >= 1, `${file}: a notice after 23:00`);
    assert.ok(r.findings.superseded.count >= 1, `${file}: the DBMS correction`);
    assert.ok(r.findings.unacknowledged.count >= 1, `${file}: an unanswered complaint`);
    assert.ok(r.findings.repeatedQuestions.clusters.some((c) => /cancel/i.test(c.question)), `${file}: "is class cancelled?" asked repeatedly`);
    assert.ok(r.findings.nightNotices.evidence.every((e) => e.line > 0 && e.text), "every finding carries evidence lines");
  }
  assert.ok(readFileSync(new URL("../seed/sample-whatsapp-android.txt", import.meta.url), "utf8").split("\n").length >= 300);
});

test("WhatsApp CSV: a complaint diary becomes complaints; a gate register is summarised", () => {
  const diary = wa.readCsv("date,room,student,complaint\n2026-08-20,B-118,Ankita Mohanty,Tap leaking");
  assert.equal(diary.kind, "COMPLAINT_DIARY");
  assert.deepEqual([diary.complaints[0].sender, diary.complaints[0].room, diary.complaints[0].text], ["Ankita Mohanty", "B-118", "Tap leaking"]);
  const gate = wa.readCsv("date,name,out time,in time,remark\n2026-08-21,A,16:10,21:05,\n2026-08-22,B,15:00,22:10,late");
  assert.deepEqual([gate.kind, gate.rows, gate.late], ["GATE_REGISTER", 2, 1]);
});

// ---- Phase 8 · policy replay ---------------------------------------------------------------

const replaySvc = await import("../src/services/xo/replayService.js");

test("replay: loosening the dues limit raises auto-approval, cuts human decisions and waits, and flags cases a person rejected", () => {
  const live = RULES;
  const loose = [{ ...DEFAULT_RULES[0], active: true, status: "ACTIVE", version: 9, conditions: DEFAULT_RULES[0].conditions.map((c) => (c.field === "overdueDues" ? { ...c, value: 20000 } : c)) }, ...RULES.slice(1)];
  const rows = [
    { type: "BONAFIDE_CERTIFICATE", reference: "D1", facts: { ...BONAFIDE_OK }, actual: { waitHours: 0, rejected: false, undone: false } },
    { type: "BONAFIDE_CERTIFICATE", reference: "D2", facts: { ...BONAFIDE_OK, overdueDues: 18500 }, actual: { waitHours: 20, rejected: false, undone: false } },
    { type: "BONAFIDE_CERTIFICATE", reference: "D3", facts: { ...BONAFIDE_OK, overdueDues: 5000 }, actual: { waitHours: 30, rejected: true, undone: false } },
    { type: "BONAFIDE_CERTIFICATE", reference: "D4", facts: { ...BONAFIDE_OK, overdueDues: 50000 }, actual: { waitHours: 40, rejected: false, undone: false } }
  ];
  const r = replaySvc.compareType(rows, live, loose);
  assert.deepEqual(r.autoApprovalPct, { before: 25, after: 75 });
  assert.deepEqual(r.humanDecisions, { before: 3, after: 1, change: -2 });
  assert.equal(r.staffMinutes.after, replaySvc.MINUTES_PER_HUMAN_DECISION);
  assert.deepEqual(r.medianWaitHours, { before: 25, after: 0 });
  assert.deepEqual(r.violations.map((v) => v.reference), ["D3"]);
  assert.equal(r.changed.length, 2);
});

test("replay: the same rules change nothing", () => {
  const rows = [{ type: "GATE_PASS", reference: "G1", facts: { guardianOtpVerified: true, leadTimeHours: 1, durationHours: 3, returnBeforeCutoff: true, lateReturnsLast30Days: 0 }, actual: { waitHours: 2 } }];
  const r = replaySvc.compareType(rows, RULES, RULES);
  assert.equal(r.humanDecisions.change, 0);
  assert.equal(r.changed.length, 0);
});

// ---- Phase 9 · SMS work-loop parser --------------------------------------------------------

const { parseXoCommand } = await import("../src/services/xo/smsStaffService.js");

test("parseXoCommand reads DONE, NEED PART and YES/NO, and leaves everything else to the keyword channel", () => {
  assert.deepEqual(parseXoCommand("done cmp-2178 washer replaced"), { command: "DONE", reference: "CMP-2178", note: "washer replaced" });
  assert.deepEqual(parseXoCommand("DONE CMP-2178"), { command: "DONE", reference: "CMP-2178", note: null });
  assert.ok(parseXoCommand("DONE").error);
  assert.deepEqual(parseXoCommand("NEED PART CMP-2178 tap washer 15mm"), { command: "NEED_PART", reference: "CMP-2178", part: "tap washer 15mm" });
  assert.ok(parseXoCommand("NEED PART CMP-2178").error, "a part must be named");
  assert.deepEqual(parseXoCommand("yes cmp-2178"), { command: "CONFIRM_YES", reference: "CMP-2178", comment: null });
  assert.deepEqual(parseXoCommand("NO"), { command: "CONFIRM_NO", reference: null, comment: null });
  assert.equal(parseXoCommand("NO water in B-214"), null, "a sentence starting with NO is not an answer");
  for (const t of ["HELP", "ATT", "WATER B-214 no water today", "STATUS CMP-2178", "", "NEED help"]) assert.equal(parseXoCommand(t), null, t);
});

// ---- GATE-PASS SHORT OUTING (see CHANGES-GATEPASS-SHORT-OUTING.md) ----------------------------

test("§7.4: a same-day outing of 1 to 3 hours is approved at any notice; outside that window it is not", async () => {
  const { evaluate } = await import("../src/services/xo/policyEngine.js");
  const { DEFAULT_RULES } = await import("../src/services/xo/policyRules.js");
  const rules = DEFAULT_RULES.map((r) => ({ ...r, version: 1, active: true }));
  const facts = (over) => ({ guardianOtpVerified: true, leadTimeHours: 0.2, durationHours: 2, returnBeforeCutoff: true, sameDay: true, lateReturnsLast30Days: 0, ...over });
  const decide = (over) => evaluate({ type: "GATE_PASS", facts: facts(over) }, rules);
  for (const h of [1, 2, 3]) {
    const v = decide({ durationHours: h });
    assert.equal(v.decision, "AUTO_APPROVE", `${h} h`);
    assert.equal(v.citation.section, "§7.4");
  }
  assert.equal(decide({ durationHours: 0.5 }).decision, "ROUTE_TO_HUMAN", "under an hour at short notice");
  assert.equal(decide({ durationHours: 3.5 }).decision, "ROUTE_TO_HUMAN", "over three hours at short notice");
  assert.equal(decide({ sameDay: false, returnBeforeCutoff: false }).decision, "ROUTE_TO_HUMAN", "returns the next day");
  assert.equal(decide({ guardianOtpVerified: false }).decision, "ROUTE_TO_HUMAN", "the guardian code is never skipped");
  assert.equal(decide({ lateReturnsLast30Days: 1 }).decision, "ROUTE_TO_HUMAN", "a recent late return goes to the warden");
  // The existing §7.3 day outing is unchanged: 2 h notice, up to 8 h.
  assert.equal(decide({ leadTimeHours: 20, durationHours: 6 }).citation.section, "§7.3");
});

test("gate-pass timing facts report whether the outing returns on the same IST day", async () => {
  const { gatePassTimingFacts } = await import("../src/services/xo/policyFacts.js");
  assert.equal(gatePassTimingFacts({ leaveAt: "2026-09-28T05:00:00Z", expectedReturnAt: "2026-09-28T07:00:00Z", appliedAt: "2026-09-28T04:50:00Z" }).sameDay, true);
  assert.equal(gatePassTimingFacts({ leaveAt: "2026-09-28T17:30:00Z", expectedReturnAt: "2026-09-28T19:30:00Z", appliedAt: "2026-09-28T17:00:00Z" }).sameDay, false, "23:00 → 01:00 IST");
});
