/**
 * Silent Support System — unit and route tests (no database needed).
 *
 * Covers the support-signal rules, the non-clinical language guard, the
 * optional model phrasing and its fallbacks, the privacy shape of every view,
 * role-based access, and that every new route is mounted and guarded.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";

process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/test";
process.env.JWT_SECRET ||= "a-test-secret-that-is-long-enough-1234";
process.env.NODE_ENV = "test";
// A provider is "configured" so the phrasing path can be exercised with a stubbed fetch.
process.env.AI_PROVIDER = "anthropic";
process.env.AI_API_KEY = "test-key-not-real";
process.env.AI_MODEL = "test-model";

const rules = await import("../src/services/support/supportRules.js");
const { phraseSupportMessage } = await import("../src/services/support/supportAi.js");
const { supportResources, minCellSize, autoEscalateImmediate } = await import("../src/services/support/supportConfig.js");
const { studentView, teamView, TRANSITIONS } = await import("../src/services/support/supportService.js");
const { classifyNotification } = await import("../src/services/notificationPriority.js");
const { authorize } = await import("../src/middleware/auth.js");
const constants = await import("../src/config/constants.js");
const { createApp } = await import("../src/app.js");

// ---- rules -------------------------------------------------------------------

test("support bands: steady answers are STABLE", () => {
  const r = rules.analyseCheckIn({ feeling: 4, study: 3, connection: 4, helpComfort: 3 });
  assert.equal(r.band, "STABLE");
  assert.equal(r.suggestHelp, false);
});

test("support bands: some difficulty is COULD_BENEFIT, not more", () => {
  const r = rules.analyseCheckIn({ feeling: 2, study: 2, connection: 3, helpComfort: 4 });
  assert.equal(r.band, "COULD_BENEFIT");
  assert.equal(r.suggestHelp, true);
  assert.ok(r.reasons.some((line) => /studying/i.test(line)));
});

test("support bands: the same difficulty repeated across check-ins becomes SUPPORT_RECOMMENDED", () => {
  const r = rules.analyseCheckIn({ feeling: 2, study: 2, connection: 3, helpComfort: 4 }, { previous: [{ score: 6 }] });
  assert.equal(r.repeatedDifficulty, true);
  assert.equal(r.band, "SUPPORT_RECOMMENDED");
});

test("support bands: hard answers across the board are SUPPORT_RECOMMENDED", () => {
  assert.equal(rules.analyseCheckIn({ feeling: 1, study: 1, connection: 1, helpComfort: 1 }).band, "SUPPORT_RECOMMENDED");
});

test("support bands: an explicit 'not safe' is always IMMEDIATE_ATTENTION, whatever the answers", () => {
  assert.equal(rules.analyseCheckIn({ feeling: 5, study: 5, connection: 5, helpComfort: 5 }, { unsafe: true }).band, "IMMEDIATE_ATTENTION");
  assert.equal(rules.analyseCheckIn({}, { unsafe: true }).band, "IMMEDIATE_ATTENTION");
});

test("skipped questions are allowed and out-of-range answers are ignored", () => {
  const r = rules.analyseCheckIn({ feeling: 9, study: undefined, connection: "", helpComfort: 0 });
  assert.equal(r.answered, 0);
  assert.equal(r.band, "STABLE");
});

test("finding asking for help hard puts the quiet options first", () => {
  const r = rules.analyseCheckIn({ helpComfort: 1 });
  assert.deepEqual(r.options.slice(0, 2), ["ANONYMOUS", "CHECK_LATER"]);
  assert.equal(new Set(r.options).size, r.options.length);
});

test("every rule-based message and reason uses non-clinical language", () => {
  for (const band of constants.SUPPORT_BANDS) {
    assert.ok(rules.isSafeLanguage(rules.studentMessage(band)), band);
    assert.ok(rules.isSafeLanguage(rules.nextStepFor(band)), band);
  }
  const all = rules.analyseCheckIn({ feeling: 1, study: 1, connection: 1, helpComfort: 1 }, { previous: [{ score: 9 }] });
  for (const line of all.reasons) assert.ok(rules.isSafeLanguage(line), line);
  for (const text of ["You have depression.", "This looks like an anxiety disorder", "clinically low mood", "We diagnosed stress"]) {
    assert.equal(rules.isSafeLanguage(text), false, text);
  }
});

test("the team recommendation is an action for a person, and urgent always comes first", () => {
  assert.match(rules.recommendedAction({ urgent: true, preference: "MENTOR", repeatedDifficulty: true }), /as soon as possible/);
  assert.match(rules.recommendedAction({ repeatedDifficulty: true, preference: "MENTOR" }), /mentor check-in/);
  assert.match(rules.recommendedAction({ preference: "CHECK_LATER" }), /check-in/);
});

// ---- AI phrasing -------------------------------------------------------------

const realFetch = globalThis.fetch;
function stubModel(json) {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: JSON.stringify(json) }] }) });
}

test("model wording is used only when it is safe, and it is labelled", async (t) => {
  t.after(() => { globalThis.fetch = realFetch; });
  stubModel({ message: "Thanks for checking in — would you like to talk to someone this week?", nextStep: "Request a private chat." });
  const analysis = rules.analyseCheckIn({ feeling: 2, study: 2 });
  const out = await phraseSupportMessage(analysis);
  assert.equal(out.source, "AI_MODEL");
  assert.equal(out.model, "test-model");
  assert.match(out.message, /talk to someone/);
});

test("clinical model wording is rejected and the rule-based text is used", async (t) => {
  t.after(() => { globalThis.fetch = realFetch; });
  stubModel({ message: "You may have depression.", nextStep: "See a psychiatrist for a diagnosis." });
  const analysis = rules.analyseCheckIn({ feeling: 2, study: 2 });
  const out = await phraseSupportMessage(analysis);
  assert.equal(out.message, analysis.message);
  assert.equal(out.nextStep, analysis.nextStep);
  assert.equal(out.source, "DETERMINISTIC_FALLBACK");
  assert.equal(out.model, null);
});

test("a provider failure falls back gracefully", async (t) => {
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = async () => { throw new Error("network down"); };
  const analysis = rules.analyseCheckIn({ connection: 1 });
  const out = await phraseSupportMessage(analysis);
  assert.equal(out.source, "DETERMINISTIC_FALLBACK");
  assert.equal(out.message, analysis.message);
});

test("the safety message is fixed: no model is called for IMMEDIATE_ATTENTION", async (t) => {
  let called = false;
  t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = async () => { called = true; throw new Error("should not be called"); };
  const analysis = rules.analyseCheckIn({}, { unsafe: true });
  const out = await phraseSupportMessage(analysis);
  assert.equal(called, false);
  assert.equal(out.message, analysis.message);
});

// ---- configuration -------------------------------------------------------------

test("emergency contacts come only from configuration — none are invented", () => {
  delete process.env.SUPPORT_EMERGENCY_CONTACTS;
  const empty = supportResources();
  assert.equal(empty.configured, false);
  assert.deepEqual(empty.emergency, []);
  assert.doesNotMatch(empty.guidance, /\d{3,}/);

  process.env.SUPPORT_EMERGENCY_CONTACTS = "Campus Security|Ext 100;Medical Centre|Ext 200|Ground floor;broken-entry";
  const set = supportResources();
  assert.equal(set.configured, true);
  assert.deepEqual(set.emergency.map((row) => row.label), ["Campus Security", "Medical Centre"]);
  assert.equal(set.emergency[1].note, "Ground floor");

  process.env.SUPPORT_EMERGENCY_CONTACTS = JSON.stringify([{ label: "Helpdesk", contact: "Ext 300" }]);
  assert.equal(supportResources().emergency[0].contact, "Ext 300");
  delete process.env.SUPPORT_EMERGENCY_CONTACTS;
});

test("switches have safe defaults", () => {
  assert.equal(minCellSize(), 3);
  assert.equal(autoEscalateImmediate(), true);
});

// ---- privacy shape of the views ---------------------------------------------------

const baseCase = (extra = {}) => ({
  _id: "64b000000000000000000001",
  reference: "SUP-000001",
  student: "64b000000000000000000002",
  origin: "STUDENT_REQUEST",
  preference: "COUNSELLOR",
  anonymous: false,
  preferredTime: "EVENING",
  urgent: false,
  band: "SUPPORT_RECOMMENDED",
  repeatedDifficulty: true,
  status: "ASSIGNED",
  assignedTo: "64b000000000000000000003",
  teamNote: "Met briefly; prefers evenings.",
  history: [{ status: "REQUESTED", at: new Date() }, { status: "ASSIGNED", at: new Date() }],
  createdAt: new Date(),
  updatedAt: new Date(),
  ...extra
});
const student = { name: "A STUDENT", studentId: "BPUT/1", department: "CSE", hostelName: "HOSTEL A", email: "a@x", phone: "999", parentPhone: "888" };

test("the student's view never carries the team note or who is assigned", () => {
  const view = studentView(baseCase());
  assert.equal("teamNote" in view, false);
  assert.equal("assignedTo" in view, false);
  assert.equal("band" in view, false);
  assert.equal(view.steps.length, 5);
  assert.equal(view.steps[1].done, true);
});

test("the team's view is minimum-necessary and never carries contact numbers or check-in answers", () => {
  const view = teamView(baseCase(), { student, viewerId: "64b000000000000000000003" });
  assert.deepEqual(Object.keys(view.student).sort(), ["department", "hostelName", "name", "studentId"]);
  assert.equal(view.assignedToMe, true);
  assert.equal("answers" in view, false);
  assert.equal(JSON.stringify(view).includes("999"), false);
  assert.equal(view.insight.kind, "RECOMMENDED ACTION");
});

test("an anonymous request never reveals who the student is", () => {
  const view = teamView(baseCase({ anonymous: true }), { student });
  assert.equal(view.student, null);
  assert.equal(JSON.stringify(view).includes("A STUDENT"), false);
});

test("closed cases cannot move", () => {
  assert.deepEqual(TRANSITIONS.RESOLVED, []);
  assert.deepEqual(TRANSITIONS.WITHDRAWN, []);
  assert.deepEqual(TRANSITIONS.REQUESTED, ["ASSIGNED"]);
});

// ---- notifications and roles -------------------------------------------------------

test("support notification kinds are graded and reuse the existing notification enum", () => {
  for (const kind of constants.SUPPORT_NOTIFICATION_KINDS) {
    assert.ok(constants.NOTIFICATION_KINDS.includes(kind));
    assert.notEqual(classifyNotification({ kind }).priorityReason, "No grading rule for this notification kind yet.");
  }
  assert.ok(constants.NOTIFICATION_AUDIENCES.includes("SUPPORT_TEAM"));
});

test("the counsellor role is narrow: not a staff role, and only it opens individual cases", () => {
  assert.ok(constants.ALL_ROLES.includes("COUNSELLOR"));
  assert.equal(constants.STAFF_ROLES.includes("COUNSELLOR"), false);
  assert.deepEqual(constants.SUPPORT_TEAM_ROLES, ["COUNSELLOR"]);
});

function runGuard(middleware, role) {
  let error;
  middleware({ user: { role } }, {}, (err) => { error = err; });
  return error?.status || 200;
}

test("role checks: only COUNSELLOR reaches the queue; ADMIN reaches only the aggregate overview", () => {
  const queue = authorize(constants.SUPPORT_TEAM_ROLES);
  const overview = authorize(constants.SUPPORT_OVERVIEW_ROLES);
  for (const role of ["STUDENT", "ADMIN", "WARDEN", "FACILITY_MANAGER", "MESS_MANAGER"]) assert.equal(runGuard(queue, role), 403, role);
  assert.equal(runGuard(queue, "COUNSELLOR"), 200);
  assert.equal(runGuard(overview, "ADMIN"), 200);
  assert.equal(runGuard(overview, "COUNSELLOR"), 200);
  for (const role of ["STUDENT", "WARDEN", "FACILITY_MANAGER", "MESS_MANAGER"]) assert.equal(runGuard(overview, role), 403, role);
});

// ---- routes ----------------------------------------------------------------------

let server;
let base;
before(async () => {
  const app = createApp();
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

const ROUTES = [
  ["GET", "/api/support/me"],
  ["POST", "/api/support/check-in"],
  ["POST", "/api/support/requests"],
  ["POST", "/api/support/check-later"],
  ["POST", "/api/support/requests/507f1f77bcf86cd799439011/withdraw"],
  ["GET", "/api/support/resources"],
  ["GET", "/api/support/queue"],
  ["POST", "/api/support/cases/507f1f77bcf86cd799439011/status"],
  ["GET", "/api/support/overview"]
];

test("every support route is mounted, and refuses anonymous callers", async () => {
  for (const [method, path] of ROUTES) {
    const res = await realFetch(base + path, { method, headers: { "content-type": "application/json" }, body: method === "POST" ? "{}" : undefined });
    assert.equal(res.status, 401, `${method} ${path}`);
  }
});

test("existing routes still answer as before", async () => {
  const res = await realFetch(`${base}/api`);
  assert.equal(res.status, 200);
  const notifications = await realFetch(`${base}/api/ai/notifications`);
  assert.equal(notifications.status, 401);
});
