/**
 * Student intelligence: attendance classification, mess demand and feedback
 * analysis, the what-if simulators and the question router.
 *
 * Everything here runs on plain arrays — no database — because the analysis
 * functions are pure. The route checks at the bottom boot the app with no
 * database to prove the new endpoints are guarded and validated.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";

process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/test";
process.env.JWT_SECRET ||= "a-test-secret-that-is-long-enough-1234";
process.env.NODE_ENV = "test";

const { analyseAttendance, classifyPattern, flattenSessions, statusOf } = await import("../src/services/attendanceIntelligenceService.js");
const { simulate } = await import("../src/services/attendanceService.js");
const mess = await import("../src/services/messIntelligenceService.js");
const { detectIntent, extractEntities } = await import("../src/services/studentIntelligenceService.js");

const DAY = 864e5;
const NOW = new Date("2026-09-24T18:00:00");

/** A subject whose `pattern` marks each class, oldest first: 1 present, 0 absent. */
function subject(name, pattern, { everyDays = 2, slot = "08:00", planned } = {}) {
  const sessions = pattern.map((present, i) => ({
    date: new Date(NOW.getTime() - (pattern.length - i) * everyDays * DAY),
    slot,
    present: Boolean(present)
  }));
  const attended = pattern.filter(Boolean).length;
  return { _id: name, subject: name, totalClasses: pattern.length, attendedClasses: attended, semesterPlanned: planned, sessions };
}

// ---- attendance ----------------------------------------------------------------

test("statusOf reads old rows that only carry `present`", () => {
  assert.equal(statusOf({ present: true }), "PRESENT");
  assert.equal(statusOf({ present: false }), "ABSENT");
  assert.equal(statusOf({ present: true, status: "LATE" }), "LATE");
});

test("LATE counts as attended and LEAVE as missed", () => {
  const rows = flattenSessions([{ subject: "X", sessions: [
    { date: new Date(), slot: "08:00", present: true, status: "LATE" },
    { date: new Date(), slot: "08:00", present: false, status: "LEAVE" }
  ] }]);
  assert.deepEqual(rows.map((r) => r.present), [true, false]);
});

test("a clear recent fall is classified DECLINING with its reasons", () => {
  // 14 classes a day apart: the first seven attended, then four of the last seven missed.
  const record = subject("DBMS", [1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 1, 0], { everyDays: 1 });
  const cls = classifyPattern(flattenSessions([record]), { now: NOW, windowDays: 7 });
  assert.equal(cls.pattern, "DECLINING");
  assert.ok(cls.reasons[0].includes("Last 7 days"));
  assert.ok(cls.confidence >= 40 && cls.confidence <= 94);
});

test("a single absence in a small subject is not called a decline", () => {
  const record = subject("MATHS", [1, 1, 1, 1, 1, 1, 0], { everyDays: 3 });
  const cls = classifyPattern(flattenSessions([record]), { now: NOW, windowDays: 9 });
  assert.notEqual(cls.pattern, "DECLINING");
});

test("a recovery is classified IMPROVING", () => {
  const record = subject("OS", [0, 1, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1], { everyDays: 1 });
  const cls = classifyPattern(flattenSessions([record]), { now: NOW, windowDays: 7 });
  assert.equal(cls.pattern, "IMPROVING");
});

test("too few classes gives INSUFFICIENT DATA and no confidence", () => {
  const record = subject("CS", [1, 0], { everyDays: 7 });
  const cls = classifyPattern(flattenSessions([record]), { now: NOW, windowDays: 14 });
  assert.equal(cls.pattern, "INSUFFICIENT DATA");
  assert.equal(cls.confidence, null);
});

