/**
 * Round 3 — Prove / Optimise / Audit / Prevent: unit tests for every
 * algorithm (no database needed). Each test feeds a small, hand-checkable
 * input and asserts the arithmetic, the minimum-data refusal and the label.
 */
import assert from "node:assert/strict";
import test from "node:test";

process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/test";
process.env.JWT_SECRET ||= "a-test-secret-that-is-long-enough-1234";

const stats = await import("../src/services/proof/stats.js");
const pm = await import("../src/services/proof/processMining.js");
const did = await import("../src/services/proof/impactProof.js");
const lint = await import("../src/services/proof/noticeLint.js");
const history = await import("../src/services/proof/noticeHistory.js");
const presence = await import("../src/services/proof/presenceForecast.js");
const att = await import("../src/services/proof/attendanceProof.js");
const pf = await import("../src/services/proof/preflight.js");
const port = await import("../src/services/proof/portfolio.js");
const eq = await import("../src/services/proof/equity.js");
const ub = await import("../src/services/proof/unblock.js");
const rel = await import("../src/services/proof/reliability.js");

const H = 36e5;
const D = 864e5;
const T0 = Date.UTC(2026, 8, 1, 4, 0);

// ---- statistics -------------------------------------------------------------------------

test("stats: quantile interpolates, and the Gini coefficient matches the written formula", () => {
  assert.equal(stats.quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(stats.median([5]), 5);
  assert.equal(stats.gini([5, 5, 5, 5]), 0, "equal load → 0");
  // Σ|xi−xj| over ordered pairs = 2 × (1 + 2 + 1) × … for [1, 2, 3]: pairs 1,2,1 each twice = 8; 2·n²·μ = 2·9·2 = 36
  assert.equal(stats.round(stats.gini([1, 2, 3]), 4), stats.round(8 / 36, 4));
  assert.equal(stats.gini([]), null);
});

test("stats: the bootstrap is reproducible with a seed and brackets the true mean", () => {
  const xs = Array.from({ length: 40 }, (_, i) => i % 7);
  const a = stats.bootstrap([xs], (s) => stats.mean(s), { seed: 11 });
  const b = stats.bootstrap([xs], (s) => stats.mean(s), { seed: 11 });
  assert.deepEqual(a, b, "same seed → same interval");
  const m = stats.mean(xs);
  assert.ok(a.low < m && m < a.high);
  assert.equal(a.iterations, 1000);
  assert.equal(a.level, 0.9);
});

// ---- F1 process mining --------------------------------------------------------------------

function complaintCase(i, { reassign = 0, reopen = false, wait = 2 } = {}) {
  const at = (h) => new Date(T0 + i * D + h * H);
  const id = `c${i}`;
  const ev = [
    { type: "COMPLAINT_CREATED", subjectId: id, subjectRef: `CMP-${i}`, at: at(0) },
    { type: "COMPLAINT_CLASSIFIED", subjectId: id, subjectRef: `CMP-${i}`, at: at(0.05) },
    { type: "COMPLAINT_ASSIGNED", subjectId: id, subjectRef: `CMP-${i}`, at: at(0.5), department: i % 2 ? "MAINTENANCE · PLUMBING" : "IT · NETWORK" }
  ];
  for (let r = 0; r < reassign; r += 1) ev.push({ type: "COMPLAINT_ASSIGNED", subjectId: id, subjectRef: `CMP-${i}`, at: at(1 + r), actorName: "Admin", humanTouch: true });
  ev.push({ type: "COMPLAINT_STATUS_CHANGED", subjectId: id, subjectRef: `CMP-${i}`, at: at(0.5 + reassign + wait), payload: { to: "INVESTIGATING" }, actorName: i % 3 ? "Plumber" : "Tech", humanTouch: true, department: i % 2 ? "MAINTENANCE · PLUMBING" : "IT · NETWORK" });
  ev.push({ type: "COMPLAINT_RESOLVED", subjectId: id, subjectRef: `CMP-${i}`, at: at(0.5 + reassign + wait + 3), actorName: "Plumber", humanTouch: true });
  if (reopen) ev.push({ type: "COMPLAINT_REOPENED", subjectId: id, subjectRef: `CMP-${i}`, at: at(60) });
  return ev;
}

test("process mining: activities, traces and the directly-follows graph with waits", () => {
  const events = complaintCase(1, { wait: 20 });
  const [trace] = pm.traces(events);
  assert.deepEqual(trace.steps.map((s) => s.activity), ["SUBMITTED", "CLASSIFIED", "ASSIGNED", "INVESTIGATING", "RESOLVED"]);
  const g = pm.directlyFollows([trace]);
  const edge = g.edges.find((e) => e.from === "ASSIGNED" && e.to === "INVESTIGATING");
  assert.equal(edge.medianHours, 20);
  assert.equal(edge.slowShare, 100, "20 h > the 18 h slow line");
});

test("process mining: conformance names reassignment loops, rework and skipped steps", () => {
  const model = pm.WORKFLOWS.complaint;
  const loop = pm.conformance(pm.traces(complaintCase(2, { reassign: 2 }))[0], model);
  assert.equal(loop.conforms, false);
  assert.ok(loop.issues.some((i) => i.kind === "REASSIGNED" && /3 times/.test(i.detail)));
  const rework = pm.conformance(pm.traces(complaintCase(3, { reopen: true }))[0], model);
  assert.ok(rework.issues.some((i) => i.kind === "REWORK"));
  const skip = pm.conformance(pm.traces([{ type: "COMPLAINT_CREATED", subjectId: "x", at: new Date(T0) }, { type: "COMPLAINT_RESOLVED", subjectId: "x", at: new Date(T0 + H) }])[0], model);
  assert.ok(skip.issues.some((i) => i.kind === "SKIPPED" && /CLASSIFIED, ASSIGNED/.test(i.detail)), "INVESTIGATING is optional, CLASSIFIED and ASSIGNED are not");
  const clean = pm.conformance(pm.traces(complaintCase(4))[0], model);
  assert.equal(clean.conforms, true);
});

test("process mining: the bottleneck is the forward edge with the largest median × cases, and rework / Gini are computed", () => {
  const events = [];
  for (let i = 0; i < 12; i += 1) events.push(...complaintCase(i, { wait: i % 2 ? 24 : 2, reassign: i === 5 ? 2 : 0, reopen: i === 7 }));
  const r = pm.mine(events, { workflow: "complaint", days: 30 });
  assert.equal(r.insufficient, false);
  assert.equal(r.bottleneck.from, "ASSIGNED");
  assert.equal(r.bottleneck.to, "INVESTIGATING");
  assert.equal(r.bottleneck.byDepartment[0].department, "MAINTENANCE · PLUMBING", "the slow department is named");
  assert.match(r.bottleneck.text, /MAINTENANCE · PLUMBING/);
  assert.deepEqual(r.conformance.reassignedTwicePlus, ["CMP-5"]);
  assert.equal(r.rework.reopened, 1);
  assert.equal(r.rework.resolved, 12);
  assert.ok(r.load.gini >= 0 && r.load.gini <= 1);
  assert.equal(r.recommendation.kind, "RECOMMENDED ACTION");
});

test("process mining: fewer than 10 completed cases → 'Insufficient data to mine this workflow'", () => {
  const events = [];
  for (let i = 0; i < 9; i += 1) events.push(...complaintCase(i));
  const r = pm.mine(events, { workflow: "complaint" });
  assert.equal(r.insufficient, true);
  assert.match(r.text, /Insufficient data to mine this workflow/);
  assert.equal(r.kind, "INSUFFICIENT DATA");
});

// ---- F2 difference-in-differences -------------------------------------------------------

const flat = (v, n = 14) => new Array(n).fill(v);

test("DiD: a fall in the treated block beyond the controls is EFFECTIVE, with the formula and avoided complaints", () => {
  const treatedPre = [1, 2, 1, 1, 2, 1, 1, 2, 1, 1, 2, 1, 1, 1];
  const treatedPost = [0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0];
  const controlPre = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1];
  const controlPost = [1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1];
  const r = did.differenceInDifferences({ treatedPre, treatedPost, controlPre, controlPost });
  const expected = stats.mean(treatedPost) - stats.mean(treatedPre) - (stats.mean(controlPost) - stats.mean(controlPre));
  assert.equal(r.did, stats.round(expected, 2));
  assert.equal(r.verdict, "EFFECTIVE");
  assert.ok(r.interval.high < 0);
  assert.equal(r.parallelTrend.holds, true);
  assert.match(r.formula, /^DiD = \(/);
});

test("DiD: refuses a verdict when pre-period trends differ (parallel-trend check)", () => {
  const rising = Array.from({ length: 14 }, (_, i) => i * 0.3);
  const r = did.differenceInDifferences({ treatedPre: rising, treatedPost: flat(1), controlPre: flat(1), controlPost: flat(1) });
  assert.equal(r.parallelTrend.holds, false);
  assert.equal(r.verdict, "UNRELIABLE");
});

test("DiD: no change relative to controls is INCONCLUSIVE; a rise is NO EFFECT / WORSE", () => {
  const noisy = [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0];
  const same = did.differenceInDifferences({ treatedPre: noisy, treatedPost: [...noisy].reverse(), controlPre: noisy, controlPost: [...noisy].reverse() });
  assert.equal(same.verdict, "INCONCLUSIVE");
  const worse = did.differenceInDifferences({ treatedPre: flat(0), treatedPost: flat(2), controlPre: flat(0), controlPost: flat(0) });
  assert.equal(worse.verdict, "NO EFFECT / WORSE");
});

test("DiD: per-day series from complaint timestamps, and the control average", () => {
  const start = new Date(T0);
  const s = did.dailySeries([{ createdAt: new Date(T0 + 1 * H) }, { createdAt: new Date(T0 + 2 * H) }, { createdAt: new Date(T0 + 3 * D) }, { createdAt: new Date(T0 - D) }], start, 5);
  assert.deepEqual(s, [2, 0, 0, 1, 0]);
  assert.deepEqual(did.averageSeries([[2, 0], [0, 2]]), [1, 1]);
});

// ---- F4 notice linter ------------------------------------------------------------------------

const NOW = new Date("2026-09-27T06:00:00Z"); // Sunday 11:30 IST

test("notice lint: flags a missing venue and turns 'tomorrow' into the absolute date", () => {
  const r = lint.lintText({ title: "DBMS extra class", body: "Extra DBMS class tomorrow at 2 pm. Bring your lab records." }, { now: NOW });
  const rules = r.findings.map((f) => f.rule);
  assert.ok(rules.includes("MISSING_VENUE"));
  assert.ok(rules.includes("RELATIVE_DATE"));
  assert.match(r.findings.find((f) => f.rule === "RELATIVE_DATE").suggestion, /Monday 28 Sep 2026/);
  assert.ok(rules.includes("MISSING_DEADLINE"), "'bring' needs a deadline");
  assert.equal(r.extracted.time, "14:00");
  assert.equal(r.extracted.date, "2026-09-28");
});

test("notice lint: a complete notice passes the essentials", () => {
  const r = lint.lintText({ title: "DBMS extra class", body: "Extra DBMS class on Monday 28 Sep 2026 at 14:00 in Room LH-102. Bring your lab records by 13:50. Questions: academic office, ext 214." }, { now: NOW });
  assert.deepEqual(r.findings, []);
  assert.equal(r.score, 100);
});

test("notice lint: night sending and long sentences are flagged", () => {
  const night = lint.lintText({ title: "Library timing", body: "The library closes at 20:00 on 30 Sep. Contact the librarian." }, { now: new Date("2026-09-27T18:00:00Z") });
  assert.ok(night.findings.some((f) => f.rule === "NIGHT_SEND"));
  const long = lint.lintText({ title: "x", body: `${"word ".repeat(70)}on 30 Sep. Contact office.` }, { now: NOW });
  assert.ok(long.findings.some((f) => f.rule === "READABILITY"));
});

test("notice lint: date extraction handles several formats; timetable overlap is computed", () => {
  assert.equal(lint.extractWhen("Seminar on 3 Oct at 10:30", NOW).dateKey, "2026-10-03");
  assert.equal(lint.extractWhen("Seminar on Oct 3", NOW).dateKey, "2026-10-03");
  assert.equal(lint.extractWhen("Due 2026-10-05", NOW).dateKey, "2026-10-05");
  assert.equal(lint.extractWhen("next Friday", NOW).dateKey, "2026-10-02");
  const schedules = [{ _id: "s1", weekday: 1, startTime: "14:00", endTime: "14:55", subject: "DBMS", branch: "CSE", year: 3, section: "A" }];
  assert.equal(lint.timetableOverlap({ dateKey: "2026-09-28", time: "14:30" }, schedules, []).length, 1);
  assert.equal(lint.timetableOverlap({ dateKey: "2026-09-28", time: "16:00" }, schedules, []).length, 0);
});

test("attention budget: read rate by weekly load, and 'insufficient' until two bands have data", () => {
  const rows = [];
  const week = 7 * D;
  const base = Date.UTC(2026, 6, 6);
  // 4 weeks at 2 notices/week (all read), 4 weeks at 9 notices/week (1 in 3 read), 10 students.
  for (let w = 0; w < 8; w += 1) {
    const n = w < 4 ? 2 : 9;
    for (let j = 0; j < n; j += 1) for (let s = 0; s < 10; s += 1) rows.push({ student: `s${s}`, publishedAt: new Date(base + w * week + j * H), readAt: n === 2 || (j + s) % 3 === 0 ? new Date() : null });
  }
  const r = history.attentionBudget(rows);
  assert.equal(r.bands[0].readRatePct, 100);
  assert.ok(r.bands[2].readRatePct < 40);
  assert.equal(r.relation.falls, true);
  const thin = history.attentionBudget(rows.slice(0, 30));
  assert.equal(thin.relation.kind, "INSUFFICIENT DATA");
});

test("predicted reach: uses historical rates and refuses with fewer than 20 receipts", () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ student: `s${i}`, publishedAt: new Date("2026-09-20T06:00:00Z"), deliveredAt: new Date(), readAt: i % 2 ? new Date() : null, channel: "APP" }));
  const r = history.predictReach(rows, { recipients: 100, channel: "APP", at: new Date("2026-09-27T06:00:00Z") });
  assert.equal(r.read, 50);
  assert.equal(r.kind, "AI PREDICTION");
  assert.match(r.basis, /40 past receipts/);
  assert.equal(history.predictReach(rows.slice(0, 5), { recipients: 10 }).kind, "INSUFFICIENT DATA");
});

