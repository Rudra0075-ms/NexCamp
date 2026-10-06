/**
 * The Exception-Only Campus — end-to-end service tests against a real MongoDB.
 *
 * Uses its own throwaway database (XO_TEST_MONGO_URI, default
 * mongodb://127.0.0.1:27017/nex_xo_integration_test) and drops it at the end.
 * When no MongoDB is reachable every test here is skipped, as in
 * ext-integration.test.js.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import mongoose from "mongoose";

process.env.JWT_SECRET ||= "a-test-secret-that-is-long-enough-1234";
process.env.GATE_PASS_REVEAL_OTP = "true";
const URI = process.env.XO_TEST_MONGO_URI || "mongodb://127.0.0.1:27017/nex_xo_integration_test";

let available = false;
try {
  await mongoose.connect(URI, { serverSelectionTimeoutMS: 1500 });
  available = true;
} catch {
  available = false;
}
const itest = (name, fn) => test(name, { skip: available ? false : "no MongoDB reachable" }, fn);

const { Building, User, Complaint, AuditEntry, GatePass, Attendance } = await import("../src/models/index.js");
const ext = await import("../src/models/ext/index.js");
const { CampusEvent } = await import("../src/models/xo/CampusEvent.js");
const events = await import("../src/services/xo/eventService.js");
const backfill = await import("../src/services/xo/backfillService.js");
const { createComplaint, updateComplaint } = await import("../src/controllers/complaintController.js");
const { verifyChain } = await import("../src/services/auditChainService.js");
const certs = await import("../src/services/ext/certificateService.js");
const touchless = await import("../src/services/xo/touchlessService.js");
const { createGatePass, verifyGatePassOtp } = await import("../src/controllers/gatePassController.js");
const { createDoc } = await import("../src/controllers/ext/documentController.js");

let admin;
let warden;
let facility;
let alice;
let bob;
let hostelB;

/** Runs an Express controller with a stand-in request and response. */
export async function runController(controller, req) {
  const res = {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    set() {
      return this;
    }
  };
  let failure = null;
  await controller({ query: {}, params: {}, ...req }, res, (error) => {
    failure = error;
  });
  if (failure) throw failure;
  return res;
}

before(async () => {
  if (!available) return;
  await mongoose.connection.dropDatabase();
  hostelB = await Building.create({ code: "HST-B", mapId: "hostb", name: "HOSTEL B", type: "HOSTEL" });
  const hostelC = await Building.create({ code: "HST-C", mapId: "hostc", name: "HOSTEL C", type: "HOSTEL" });
  admin = await User.create({ name: "ADMIN ONE", email: "admin@test.in", password: "Passw0rd1", role: "ADMIN", managedDepartment: "GENERAL ADMINISTRATION" });
  warden = await User.create({ name: "WARDEN B", email: "warden@test.in", password: "Passw0rd1", role: "WARDEN", hostel: hostelB._id, hostelName: "HOSTEL B", managedDepartment: "MAINTENANCE · PLUMBING" });
  facility = await User.create({ name: "PLUMBER ONE", email: "plumber@test.in", password: "Passw0rd1", role: "FACILITY_MANAGER", managedDepartment: "MAINTENANCE · PLUMBING", phone: "+919000099999" });
  alice = await User.create({ name: "ALICE KUMARI DAS", email: "alice@test.in", password: "Passw0rd1", role: "STUDENT", studentId: "BPUT/CSE/22/0001", department: "COMPUTER SCIENCE & ENGINEERING", course: "B.TECH CSE", semester: 5, hostel: hostelB._id, hostelName: "HOSTEL B", room: "B-101", parentPhone: "+910000000000", parentName: "GUARDIAN A" });
  bob = await User.create({ name: "BOB NAYAK", email: "bob@test.in", password: "Passw0rd1", role: "STUDENT", studentId: "BPUT/CSE/22/0002", department: "COMPUTER SCIENCE & ENGINEERING", course: "B.TECH CSE", semester: 5, hostel: hostelC._id, hostelName: "HOSTEL C", room: "C-201", parentPhone: "+910000000000" });
  await ext.StudentProfile.create([
    { student: alice._id, branch: "CSE", year: 3, batch: "2022", section: "A", registeredPhone: "+919000011111" },
    { student: bob._id, branch: "CSE", year: 3, batch: "2022", section: "B", registeredPhone: "+919000022222" }
  ]);
});