test("analyseAttendance: status, margins and the why-breakdown come from the register", () => {
  const records = [
    subject("DBMS", [1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 1, 0], { everyDays: 1, planned: 40 }),
    subject("DS", [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], { everyDays: 1, slot: "11:00", planned: 40 })
  ];
  const a = analyseAttendance(records, { now: NOW, windowDays: 7 });
  assert.equal(a.totalClasses, 28);
  assert.equal(a.attendedClasses, 24);
  assert.equal(a.overall, 85.7);
  assert.equal(a.status, "SAFE");
  assert.equal(a.why.missed, 4);
  assert.equal(a.why.bySubject[0].subject, "DBMS");
  assert.equal(a.why.bySlot[0].slot, "08:00");
  assert.equal(a.subjects.find((s) => s.subject === "DBMS").trend, "DOWN");
  // End of semester is only projected because semesterPlanned is known.
  assert.equal(a.semester.planned, 80);
  assert.equal(a.semester.remaining, 52);
});

test("analyseAttendance without semesterPlanned does not guess the semester", () => {
  const a = analyseAttendance([subject("DBMS", [1, 0, 1, 1])], { now: NOW });
  assert.equal(a.semester, null);
});

test("analyseAttendance with no records says so instead of inventing numbers", () => {
  const a = analyseAttendance([], { now: NOW });
  assert.equal(a.empty, true);
  assert.match(a.message, /No attendance/);
});

test("the risk ladder: CRITICAL below threshold-10, AT RISK below threshold, WATCH within 5", () => {
  const at = (attended, total) => analyseAttendance([{ subject: "X", totalClasses: total, attendedClasses: attended, sessions: [] }], { now: NOW });
  assert.equal(at(6, 10).status, "CRITICAL");
  assert.equal(at(7, 10).status, "AT RISK");
  assert.equal(at(39, 50).status, "WATCH");
  assert.equal(at(9, 10).status, "SAFE");
});

test("the original simulate() contract is unchanged", () => {
  const r = simulate({ attendedClasses: 33, totalClasses: 46, plannedClasses: 3, attendPlanned: 0 });
  assert.equal(r.projected, 67.3);
  assert.equal(r.method, "ARITHMETIC_PROJECTION");
  assert.equal(r.explanation, "(33 + 0) / (46 + 3) = 67.3%");
});

// ---- mess ------------------------------------------------------------------------

test("feedback themes and sentiment are derived from the comment", () => {
  const a = mess.classifyFeedback({ comment: "Portion was too small, still hungry.", rating: 2 });
  assert.deepEqual(a.themes, ["QUANTITY"]);
  assert.equal(a.sentiment, "NEGATIVE");
  const b = mess.classifyFeedback({ comment: "Egg curry finished before I reached, and it was cold", rating: 1 });
  assert.ok(b.themes.includes("AVAILABILITY") && b.themes.includes("TEMPERATURE"));
  assert.deepEqual(mess.classifyFeedback({ comment: "", rating: 5 }).themes, []);
  assert.deepEqual(mess.classifyFeedback({ comment: "Fine I guess", rating: 3 }).themes, ["OTHER"]);
});

/** Slot records for `days` days of one meal, covers set by `coversFor(day)`. */
function slots(meal, days, coversFor, { capacity = 850 } = {}) {
  const rows = [];
  for (let d = 0; d < days; d += 1) {
    const date = new Date(NOW.getTime() - d * DAY);
    date.setHours(0, 0, 0, 0);
    const covers = coversFor(d, date);
    rows.push({ date, time: "13:00", meal, crowd: Math.round(covers * 0.4), capacity, waste: 6, queueMinutes: 8, menu: [{ item: "EGG CURRY", servings: 1300, takenPercentage: 98, soldOutAt: d % 2 ? "13:20" : undefined }] });
    rows.push({ date, time: "13:30", meal, crowd: covers - Math.round(covers * 0.4), capacity, waste: 6, queueMinutes: 6, menu: [] });
  }
  return rows;
}

test("mealDays folds slots into one row per day and meal", () => {
  const days = mess.mealDays(slots("LUNCH", 3, () => 1000));
  assert.equal(days.length, 3);
  assert.equal(days[0].covers, 1000);
  assert.equal(days[0].peakTime, "13:30");
  assert.equal(days[0].menu[0].item, "EGG CURRY");
});