// ---- F3 pre-flight helpers ----------------------------------------------------------------

test("pre-flight: a slot inside lunch that covers the peak is a mess collision; threshold edge is exact", () => {
  const hit = pf.mealCollision({ start: 13 * 60, end: 13 * 60 + 55 }, { LUNCH: { time: "13:00", crowd: 780, queueMinutes: 8 } });
  assert.equal(hit.meal, "LUNCH");
  assert.equal(hit.hitsPeak, true);
  assert.equal(pf.mealCollision({ start: 16 * 60, end: 17 * 60 }, {}), null);
  assert.deepEqual(pf.edgeOfThreshold({ attendedClasses: 6, totalClasses: 8 }), { now: 75, ifMissed: 66.7, crosses: true });
  assert.equal(pf.edgeOfThreshold({ attendedClasses: 9, totalClasses: 10 }).crosses, false);
});

// ---- F5 presence-aware forecast -----------------------------------------------------------

test("presence: only passes covering the whole meal window count, and the adjustment line is exact", () => {
  const window = { from: new Date("2026-09-28T06:00:00Z"), to: new Date("2026-09-28T09:00:00Z") };
  const passes = [
    { leaveAt: new Date("2026-09-28T04:30:00Z"), expectedReturnAt: new Date("2026-09-28T12:30:00Z") },
    { leaveAt: new Date("2026-09-28T07:00:00Z"), expectedReturnAt: new Date("2026-09-28T12:30:00Z") }
  ];
  assert.equal(presence.awayDuring(passes, window).length, 1);
  const a = presence.adjustment({ away: 61, participation: 0.76 });
  assert.equal(a.covers, -46);
  assert.match(a.text, /−46 covers: 61 students on approved passes × 0.76 participation/);
});