after(async () => {
  if (!available) return;
  await events.flushEvents();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

// ---- Phase 1 -------------------------------------------------------------------------

itest("filing and resolving a complaint through the existing controllers emits events with cohort and audit ref", async () => {
  const filed = await runController(createComplaint, { user: alice, body: { title: "Tap leaking in B-101", description: "The tap in B-101 washroom has been leaking since morning.", category: "WATER", location: "HOSTEL B · B-101" } });
  assert.equal(filed.statusCode, 201);
  const id = filed.payload.data.complaint.id;
  await runController(updateComplaint, { user: facility, params: { id }, body: { status: "RESOLVED", resolutionDescription: "Washer replaced" } });
  await events.flushEvents();
  const rows = await CampusEvent.find({ subjectId: id }).sort({ at: 1 }).lean();
  const types = rows.map((r) => r.type);
  assert.ok(types.includes("COMPLAINT_CREATED"));
  assert.ok(types.includes("COMPLAINT_CLASSIFIED"));
  assert.ok(types.includes("COMPLAINT_RESOLVED"));
  const createdEvent = rows.find((r) => r.type === "COMPLAINT_CREATED");
  assert.deepEqual({ ...createdEvent.cohort }, { hostel: "HOSTEL B", branch: "CSE", year: 3, section: "A" });
  assert.equal(createdEvent.humanTouch, false);
  assert.match(createdEvent.auditRef, /^#\d+$/);
  const resolved = rows.find((r) => r.type === "COMPLAINT_RESOLVED");
  assert.equal(resolved.humanTouch, true);
  assert.equal(resolved.actorRole, "FACILITY_MANAGER");
});

itest("an event that fails to write never fails the request that emitted it", async () => {
  const original = CampusEvent.create;
  CampusEvent.create = async () => {
    throw new Error("disk full");
  };
  const logged = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.join(" "));
  try {
    const filed = await runController(createComplaint, { user: bob, body: { title: "Fan not working C-201", description: "The ceiling fan in C-201 does not start at all.", category: "ELECTRICITY", location: "HOSTEL C · C-201" } });
    assert.equal(filed.statusCode, 201, "the complaint is still filed");
    await events.flushEvents();
    assert.ok(errors.some((e) => /could not record COMPLAINT_CREATED/.test(e)), "the failure is logged");
  } finally {
    CampusEvent.create = original;
    console.error = logged;
  }
});

itest("backfill derives events for records written without them, skips LIVE ones, and is idempotent", async () => {
  const at = new Date(Date.now() - 20 * 864e5);
  const c = await Complaint.create({ reference: "CMP-9001", student: alice._id, title: "Old leak", description: "An old leak that was fixed.", category: "WATER", department: "MAINTENANCE · PLUMBING", status: "RESOLVED", channel: "SMS", building: hostelB._id, audit: [{ at, actor: "system", message: "Assigned to MAINTENANCE · PLUMBING" }], resolution: { resolvedAt: new Date(at.getTime() + 8 * 3600000), resolvedBy: facility._id, resolutionTimeHours: 8 } });
  await Complaint.collection.updateOne({ _id: c._id }, { $set: { createdAt: at } });
  const first = await backfill.backfillEvents({ actor: admin });
  assert.ok(first.written > 0);
  const derived = await CampusEvent.find({ subjectId: String(c._id) }).lean();
  assert.deepEqual(derived.map((e) => e.type).sort(), ["COMPLAINT_ASSIGNED", "COMPLAINT_CREATED", "COMPLAINT_RESOLVED"]);
  assert.ok(derived.every((e) => e.origin === "BACKFILL"));
  assert.equal(derived.find((e) => e.type === "COMPLAINT_CREATED").channel, "SMS");
  // the complaint filed live above keeps exactly one CREATED event
  const liveCreated = await CampusEvent.countDocuments({ type: "COMPLAINT_CREATED", subjectRef: { $ne: "CMP-9001" } });
  const second = await backfill.backfillEvents({ actor: admin });
  assert.equal(second.written, first.written, "re-running writes the same set");
  assert.equal(second.replaced, first.written);
  assert.equal(await CampusEvent.countDocuments({ type: "COMPLAINT_CREATED", subjectRef: { $ne: "CMP-9001" } }), liveCreated);
  const audit = await AuditEntry.findOne({ action: "EVENTS_BACKFILLED" }).lean();
  assert.ok(audit, "backfill is recorded on the audit chain");
});

itest("the audit chain still verifies with the new entity types written", async () => {
  const rows = await AuditEntry.find().sort({ sequence: 1 }).lean();
  assert.equal(verifyChain(rows).intact, true);
});


// ---- Phase 2 · Touchless Lane ---------------------------------------------------------

const feeAccount = (student, overdue) =>
  ext.FeeAccount.create({ student: student._id, academicYear: "2026-27", heads: [{ head: "TUITION", label: "Tuition", amount: 48500, paid: 48500 - overdue, dueDate: new Date(Date.now() - 20 * 864e5), payments: [{ amount: 48500 - overdue, at: new Date(Date.now() - 30 * 864e5), receipt: `RCP-T-${student.studentId.slice(-4)}`, mode: "ONLINE" }] }] });

itest("an in-policy bonafide is issued instantly under §4.2 with zero human touches, and verifies VALID", async () => {
  await touchless.ensureDefaultRules({ force: true });
  await feeAccount(alice, 0);
  const res = await runController(createDoc, { user: alice, body: { type: "BONAFIDE", purpose: "Bank loan" } });
  assert.equal(res.statusCode, 201);
  const body = res.payload.data;
  assert.equal(body.status, "ISSUED");
  assert.equal(body.decidedBy, "POLICY");
  assert.equal(body.policy.decision, "AUTO_APPROVE");
  assert.equal(body.policy.citation.section, "§4.2");
  assert.match(res.payload.message, /issued instantly under §4.2/);
  const verified = await certs.verifyCode(body.certificate.verificationCode);
  assert.equal(verified.status, "VALID");
  await events.flushEvents();
  const touches = await CampusEvent.countDocuments({ subjectId: body.id, humanTouch: true });
  assert.equal(touches, 0);
  const policyEvent = await CampusEvent.findOne({ subjectId: body.id, type: "POLICY_DECISION" }).lean();
  assert.equal(policyEvent.channel, "POLICY");
  const chain = await AuditEntry.find({ entityId: body.id }).lean();
  assert.ok(chain.some((a) => a.action === "POLICY_AUTO_APPROVED" && a.actorRole === "POLICY"));
});

itest("an out-of-policy bonafide goes to the office with the failed condition, and other certificate types are untouched", async () => {
  await feeAccount(bob, 18500);
  const res = await runController(createDoc, { user: bob, body: { type: "BONAFIDE", purpose: "Scholarship" } });
  const body = res.payload.data;
  assert.equal(body.status, "SUBMITTED");
  assert.equal(body.decidedBy, null);
  assert.equal(body.policy.decision, "ROUTE_TO_HUMAN");
  assert.equal(body.policy.failedConditions[0].field, "overdueDues");
  const other = await runController(createDoc, { user: bob, body: { type: "CHARACTER", purpose: "Internship" } });
  assert.equal(other.payload.data.status, "SUBMITTED");
  assert.equal(other.payload.data.policy.decision, "NOT_COVERED");
  // the human path is unchanged and records a HUMAN decision
  const reviewed = await certs.reviewDocument(body.id, admin, { decision: "APPROVE" });
  assert.equal(reviewed.decidedBy, "HUMAN");
  const inbox = await touchless.exceptionsInbox();
  assert.ok(inbox.exceptions.some((e) => e.reference === other.payload.data.reference && /No policy rule/.test(e.why[0].label)));
});

itest("staff UNDO of a policy certificate revokes it, reopens a human request, tells the student and is audited", async () => {
  const issued = await DocumentRequestModel().findOne({ student: alice._id, decidedBy: "POLICY" });
  await assert.rejects(() => touchless.undoPolicyDecision("document", issued._id, admin, "no"), /reason/);
  await assert.rejects(() => touchless.undoPolicyDecision("document", issued._id, alice, "a valid reason here"), /Only staff/);
  const result = await touchless.undoPolicyDecision("document", issued._id, admin, "Semester on the record is wrong");
  assert.equal(result.status, "REVOKED");
  assert.match(result.followUp, /^DOC-/);
  assert.equal((await certs.verifyCode(issued.certificate.verificationCode)).status, "REVOKED");
  const followUp = await DocumentRequestModel().findOne({ reference: result.followUp }).lean();
  assert.equal(followUp.status, "SUBMITTED");
  assert.equal(followUp.policyUndo.from, issued.reference);
  const notice = await ext.Notice.findOne({ title: new RegExp(issued.reference) }).lean();
  assert.ok(notice, "the student is told");
  assert.equal(notice.status, "PUBLISHED", "quiet hours are overridden for this one transactional notice");
  assert.ok(await AuditEntry.findOne({ entityId: String(issued._id), action: "POLICY_DECISION_UNDONE" }));
  await assert.rejects(() => touchless.undoPolicyDecision("document", issued._id, admin, "second undo attempt"), /already undone/);
});

async function applyAndVerify(student, leaveInHours, hours = 3) {
  const leaveAt = new Date(Date.now() + leaveInHours * 3600000);
  const applied = await runController(createGatePass, { user: student, body: { reason: "Bank visit", destination: "Town", leaveAt: leaveAt.toISOString(), expectedReturnAt: new Date(leaveAt.getTime() + hours * 3600000).toISOString() } });
  const id = applied.payload.data.gatePass.id;
  const code = applied.payload.data.otp.devCode;
  assert.ok(code, "dev OTP revealed in tests");
  const pass = await GatePass.findById(id).lean();
  assert.equal(pass.status, "PENDING_PARENT_VERIFICATION", "nothing is decided before the guardian code");
  return runController(verifyGatePassOtp, { user: student, params: { id }, body: { code } });
}

const istHour = () => (new Date().getUTCHours() + 5.5) % 24;

itest("a gate pass is decided only after the guardian OTP: short notice stays with the warden", async () => {
  // GATE-PASS SHORT OUTING: 1–3 hour same-day outings are now approved at short notice (§7.4), so this
  // short-notice outing is 30 minutes long — outside both rules — and still goes to the warden.
  const res = await applyAndVerify(bob, 1, 0.5);
  const body = res.payload.data;
  assert.equal(body.gatePass.status, "PENDING_WARDEN_APPROVAL");
  assert.equal(body.policy.decision, "ROUTE_TO_HUMAN");
  assert.ok(body.policy.failedConditions.some((c) => c.field === "leadTimeHours"));
  await GatePass.updateOne({ _id: body.gatePass.id }, { $set: { status: "CANCELLED" } });
});

itest("an in-policy day outing is approved under §7.3 after guardian confirmation, with a QR, and the warden can UNDO it", async () => {
  // Leave tomorrow at 10:00 IST for 4 hours: in policy whatever the time of day the test runs.
  const { istDateKey, istInstant } = await import("../src/services/ext/istTime.js");
  const leaveAt = istInstant(istDateKey(new Date(), 1), "10:00");
  const hoursAhead = (leaveAt - Date.now()) / 3600000;
  const res = await applyAndVerify(alice, hoursAhead, 4);
  const body = res.payload.data;
  assert.equal(body.gatePass.status, "APPROVED", JSON.stringify(body.policy?.failedConditions));
  assert.equal(body.gatePass.decidedBy, "POLICY");
  assert.equal(body.policy.citation.section, "§7.3");
  assert.ok(body.qr?.dataUrl?.startsWith("data:image/png"));
  assert.match(res.payload.message, /approved under §7.3/);
  const undone = await touchless.undoPolicyDecision("gatepass", body.gatePass.id, warden, "Water shutdown — residents stay in");
  assert.equal(undone.status, "PENDING_WARDEN_APPROVAL");
  const after = await GatePass.findById(body.gatePass.id).select("+pass.tokenHash").lean();
  assert.equal(after.pass.tokenHash, undefined, "the QR no longer works");
  assert.equal(after.policyUndo.byName, "WARDEN B");
  await events.flushEvents();
  assert.ok(await CampusEvent.findOne({ subjectId: body.gatePass.id, type: "POLICY_UNDONE", humanTouch: true }));
  void istHour;
});

// GATE-PASS SHORT OUTING (see CHANGES-GATEPASS-SHORT-OUTING.md) -----------------------------------
const { scanGatePass } = await import("../src/controllers/gatePassController.js");

itest("a short same-day outing (1–3 h) leaving in 20 minutes is approved under §7.4 with a QR that the gate accepts", async () => {
  const carol = await User.create({ name: "CAROL MISHRA", email: "carol@test.in", password: "Passw0rd1", role: "STUDENT", studentId: "BPUT/CSE/22/0003", semester: 5, hostel: hostelB._id, hostelName: "HOSTEL B", room: "B-120", parentPhone: "+910000000000" });
  const { istDateKey } = await import("../src/services/ext/istTime.js");
  const leaveAt = new Date(Date.now() + 20 * 60000);
  const sameDay = istDateKey(leaveAt) === istDateKey(new Date(leaveAt.getTime() + 2 * 3600000));
  try {
  const res = await applyAndVerify(carol, 20 / 60, 2);
  const body = res.payload.data;
  if (!sameDay) {
    // Run within two hours of midnight IST: the return is on the next day, so the warden decides.
    assert.equal(body.gatePass.status, "PENDING_WARDEN_APPROVAL");
    assert.ok(body.policy.failedConditions.some((c) => c.field === "sameDay" || c.field === "returnBeforeCutoff"));
    return;
  }
  assert.equal(body.gatePass.status, "APPROVED", JSON.stringify(body.policy?.failedConditions));
  assert.equal(body.gatePass.decidedBy, "POLICY");
  assert.equal(body.policy.citation.section, "§7.4");
  assert.match(res.payload.message, /approved under §7.4/);
  assert.ok(body.qr?.dataUrl?.startsWith("data:image/png"), "the QR comes back with the verification");
  assert.match(body.qr.code, /^[0-9A-Z]{4}-[0-9A-Z]{4}$/, "and the typed code under it");
  const scanned = await runController(scanGatePass, { user: warden, body: { token: body.qr.payload } });
  assert.equal(scanned.statusCode, 200, "the auto-issued QR is accepted at the gate");
  assert.equal((await GatePass.findById(body.gatePass.id).lean()).status, "ACTIVE");
  } finally {
    // This student exists only for this test; later tests count Hostel B's residents.
    await events.flushEvents();
    await GatePass.deleteMany({ student: carol._id });
    await User.deleteOne({ _id: carol._id });
  }
});

itest("an existing campus gets the new §7.4 rule once, without touching the rules it already has", async () => {
  const { PolicyRule } = await import("../src/models/xo/PolicyRule.js");
  await PolicyRule.deleteOne({ key: "GATEPASS-SHORT-SAMEDAY" });
  const before = await PolicyRule.find({}).sort({ _id: 1 }).lean();
  assert.equal(await touchless.ensureDefaultRules(), true, "the missing rule is installed");
  assert.equal(await PolicyRule.countDocuments({ key: "GATEPASS-SHORT-SAMEDAY", active: true }), 1);
  const kept = await PolicyRule.find({ _id: { $in: before.map((r) => r._id) } }).sort({ _id: 1 }).lean();
  assert.deepEqual(kept.map((r) => [r.key, r.version, r.active]), before.map((r) => [r.key, r.version, r.active]));
  assert.equal(await touchless.ensureDefaultRules(), false, "and only once");
});

itest("a fee-receipt copy on the ledger is issued instantly; an unknown receipt goes to the accounts office", async () => {
  const ok = await touchless.requestReceiptCopy(alice, { receipt: `RCP-T-${alice.studentId.slice(-4)}` });
  assert.equal(ok.status, "FULFILLED");
  assert.equal(ok.decidedBy, "POLICY");
  assert.equal(ok.output.amount, 48500);
  const bad = await touchless.requestReceiptCopy(alice, { receipt: "RCP-NOPE-1" });
  assert.equal(bad.status, "UNDER_REVIEW");
  const decided = await touchless.decideServiceRequest(bad.id, admin, { decision: "REJECT", reason: "No such payment on record" });
  assert.deepEqual([decided.status, decided.decidedBy], ["REJECTED", "HUMAN"]);
});

itest("the Touchless Rate counts closures with zero human touches from the event log", async () => {
  await events.flushEvents();
  const rate = await touchless.touchlessRate({ days: 30 });
  const certsRow = rate.rows.find((r) => r.type === "Certificates");
  // The only instant certificate was later undone by staff — an undo is a human touch.
  assert.equal(certsRow.zeroTouch, 0);
  assert.ok(certsRow.humanTouches >= 1);
  assert.ok(rate.closed >= rate.zeroTouch);
  assert.match(rate.calculation.formula, /0 human touches/);
  const receipts = rate.rows.find((r) => r.type === "Fee receipt copies");
  assert.equal(receipts.closed, 2);
  assert.equal(receipts.zeroTouch, 1, "the one the accounts office rejected had a human touch");
});

function DocumentRequestModel() {
  return ext.DocumentRequest;
}

// ---- Phase 3–4 · ledger, deflection, ETA ----------------------------------------------

const deflection = await import("../src/services/xo/deflectionService.js");
const ledgerSvc = await import("../src/services/xo/ledgerService.js");
const etaSvc = await import("../src/services/xo/etaService.js");
const { Incident } = await import("../src/models/index.js");
const { IncidentFollow } = await import("../src/models/xo/IncidentFollow.js");

itest("a student typing a known problem is shown the open incident; +1 & Follow attaches them without a duplicate", async () => {
  const first = await runController(createComplaint, { user: bob, body: { title: "No water in Hostel B washroom", description: "There is no water in the Hostel B second floor washroom since morning.", category: "WATER", location: "HOSTEL B · B-2F" } });
  await runController(createComplaint, { user: alice, body: { title: "Hostel B taps dry", description: "No water in the taps of Hostel B since morning, second floor.", category: "WATER", location: "HOSTEL B · B-101" } });
  let incident = await Incident.findOne({ building: hostelB._id, category: "WATER", status: { $ne: "RESOLVED" } });
  if (!incident) incident = await Incident.create({ reference: "INC-9001", title: "HOSTEL B · WATER SUPPLY FAILURE", category: "WATER", building: hostelB._id, status: "CLUSTERED", complaints: [first.payload.data.complaint.id] });
  const before = await Complaint.countDocuments();
  const check = await deflection.similarOpenIncident(alice, { text: "The taps in Hostel B have no water on the second floor", category: "WATER" });
  assert.ok(check.match, JSON.stringify(check));
  assert.equal(check.match.reference, incident.reference);
  assert.ok(check.match.overlapPct >= 30);
  assert.equal(check.method, "EXISTING_CLUSTER_SCORE");
  assert.equal(await Complaint.countDocuments(), before, "the check writes nothing");
  const followed = await deflection.followIncident(alice, incident._id, { room: "B-101" });
  assert.deepEqual([followed.following, followed.already, followed.followers], [true, false, 1]);
  const again = await deflection.followIncident(alice, incident._id, {});
  assert.equal(again.already, true);
  assert.equal(await IncidentFollow.countDocuments({ incident: incident._id }), 1);
  assert.ok(await AuditEntry.findOne({ action: "STUDENT_FOLLOWED_INCIDENT", entityId: String(incident._id) }));
  const miss = await deflection.similarOpenIncident(alice, { text: "The library projector remote is missing", category: "OTHER" });
  assert.equal(miss.match, null);
});

itest("the ledger reads per-request friction from the event log, and ETAs refuse to guess under 5 samples", async () => {
  await events.flushEvents();
  const ledger = await ledgerSvc.frictionLedger({ days: 30 });
  const certs = ledger.byType.find((t) => t.workflow === "DOCUMENT");
  assert.ok(certs.requests >= 3);
  assert.equal(certs.baseline.kind, "ASSUMPTION");
  assert.ok(ledger.totals.officeVisitsAvoided > 0);
  assert.ok(ledger.byHostel.some((h) => h.hostel === "HOSTEL B"));
  const eta = await etaSvc.complaintEta({ department: "MAINTENANCE · PLUMBING" });
  assert.equal(eta.kind, "INSUFFICIENT DATA");
  assert.match(eta.text, /Insufficient history/);
  const mine = await ledgerSvc.mySavings(alice);
  assert.equal(mine.kind, "ESTIMATE");
  assert.ok(mine.requests >= 1);
});

// ---- Phase 5 · guaranteed reach -----------------------------------------------------------

const reachSvc = await import("../src/services/xo/reachService.js");
const { CohortContact } = await import("../src/models/xo/CohortContact.js");

itest("a reach-target notice walks unread recipients up the ladder once, and the funnel names who is unreached", async () => {
  await CohortContact.create({ student: bob._id, branch: "CSE", year: 3, section: "A", role: "CLASS_REP" });
  const published = new Date(Date.now() - 3 * 3600000);
  const notice = await reachSvc.createReachNotice({ title: "Hostel water off", body: "Hostel B and C water off 10–13", priority: "CRITICAL", audience: { roles: ["STUDENT"] }, reachTarget: { pct: 100, deadline: new Date(Date.now() + 3600000) }, escalateAfterHours: 48, confirmDuplicate: true }, admin, { now: published });
  assert.equal(notice.reachTarget.pct, 100);
  const phoneFor = async (id) => (await ext.StudentProfile.findOne({ student: id }))?.registeredPhone;
  const first = await reachSvc.reachSweep({ now: new Date(), phoneFor });
  assert.ok(first.sms >= 2 && first.kiosk >= 2);
  const second = await reachSvc.reachSweep({ now: new Date(), phoneFor });
  assert.equal(second.sms + second.kiosk + second.classRep, 0, "each rung once per recipient");
  const funnel = await reachSvc.reachFunnel(notice._id);
  assert.equal(funnel.funnel.targeted, 2);
  assert.equal(funnel.unreached.length, 2);
  assert.equal(funnel.unreached[0].lastRung.rung, "KIOSK");
  const kiosk = await reachSvc.kioskList();
  assert.ok(kiosk.students.some((s) => s.name === "ALICE KUMARI DAS" && s.notices.some((n) => n.reference === notice.reference)));
  const rep = await reachSvc.classRepList(bob);
  assert.equal(rep.isRep, true);
  assert.ok(rep.items.some((i) => i.name === "ALICE KUMARI DAS"), "alice (section A) is on the section A rep's list");
  await reachSvc.markReadAtKiosk(admin, notice.reference, alice.studentId);
  await reachSvc.markReadAtKiosk(admin, notice.reference, bob.studentId);
  const met = await reachSvc.reachSweep({ now: new Date(), phoneFor });
  assert.equal(met.reached, 1, "target met — the ladder stops");
  assert.ok(await AuditEntry.findOne({ entityId: String(notice._id), action: "NOTICE_LADDER_KIOSK" }));
});

itest("a correction supersedes the earlier notice; hygiene holds night notices unless overridden (audited)", async () => {
  const a = await reachSvc.createReachNotice({ title: "Seminar in the main hall on Friday", body: "Seminar on Friday 10:00 main hall", priority: "HIGH", audience: { roles: ["STUDENT"] }, overrideQuietHours: true, confirmDuplicate: true }, admin);
  await assert.rejects(() => reachSvc.createReachNotice({ title: "Seminar in the main hall on Friday — revised", body: "Seminar on Friday 12:00 main hall", priority: "HIGH", audience: { roles: ["STUDENT"] }, overrideQuietHours: true }, admin), (e) => e.status === 409);
  const b = await reachSvc.createReachNotice({ title: "Seminar in the main hall on Friday — revised", body: "Seminar on Friday 12:00 main hall", priority: "HIGH", audience: { roles: ["STUDENT"] }, supersedes: String(a._id), overrideQuietHours: true }, admin);
  assert.equal(b.supersedes.reference, a.reference);
  assert.equal((await ext.Notice.findById(a._id)).supersededBy.reference, b.reference);
  const h = await reachSvc.hygiene({ title: "Seminar in the main hall on Friday — updated", body: "Seminar on Friday 12:30 main hall", audience: { roles: ["STUDENT"] } });
  assert.ok(h.supersedes, "a revision is recognised as replacing an earlier notice");
  const { istDateKey, istInstant } = await import("../src/services/ext/istTime.js");
  const night = istInstant(istDateKey(new Date()), "23:30");
  const held = await reachSvc.hygiene({ title: "Library timings", body: "Library opens at 9", priority: "NORMAL" }, { now: night });
  assert.equal(held.quietHours.held, true);
  const sent = await reachSvc.createReachNotice({ title: "Hostel C lift out of order", body: "Use the stairs", priority: "HIGH", audience: { hostels: ["HOSTEL C"] }, overrideQuietHours: true, overrideReason: "Safety" }, admin, { now: night });
  assert.equal(sent.status, "PUBLISHED");
  assert.equal(sent.quietHoursOverride.reason, "Safety");
});

// ---- Phase 6 · change propagation ---------------------------------------------------------

const changeSvc = await import("../src/services/xo/changeService.js");
const tt = await import("../src/services/ext/timetableService.js");
const { ChangeEvent } = await import("../src/models/xo/ChangeEvent.js");

itest("a class cancellation propagates: notice to that section only, and an attendance projection per affected student", async () => {
  const { istDateKey, weekdayOf } = await import("../src/services/ext/istTime.js");
  let key = istDateKey(new Date(), 1);
  while (weekdayOf(key) === 0 || weekdayOf(key) === 6) key = istDateKey(new Date(Date.parse(`${key}T12:00:00Z`)), 1);
  const schedule = await ext.ClassSchedule.create({ branch: "CSE", year: 3, section: "A", subject: "DBMS", subjectCode: "CS301", weekday: weekdayOf(key), startTime: "10:00", endTime: "11:00", room: "R1" });
  await Attendance.create({ student: alice._id, subject: "DBMS", totalClasses: 10, attendedClasses: 7 });
  const out = await tt.createChange(admin, { scheduleId: schedule._id, sessionDate: key, type: "CANCEL", reason: "Faculty on leave" });
  const notice = await ext.Notice.findOne({ reference: out.notice.reference }).lean();
  assert.deepEqual(notice.audience.sections, ["A"], "targeted to the section, not broadcast");
  const event = await ChangeEvent.findOne({ "source.reference": out.change.reference }).lean();
  assert.equal(event.effects.recipients, 1, "alice is the only section-A student");
  assert.equal(event.type, "CLASS_CANCEL");
  assert.equal(event.effects.attendance.students, 1);
  assert.equal(event.effects.attendance.rows[0].name, "ALICE KUMARI DAS");
  const mine = await changeSvc.changesFor(alice);
  assert.ok(mine.changes.some((c) => c.reference === event.reference && /classes left/.test(c.forYou)));
  assert.equal((await changeSvc.changesFor(bob)).changes.some((c) => c.reference === event.reference), false, "section B is not told");
});

itest("a complaint during a planned shutdown is linked to it instead of opening an incident", async () => {
  const hostelC = await Building.findOne({ code: "HST-C" });
  const event = await changeSvc.planShutdown(admin, { buildingCode: "HST-C", utility: "ELECTRICITY", from: new Date(Date.now() - 3600000), to: new Date(Date.now() + 3600000), reason: "Transformer work" });
  assert.equal(event.notice.reach, 1, "Hostel C residents are told");
  const incidentsBefore = await Incident.countDocuments();
  const res = await runController(createComplaint, { user: bob, body: { title: "No power in C-201", description: "There is no electricity in room C-201 since an hour.", category: "ELECTRICITY", location: "HOSTEL C · C-201" } });
  assert.equal(res.payload.data.plannedChange.reference, event.reference);
  assert.equal(res.payload.data.incident, null);
  assert.equal(await Incident.countDocuments(), incidentsBefore);
  const linked = await ChangeEvent.findById(event._id).lean();
  assert.equal(linked.linkedComplaints.length, 1);
  const check = await deflection.similarOpenIncident(bob, { text: "No electricity in my room since an hour", category: "ELECTRICITY" });
  assert.equal(check.planned.reference, event.reference);
  void hostelC;
});

// ---- Phase 7 · WhatsApp import ------------------------------------------------------------

const wa = await import("../src/services/xo/whatsappService.js");

itest("a WhatsApp import is a dry run by default, and convert files through the normal services with channel IMPORT", async () => {
  const text = ["12/09/2026, 23:41 - Warden Sir: Attention all students: water off tomorrow 10 to 1", "13/09/2026, 08:05 - BOB NAYAK: No water in C-201 washroom since morning", "13/09/2026, 08:06 - Stranger: Fan not working in C-305", "13/09/2026, 09:00 - ALICE KUMARI DAS: Is tomorrow's class cancelled?", "13/09/2026, 09:10 - BOB NAYAK: Is tomorrow's class cancelled??"].join("\n");
  const before = await Complaint.countDocuments();
  const dry = await wa.importChat(admin, { text, name: "Test group" });
  assert.equal(dry.dryRun, true);
  assert.equal(dry.written, 0);
  assert.equal(await Complaint.countDocuments(), before, "a dry run writes nothing");
  assert.equal(dry.classification.source, "AI_NOT_CONFIGURED");
  const done = await wa.importChat(admin, { text, name: "Test group", convert: true });
  assert.equal(done.created.complaints.length, 1, "only the registered student's complaint is filed");
  assert.match(done.created.skipped[0].reason, /not a registered student/);
  assert.equal(done.created.faqDrafts.length, 1);
  assert.equal(done.created.notices[0].status, "SCHEDULED", "imported notices are not re-sent");
  await events.flushEvents();
  assert.ok(await CampusEvent.findOne({ channel: "IMPORT", type: "COMPLAINT_CREATED" }));
  assert.ok(await AuditEntry.findOne({ action: "WHATSAPP_IMPORTED" }));
});

// ---- Phase 8 · policy replay -----------------------------------------------------------

const replaySvc = await import("../src/services/xo/replayService.js");
const { PolicyRule } = await import("../src/models/xo/PolicyRule.js");

itest("a replay under edited rules is SIMULATED and leaves the live rules untouched", async () => {
  const liveBefore = JSON.stringify(await PolicyRule.find({ active: true }).sort({ key: 1 }).lean());
  const base = await PolicyRule.findOne({ key: "BONAFIDE-INSTANT", active: true }).lean();
  const edit = { key: base.key, requestType: base.requestType, title: base.title, action: base.action, citation: base.citation, conditions: base.conditions.map((c) => (c.field === "overdueDues" ? { ...c, value: 50000 } : c)) };
  const r = await replaySvc.replay({ days: 30, edits: [edit] });
  assert.ok(["SIMULATED", "INSUFFICIENT DATA"].includes(r.kind));
  const certs = r.byType.find((t) => t.type === "BONAFIDE_CERTIFICATE");
  assert.ok(certs.requests >= 2);
  assert.ok(certs.autoApprovalPct.after >= certs.autoApprovalPct.before);
  assert.ok(r.assumptions.length >= 4);
  assert.equal(JSON.stringify(await PolicyRule.find({ active: true }).sort({ key: 1 }).lean()), liveBefore, "live rules unchanged");
  await assert.rejects(() => replaySvc.replay({ edits: [{ ...edit, citation: {} }] }), /not valid/);
});

// ---- Phase 9 · SMS work loop ------------------------------------------------------------

const sms = await import("../src/services/ext/smsKeywordService.js");
const { StaffPhone } = await import("../src/models/xo/StaffPhone.js");
const { SmsOutbox } = await import("../src/models/xo/SmsOutbox.js");

itest("staff DONE by SMS resolves through the existing controller and asks the student 'Is it fixed?'; YES closes it", async () => {
  await StaffPhone.create({ staff: facility._id, phone: "+919000009001", label: "Plumber", departments: ["MAINTENANCE · PLUMBING"] });
  const filed = await runController(createComplaint, { user: alice, body: { title: "Tap leaking in washroom", description: "The tap in the B-101 washroom leaks all night", category: "WATER", location: "HOSTEL B · B-101" } });
  const c = filed.payload.data.complaint;
  await Complaint.updateOne({ _id: c.id }, { $set: { department: "MAINTENANCE · PLUMBING" } });

  const part = await sms.handleInbound({ from: "+919000009001", text: `NEED PART ${c.reference} tap washer`, simulated: true, via: "TEST" });
  assert.equal(part.outcome, "OK");
  assert.ok(part.reply.length <= 160);
  let row = await Complaint.findById(c.id).lean();
  assert.equal(row.status, "INVESTIGATING");
  assert.ok(row.audit.some((a) => /Waiting for a part: tap washer/.test(a.message)));

  const done = await sms.handleInbound({ from: "+919000009001", text: `DONE ${c.reference} washer replaced`, simulated: true, via: "TEST" });
  assert.equal(done.outcome, "OK");
  row = await Complaint.findById(c.id).lean();
  assert.equal(row.status, "RESOLVED");
  assert.equal(String(row.resolution.resolvedBy), String(facility._id), "resolved as the staff member, through updateComplaint");
  const asked = await SmsOutbox.findOne({ relatedRef: c.reference, purpose: "FIX_CHECK" }).lean();
  assert.match(asked.body, new RegExp(`Is it fixed\\? Reply YES ${c.reference}`));
  assert.ok(await AuditEntry.findOne({ action: "COMPLAINT_RESOLVED", entityRef: c.reference }));

  // A student cannot send DONE; a non-matching number falls through to the old channel.
  const notStaff = await sms.handleInbound({ from: "+919000022222", text: `DONE ${c.reference}`, simulated: true, via: "TEST" });
  assert.equal(notStaff.outcome, "REFUSED");
  const yes = await sms.handleInbound({ from: "+919000011111", text: `YES ${c.reference}`, simulated: true, via: "TEST" });
  assert.match(yes.reply, /closed as fixed/);
  assert.equal((await ext.FixConfirmation.findOne({ complaint: c.id }).lean()).response, "YES");
  await events.flushEvents();
  assert.ok(await CampusEvent.findOne({ type: "COMPLAINT_WORK_DONE", channel: "SMS", subjectRef: c.reference }));
  assert.ok(await CampusEvent.findOne({ type: "COMPLAINT_NEEDS_PART", subjectRef: c.reference }));
  // Existing commands still behave as before.
  assert.equal((await sms.handleInbound({ from: "+919000011111", text: "HELP", simulated: true, via: "TEST" })).reply, sms.HELP_TEXT);
});

itest("a staff number cannot close another department's complaint, and NO by SMS opens a reopen request", async () => {
  const filed = await runController(createComplaint, { user: bob, body: { title: "Wi-Fi drops every evening", description: "Router in C block drops every evening after 8", category: "WI-FI", location: "HOSTEL C · C-201" } });
  const c = filed.payload.data.complaint;
  await Complaint.updateOne({ _id: c.id }, { $set: { department: "IT · NETWORK" } });
  const refused = await sms.handleInbound({ from: "+919000009001", text: `DONE ${c.reference}`, simulated: true, via: "TEST" });
  assert.equal(refused.outcome, "REFUSED");
  assert.notEqual((await Complaint.findById(c.id).lean()).status, "RESOLVED");
  await runController(updateComplaint, { user: admin, params: { id: c.id }, body: { status: "RESOLVED", resolutionDescription: "Router replaced" } });
  const no = await sms.handleInbound({ from: "+919000022222", text: `NO ${c.reference} still dropping`, simulated: true, via: "TEST" });
  assert.match(no.reply, /reopened as RPN-/);
});

// ---- Phase 10 · Tuesday Test ---------------------------------------------------------------

const tuesday = await import("../src/services/xo/tuesdayService.js");

itest("the Tuesday Test compares this run with the ledger's old path: touches from the event log, time from the stopwatch", async () => {
  const filed = await runController(createDoc, { user: alice, body: { type: "BONAFIDE", purpose: "Tuesday Test scholarship" } }).catch(() => null);
  const doc = filed?.payload?.data || (await ext.DocumentRequest.findOne({ student: alice._id, type: "BONAFIDE" }).sort({ createdAt: -1 }).lean());
  const id = String(doc.id || doc._id);
  const r = await tuesday.tuesdayCompare([
    { key: "certificate", workflow: "DOCUMENT", seconds: 1.4, actions: 1, subjectType: "DocumentRequest", subjectId: id },
    { key: "tap", workflow: "COMPLAINT", seconds: 0.8, actions: 1, noStaffWork: true },
    { key: "menu", workflow: "MENU_CHECK", seconds: 0.3, actions: 1 }
  ]);
  assert.equal(r.rows.length, 3);
  const cert = r.rows[0];
  assert.equal(cert.measured.kind, "MEASURED IN THIS DEMO");
  assert.equal(cert.touches.oldKind, "ASSUMPTION");
  assert.equal(cert.touches.newKind, "ACTUAL DATA");
  const staffEvents = await CampusEvent.countDocuments({ subjectId: id, humanTouch: true });
  assert.equal(cert.touches.new, staffEvents, "new touches are counted from the event log");
  assert.equal(r.rows[1].touches.new, 0, "a +1 creates no staff work");
  assert.equal(r.rows[2].touches.new, null, "a lookup has no request to touch");
  assert.equal(r.totals.touchesNew, staffEvents);
  // Reach in counts: only for staff or a recipient.
  const notice = await ext.Notice.findOne({ status: "PUBLISHED" }).lean();
  if (notice) {
    const recipient = await ext.NoticeReceipt.findOne({ notice: notice._id }).lean();
    const who = recipient ? await User.findById(recipient.student) : admin;
    const s = await tuesday.reachSummary(who, notice._id);
    assert.equal(typeof s.funnel.targeted, "number");
    assert.equal(s.unreached, undefined, "no names in the counts-only view");
  }
});