test("predictMeal uses same-weekday history and reports its spread", () => {
  const days = mess.mealDays(slots("DINNER", 29, () => 2000));
  const p = mess.predictMeal(days, "DINNER", NOW);
  assert.equal(p.predicted, 2000);
  assert.equal(p.low, 2000);
  assert.equal(p.samples.length, 4);
  assert.ok(p.confidence >= 90);
  assert.match(p.method, /SAME_WEEKDAY/);
});

test("predictMeal refuses to predict from under two samples", () => {
  const days = mess.mealDays(slots("DINNER", 5, () => 2000));
  const p = mess.predictMeal(days, "DINNER", NOW);
  assert.equal(p.insufficient, true);
  assert.match(p.reason, /at least 2/);
});

test("classifyDemand compares the day against its baseline", () => {
  const history = mess.mealDays(slots("LUNCH", 29, (d) => (d === 0 ? 2600 : 2000)));
  const today = history.find((row) => row.date === mess.dateKey(NOW));
  const prediction = mess.predictMeal(history, "LUNCH", NOW);
  const demand = mess.classifyDemand(today, prediction);
  assert.equal(demand.label, "HIGH DEMAND");
  assert.match(demand.reasons[0], /\+30%/);
});

test("classifyDemand puts seat utilisation first when that is what decided it", () => {
  const day = { covers: 2000, capacity: 850, peakCrowd: 800, peakTime: "13:00", utilisation: 94.1 };
  const prediction = { predicted: 2000, samples: [1, 2, 3], weekday: "THURSDAY", confidence: 90 };
  const demand = mess.classifyDemand(day, prediction);
  assert.equal(demand.label, "HIGH DEMAND");
  assert.match(demand.reasons[0], /seats/);
});

test("feedbackIntel detects a theme that rose week over week, with samples", () => {
  const rows = [];
  for (let d = 0; d < 14; d += 1) {
    const date = new Date(NOW.getTime() - d * DAY);
    const recent = d < 7;
    rows.push({ date, meal: "DINNER", rating: 2, comment: recent ? "Portion too small" : "Nice", themes: recent ? ["QUANTITY"] : ["OTHER"], sentiment: recent ? "NEGATIVE" : "POSITIVE" });
  }
  const intel = mess.feedbackIntel(rows, { now: NOW, days: 28 });
  assert.equal(intel.responses, 14);
  assert.equal(intel.patterns[0].meal, "DINNER");
  assert.equal(intel.patterns[0].theme, "QUANTITY");
  assert.equal(intel.patterns[0].last7, 7);
  assert.ok(intel.patterns[0].samples.length > 0);
  const quantity = intel.distribution.find((row) => row.theme === "QUANTITY");
  assert.equal(quantity.negative, 7);
});

test("feedbackIntel filters by meal and theme", () => {
  const rows = [
    { date: NOW, meal: "LUNCH", rating: 2, comment: "cold", themes: ["TEMPERATURE"], sentiment: "NEGATIVE" },
    { date: NOW, meal: "DINNER", rating: 2, comment: "small", themes: ["QUANTITY"], sentiment: "NEGATIVE" }
  ];
  assert.equal(mess.feedbackIntel(rows, { now: NOW, meal: "LUNCH" }).responses, 1);
  assert.equal(mess.feedbackIntel(rows, { now: NOW, theme: "QUANTITY" }).responses, 1);
});

test("simulateMeal is arithmetic on the prediction and states its assumptions", () => {
  const prediction = { meal: "DINNER", date: "2026-09-25", predicted: 2000, peakCrowd: 700, capacity: 850 };
  const r = mess.simulateMeal({ prediction, scenario: { attendanceChangePct: 10 } });
  assert.equal(r.expected, 2200);
  assert.equal(r.prepared, 2100);
  assert.equal(r.shortage, 100);
  assert.equal(r.surplus, 0);
  assert.equal(r.peakCrowd, 770);
  assert.equal(r.kind, "SIMULATED RESULT");
  assert.ok(r.assumptions.length >= 3);
  const fewer = mess.simulateMeal({ prediction, scenario: { attendanceChange: -300 } });
  assert.equal(fewer.expected, 1700);
  assert.equal(fewer.surplus, 400);
  assert.equal(fewer.surplusKg, 140);
});