test("presence backtest: says when the adjustment helps, when it does not, and when there is too little", () => {
  const helps = Array.from({ length: 6 }, (_, i) => ({ date: `d${i}`, actual: 500, predicted: 520, away: 20, adjustment: -15 }));
  assert.equal(presence.backtest(helps).better, true);
  const hurts = Array.from({ length: 6 }, (_, i) => ({ date: `d${i}`, actual: 520, predicted: 520, away: 20, adjustment: -15 }));
  const r = presence.backtest(hurts);
  assert.equal(r.better, false);
  assert.match(r.text, /did not help/);
  assert.equal(presence.backtest(helps.slice(0, 2)).insufficient, true);
});

test("best slot: the lowest queue among free slots, earliest on a tie; none when in class throughout", () => {
  const slots = [{ time: "12:00", queueMinutes: 5, crowd: 300 }, { time: "12:30", queueMinutes: 3, crowd: 200 }, { time: "13:00", queueMinutes: 11, crowd: 800 }, { time: "13:30", queueMinutes: 3, crowd: 400 }];
  const r = presence.bestSlot({ slots, window: ["11:30", "14:30"], busy: [{ start: "12:00", end: "12:55" }] });
  assert.equal(r.best.time, "13:30", "12:30 is inside the class");
  assert.equal(r.peak.time, "13:00");
  assert.equal(presence.bestSlot({ slots, window: ["11:30", "14:30"], busy: [{ start: "11:30", end: "14:30" }] }), null);
});

