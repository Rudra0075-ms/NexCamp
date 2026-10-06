/**
 * Silent Support System — end-to-end workflow against a real MongoDB.
 *
 * Uses its own throwaway database (SUPPORT_TEST_MONGO_URI, default
 * mongodb://127.0.0.1:27017/nex_support_integration_test) and drops it at the
 * end. When no MongoDB is reachable every test here is skipped, as in the
 * other *-integration.test.js files.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import mongoose from "mongoose";

process.env.JWT_SECRET ||= "a-test-secret-that-is-long-enough-1234";
delete process.env.AI_PROVIDER;
delete process.env.AI_API_KEY;
const URI = process.env.SUPPORT_TEST_MONGO_URI || "mongodb://127.0.0.1:27017/nex_support_integration_test";

let available = false;
try {
  await mongoose.connect(URI, { serverSelectionTimeoutMS: 1500 });
  available = true;
} catch {
  available = false;
}
const itest = (name, fn) => test(name, { skip: available ? false : "no MongoDB reachable" }, fn);

const { User, Notification } = await import("../src/models/index.js");
const { SupportCase, WellbeingCheckIn } = await import("../src/models/support/index.js");
const support = await import("../src/services/support/supportService.js");

let student;
let other;
let counsellor;
let admin;

before(async () => {
  if (!available) return;
  await mongoose.connection.db.dropDatabase();
  await Promise.all([User.init(), SupportCase.init(), WellbeingCheckIn.init(), Notification.init()]);
  student = await User.create({ name: "S ONE", email: "s1@t.in", password: "Campus@2026", role: "STUDENT", studentId: "T/1" });
  other = await User.create({ name: "S TWO", email: "s2@t.in", password: "Campus@2026", role: "STUDENT", studentId: "T/2" });
  counsellor = await User.create({ name: "Support", email: "c@t.in", password: "Care@2026", role: "COUNSELLOR" });
  admin = await User.create({ name: "Admin", email: "a@t.in", password: "Control@2026", role: "ADMIN" });
});

after(async () => {
  if (!available) return;
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

itest("check-in → band → private request → assigned → contacted → follow-up → resolved", async () => {
  const first = await support.recordCheckIn(student, { answers: { feeling: 2, study: 2, connection: 3, helpComfort: 4 } });
  assert.equal(first.band, "COULD_BENEFIT");
  assert.equal(first.ai.source, "AI_NOT_CONFIGURED");
  const second = await support.recordCheckIn(student, { answers: { feeling: 2, study: 2, connection: 3, helpComfort: 4 } });
  assert.equal(second.band, "SUPPORT_RECOMMENDED");
  assert.equal(second.repeatedDifficulty, true);

  const { case: created, existing } = await support.createRequest(student, { preference: "MENTOR", shareCheckIn: true });
  assert.equal(existing, false);
  assert.equal(created.status, "REQUESTED");

  // Asking twice returns the same open request.
  const again = await support.createRequest(student, { preference: "COUNSELLOR" });
  assert.equal(again.existing, true);
  assert.equal(again.case.id, created.id);

  const studentInbox = await Notification.find({ user: student._id, kind: "SUPPORT_REQUEST_RECEIVED" }).lean();
  assert.equal(studentInbox.length, 1);
  assert.doesNotMatch(studentInbox[0].body, /RECOMMENDED|feeling|study/i);
  const teamInbox = await Notification.find({ user: counsellor._id, kind: "SUPPORT_REQUEST_NEW" }).lean();
  assert.equal(teamInbox.length, 1);
  assert.doesNotMatch(`${teamInbox[0].title} ${teamInbox[0].body}`, /S ONE|T\/1/);
  assert.equal(await Notification.countDocuments({ user: admin._id }), 0);

  const queue = await support.teamQueue(counsellor);
  const row = queue.cases.find((c) => c.id === created.id);
  assert.equal(row.band, "SUPPORT_RECOMMENDED");
  assert.equal(row.student.name, "S ONE");
  assert.match(row.insight.text, /mentor/i);

  await assert.rejects(() => support.moveCase(counsellor, created.id, { status: "RESOLVED", outcome: "SUPPORT_COMPLETED" }), /can move to/);
  let moved = await support.moveCase(counsellor, created.id, { status: "ASSIGNED" });
  assert.equal(moved.assignedToMe, true);
  moved = await support.moveCase(counsellor, created.id, { status: "CONTACTED", message: "Free tomorrow at 4?" });
  moved = await support.moveCase(counsellor, created.id, { status: "FOLLOW_UP", followUpDays: 2, note: "Prefers evenings" });
  assert.ok(moved.followUpAt);
  await assert.rejects(() => support.moveCase(counsellor, created.id, { status: "RESOLVED" }), /outcome/);
  moved = await support.moveCase(counsellor, created.id, { status: "RESOLVED", outcome: "SUPPORT_COMPLETED" });
  assert.equal(moved.status, "RESOLVED");

  const contacted = await Notification.findOne({ user: student._id, kind: "SUPPORT_STATUS_UPDATE", body: /Free tomorrow/ });
  assert.ok(contacted);

  const state = await support.studentState(student);
  assert.equal(state.cases[0].status, "RESOLVED");
  assert.equal("teamNote" in state.cases[0], false);
});

itest("anonymous requests hide identity; withdraw works only for the owner", async () => {
  const { case: created } = await support.createRequest(other, { preference: "ANONYMOUS" });
  const queue = await support.teamQueue(counsellor);
  const row = queue.cases.find((c) => c.id === created.id);
  assert.equal(row.anonymous, true);
  assert.equal(row.student, null);
  await assert.rejects(() => support.withdrawRequest(student, created.id), /not found/i);
  const withdrawn = await support.withdrawRequest(other, created.id);
  assert.equal(withdrawn.status, "WITHDRAWN");
});

itest("check on me later schedules a follow-up and the sweep raises it once", async () => {
  const { case: later } = await support.createRequest(other, { preference: "CHECK_LATER", followUpDays: 1 });
  assert.equal(later.status, "FOLLOW_UP");
  assert.equal(await Notification.countDocuments({ user: counsellor._id, "meta.supportCase": later.id }), 0);
  const future = new Date(Date.now() + 2 * 86400000);
  assert.equal(await support.followUpSweep(future), 1);
  assert.equal(await support.followUpSweep(future), 0);
  assert.equal(await Notification.countDocuments({ user: other._id, kind: "SUPPORT_FOLLOW_UP_DUE" }), 1);
  assert.equal(await Notification.countDocuments({ user: counsellor._id, kind: "SUPPORT_FOLLOW_UP_DUE" }), 1);
});

itest("an explicit unsafe signal shows safety contacts and alerts the team", async () => {
  const fresh = await User.create({ name: "S THREE", email: "s3@t.in", password: "Campus@2026", role: "STUDENT", studentId: "T/3" });
  const out = await support.recordCheckIn(fresh, { answers: {}, unsafe: true });
  assert.equal(out.band, "IMMEDIATE_ATTENTION");
  assert.ok(out.safety);
  assert.equal(out.escalated.urgent, true);
  assert.ok(await Notification.findOne({ user: counsellor._id, kind: "SUPPORT_REQUEST_NEW", title: /Urgent/ }));
});

itest("the overview is aggregate-only, and small counts are hidden from admins", async () => {
  const forTeam = await support.overview(counsellor);
  const forAdmin = await support.overview(admin);
  assert.ok(forTeam.kpis.requests >= 3);
  assert.equal(forAdmin.suppressedBelow, 3);
  const text = JSON.stringify(forAdmin);
  for (const secret of ["S ONE", "S TWO", "T/1", "SUP-"]) assert.equal(text.includes(secret), false, secret);
  assert.equal(forAdmin.kpis.urgentOpen, null); // exactly one urgent case → hidden for admin
  assert.equal(forTeam.kpis.urgentOpen, 1);
});

itest("asking to talk after 'check on me later' upgrades the same request", async () => {
  const fresh = await User.create({ name: "S FOUR", email: "s4@t.in", password: "Campus@2026", role: "STUDENT", studentId: "T/4" });
  const { case: later } = await support.createRequest(fresh, { preference: "CHECK_LATER", followUpDays: 3 });
  const { case: upgraded, existing } = await support.createRequest(fresh, { preference: "COUNSELLOR" });
  assert.equal(existing, false);
  assert.equal(upgraded.id, later.id);
  assert.equal(upgraded.status, "REQUESTED");
  assert.equal(upgraded.preference, "COUNSELLOR");
  assert.ok(await Notification.findOne({ user: counsellor._id, kind: "SUPPORT_REQUEST_NEW", "meta.supportCase": later.id }));
});