test("simulateMeal: an item selection shift projects when it runs out", () => {
  const prediction = { meal: "LUNCH", date: "2026-09-25", predicted: 2000, peakCrowd: 700, capacity: 850 };
  const day = { menu: [{ item: "EGG CURRY", servings: 1000, takenPercentage: 90 }] };
  const r = mess.simulateMeal({ prediction, day, scenario: { item: "EGG CURRY", selectionShiftPct: 20 } });
  assert.equal(r.item.currentDemand, 900);
  assert.equal(r.item.projectedDemand, 1080);
  assert.equal(r.item.shortfall, 80);
  assert.match(r.item.runsOutAt, /^14:/);
});

test("simulateMeal without a prediction says why instead of guessing", () => {
  const r = mess.simulateMeal({ prediction: { insufficient: true, reason: "no history" } });
  assert.equal(r.insufficient, true);
});

test("menuStats ranks uptake and counts sell-outs", () => {
  const stats = mess.menuStats(mess.mealDays(slots("LUNCH", 4, () => 1000)));
  assert.equal(stats[0].item, "EGG CURRY");
  assert.equal(stats[0].soldOutCount, 2);
});

// ---- question routing ------------------------------------------------------------

test("the example questions route to the right intent and domain", () => {
  const cases = [
    ["Why did my attendance fall this month?", "ATT_WHY_CHANGE"],
    ["What happens if I miss 3 classes?", "ATT_WHAT_IF"],
    ["Which days did I have the lowest attendance?", "ATT_LOWEST"],
    ["What is causing my attendance risk?", "ATT_RISK"],
    ["What meals are most frequently unavailable?", "MESS_UNAVAILABLE"],
    ["Which meal is most popular?", "MESS_POPULAR"],
    ["Why is dinner demand increasing?", "MESS_WHY_DEMAND"],
    ["What meals receive the most negative feedback?", "MESS_FEEDBACK"],
    ["What happens if 15% more students choose dinner?", "MESS_WHAT_IF"]
  ];
  for (const [question, intent] of cases) assert.equal(detectIntent(question).intent, intent, question);
});

test("an unrelated question matches no intent", () => {
  assert.equal(detectIntent("tell me a joke").intent, null);
});

test("entities: subjects, meals, counts and percentages", () => {
  assert.equal(extractEntities("What if I miss 2 OS classes").subject, "OPERATING SYSTEMS");
  assert.equal(extractEntities("What if I miss 2 OS classes").count, 2);
  assert.equal(extractEntities("how is my maths attendance").subject, "DISCRETE MATHS");
  assert.equal(extractEntities("what if I miss three classes").count, 3);
  assert.equal(extractEntities("15% more students choose dinner").percent, 15);
  assert.equal(extractEntities("15% fewer students at lunch").percent, -15);
  assert.equal(extractEntities("15% fewer students at lunch").meal, "LUNCH");
});

// ---- routes ------------------------------------------------------------------------

const { createApp } = await import("../src/app.js");
let server;
let base;
before(async () => {
  await new Promise((resolve) => { server = createApp().listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

async function hit(method, path, body) {
  const res = await fetch(base + path, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test("the new student routes require an account", async () => {
  for (const [method, path] of [
    ["GET", "/api/attendance/me/intelligence"],
    ["GET", "/api/students/me/intelligence"],
    ["POST", "/api/students/me/query"],
    ["POST", "/api/mess/feedback"]
  ]) {
    const res = await hit(method, path, method === "POST" ? {} : undefined);
    assert.equal(res.status, 401, `${method} ${path}`);
  }
});

test("the mess simulator validates its input before touching data", async () => {
  const res = await hit("POST", "/api/mess/simulate", { meal: "BRUNCH" });
  assert.equal(res.status, 400);
  assert.ok(res.body.details.meal);
  const pct = await hit("POST", "/api/mess/simulate", { attendanceChangePct: 900 });
  assert.equal(pct.status, 400);
});