// ---- F6 attendance ---------------------------------------------------------------------------

test("point of no return: spare classes by the formula, and the date at the recent miss rate", () => {
  const upcoming = Array.from({ length: 10 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
  const r = att.pointOfNoReturn({ attended: 15, held: 20, upcoming, recentMissRate: 0.5 });
  // spare = ⌊15 + 10 − 0.75 × 30⌋ = ⌊2.5⌋ = 2; at 0.5 misses/class the 5th class exceeds 2
  assert.equal(r.spare, 2);
  assert.equal(r.status, "APPROACHING");
  assert.equal(r.noReturnDate, "2026-10-05");
  assert.equal(r.lastSafeDate, "2026-10-04");
  assert.equal(r.classesLeftBeforeNoReturn, 4);
  const passed = att.pointOfNoReturn({ attended: 5, held: 20, upcoming, recentMissRate: 0 });
  assert.equal(passed.status, "PASSED");
  const safe = att.pointOfNoReturn({ attended: 19, held: 20, upcoming, recentMissRate: 0.1 });
  assert.equal(safe.status, "SAFE_AT_RECENT_RATE");
});

test("point of no return: upcoming dates follow the timetable weekdays and skip cancellations", () => {
  const dates = att.upcomingDates([1, 3], "2026-09-27", "2026-10-07", new Set(["2026-09-30"]));
  assert.deepEqual(dates, ["2026-09-28", "2026-10-05", "2026-10-07"]);
});

function student(name, oldPresent, recentPresent) {
  const now = Date.UTC(2026, 8, 27);
  const sessions = [];
  for (let i = 0; i < 6; i += 1) sessions.push({ date: new Date(now - (20 + i) * D), slot: "08:00", present: i < oldPresent });
  for (let i = 0; i < 6; i += 1) sessions.push({ date: new Date(now - (2 + i) * D), slot: "08:00", present: i < recentPresent });
  return { name, studentId: name, sessions };
}

test("systemic vs individual: the section dropping together is SYSTEMIC; one student diverging is INDIVIDUAL", () => {
  const now = new Date(Date.UTC(2026, 8, 27));
  const systemic = att.decompose(["a", "b", "c", "d", "e", "f"].map((n) => student(n, 6, 3)), { now });
  assert.equal(systemic.verdict, "SYSTEMIC");
  assert.equal(systemic.droppedTogether, 6);
  assert.ok(systemic.slots[0].drop >= 40);
  const individual = att.decompose([...["a", "b", "c", "d", "e", "g", "h", "i"].map((n) => student(n, 6, 6)), student("f", 6, 2)], { now });
  assert.equal(individual.verdict, "INDIVIDUAL");
  assert.deepEqual(individual.individuals.map((s) => s.name), ["f"]);
  const thin = att.decompose([student("a", 6, 3)], { now });
  assert.equal(thin.verdict, "INSUFFICIENT DATA");
});

// ---- F7 knapsack ----------------------------------------------------------------------------

test("knapsack: matches brute force on a small instance, and forces mandatory items in", () => {
  const items = [
    { id: "a", hours: 3, value: 60 },
    { id: "b", hours: 2, value: 50 },
    { id: "c", hours: 4, value: 70 },
    { id: "d", hours: 1, value: 25 },
    { id: "e", hours: 5, value: 85 }
  ];
  let best = 0;
  for (let mask = 0; mask < 1 << items.length; mask += 1) {
    const pick = items.filter((_, i) => mask & (1 << i));
    if (pick.reduce((t, i) => t + i.hours, 0) <= 7) best = Math.max(best, pick.reduce((t, i) => t + i.value, 0));
  }
  const r = port.plan(items, 7);
  assert.equal(r.coveredValue, best);
  const forced = port.knapsack([...items, { id: "z", hours: 6, value: 1, mandatory: true }], 7);
  assert.ok(forced.chosen.includes("z"));
  assert.ok(forced.chosen.includes("d"), "the one hour left goes to the best 1-hour item");
  assert.equal(port.knapsack([{ id: "z", hours: 9, value: 1, mandatory: true }], 7).feasible, false);
});

test("portfolio: the marginal value of 4 more hours names what it would add", () => {
  const items = [{ id: "a", title: "Hostel B water", hours: 4, value: 900, students: 120 }, { id: "b", title: "Hostel D Wi-Fi", hours: 4, value: 400, students: 212 }];
  const r = port.plan(items, 4);
  assert.deepEqual(r.selected.map((i) => i.id), ["a"]);
  assert.match(r.marginal.text, /4 more hours would cover Hostel D Wi-Fi \(\+212 students\)/);
  assert.equal(r.leftOut[0].id, "b");
});

// ---- F8 equity -------------------------------------------------------------------------------

test("equity: a gap is flagged only when the interval excludes 1 and both groups have enough", () => {
  const mk = (hours, n) => Array.from({ length: n }, (_, i) => ({ hours: hours + (i % 3), complete: 1 }));
  const slow = eq.compareGroup(mk(30, 12), mk(10, 40), { label: "KIOSK", dimension: "channel" });
  assert.equal(slow.verdict, "SLOWER");
  assert.ok(slow.interval.low > 1);
  const same = eq.compareGroup(mk(10, 12), mk(10, 40), { label: "KIOSK", dimension: "channel" });
  assert.equal(same.verdict, "NO MEASURABLE GAP");
  const thin = eq.compareGroup(mk(30, 3), mk(10, 40), { label: "SMS", dimension: "channel" });
  assert.equal(thin.verdict, "INSUFFICIENT DATA");
});

test("equity: field completeness reads room, description length and evidence", () => {
  assert.equal(eq.completeness({ location: "HOSTEL B · B-214", description: "The tap in the washroom has leaked since yesterday night.", evidence: [{}] }), 1);
  assert.equal(eq.completeness({ location: "HOSTEL B", description: "tap leaking" }), 0);
});

// ---- F9 unblock --------------------------------------------------------------------------------

test("unblock: the blocker shared by most requests wins; request-shape conditions are not student actions", () => {
  const requests = [
    { key: "BONAFIDE", label: "Bonafide", failed: [{ field: "overdueDues", actual: 1200, label: "dues" }] },
    { key: "DOC-1", label: "DOC-1", failed: [{ field: "overdueDues", actual: 1200, label: "dues" }] },
    { key: "PASS", label: "Pass", failed: [{ field: "durationHours", actual: 10 }, { field: "lateReturnsLast30Days", actual: 1 }] }
  ];
  const r = ub.unblockGraph(requests);
  assert.equal(r.best.field, "overdueDues");
  assert.equal(r.best.unblocks, 2);
  assert.match(r.best.action, /₹1,200/);
  assert.deepEqual(r.best.fullyUnblocks, ["Bonafide", "DOC-1"]);
  assert.ok(!r.blockers.some((b) => b.field === "durationHours"));
});

// ---- F10 reliability ----------------------------------------------------------------------

test("MTBF: median gap predicts the next failure; fewer than 3 failures refuses", () => {
  const now = new Date("2026-09-27T00:00:00Z");
  const dates = ["2026-03-01", "2026-04-08", "2026-05-16", "2026-08-27"].map((d) => new Date(`${d}T00:00:00Z`));
  const r = rel.reliability(dates, { now });
  assert.deepEqual(r.gapsDays, [38, 38, 103]);
  assert.equal(r.medianGapDays, 38);
  assert.equal(r.mtbfDays, 60);
  assert.equal(r.sinceLastDays, 31);
  assert.equal(r.dueInDays, 7);
  assert.match(r.recommendation.text, /within 7 days/);
  assert.equal(rel.reliability(dates.slice(0, 2), { now }).insufficient, true);
});
