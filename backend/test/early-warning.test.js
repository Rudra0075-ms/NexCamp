/**
 * Early warning, recurring-issue intelligence and Campus Pulse (PS07).
 *
 * The pure functions only: every threshold and every "insufficient data"
 * branch is checked without a database.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  INSUFFICIENT,
  analyseTrend,
  buildSignals,
  campusPulse,
  contributors,
  dailySeries,
  enrichPattern,
  explainSignal,
  parseRoom,
  tierFromRecurring
} from "../src/services/earlyWarningService.js";

const NOW = new Date(2026, 8, 25, 12, 0, 0);
const daysAgo = (n, h = 10) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  d.setHours(h, 0, 0, 0);
  return d;
};
const series = (values) => values.map((value, i) => ({ date: `d${i}`, value, n: value === null ? 0 : 1 }));

test("parseRoom reads a room and its floor, and never guesses one", () => {
  assert.deepEqual(parseRoom("HOSTEL B · B-214"), { room: "B-214", block: "B", floor: 2 });
  assert.deepEqual(parseRoom("room c-1103"), { room: "C-1103", block: "C", floor: 11 });
  assert.equal(parseRoom("2nd floor washroom").floor, 2);
  assert.equal(parseRoom("near the main gate"), null);
  assert.equal(parseRoom(undefined), null);
});

test("dailySeries counts per local day and leaves an empty mean day unknown", () => {
  const rows = [{ at: daysAgo(0) }, { at: daysAgo(0, 23) }, { at: daysAgo(2) }, { at: daysAgo(40) }];
  const counts = dailySeries(rows, { dateOf: (r) => r.at, days: 3, now: NOW });
  assert.deepEqual(counts.map((p) => p.value), [1, 0, 2]);
  const means = dailySeries([{ at: daysAgo(0), v: 4 }, { at: daysAgo(0), v: 2 }], { dateOf: (r) => r.at, valueFn: (r) => r.v, agg: "mean", days: 2, now: NOW });
  assert.deepEqual(means.map((p) => p.value), [null, 3]);
});

test("analyseTrend refuses a verdict on thin data", () => {
  const t = analyseTrend(series([1, null, null, 2, 3, null, null, 1, 2, null, null, null, null, 4]));
  assert.equal(t.sufficient, false);
  assert.equal(t.status, "INSUFFICIENT DATA");
  assert.equal(t.tier, "NORMAL");
});

test("analyseTrend tiers a harmful rise and counts the consecutive run", () => {
  const rising = analyseTrend(series([2, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 4, 5, 6]));
  assert.equal(rising.status, "RISING");
  assert.equal(rising.consecutive, 3);
  assert.equal(rising.tier, "CRITICAL");

  const flat = analyseTrend(series([5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]));
  assert.equal(flat.tier, "NORMAL");
  assert.equal(flat.status, "STABLE");
});

test("analyseTrend reads direction: a falling rating is harmful, a falling complaint count is not", () => {
  const values = [4.2, 4.2, 4.1, 4.2, 4.2, 4.1, 4.2, 3.9, 3.7, 3.5, 3.3, 3.1, 2.9, 2.8];
  const rating = analyseTrend(series(values), { higherIsWorse: false });
  assert.equal(rating.worsening, true);
  assert.notEqual(rating.tier, "NORMAL");
  const count = analyseTrend(series(values), { higherIsWorse: true });
  assert.equal(count.worsening, false);
  assert.equal(count.tier, "NORMAL");
});

test("contributors ranks what moved most week on week", () => {
  const rows = [
    ...Array.from({ length: 4 }, () => ({ at: daysAgo(2), k: "WI-FI" })),
    { at: daysAgo(10), k: "WATER" },
    { at: daysAgo(3), k: "WATER" }
  ];
  const [top] = contributors(rows, { dateOf: (r) => r.at, keyOf: (r) => r.k, now: NOW });
  assert.deepEqual({ key: top.key, recent: top.recent, prior: top.prior, delta: top.delta }, { key: "WI-FI", recent: 4, prior: 0, delta: 4 });
});

test("explainSignal says the cause is unknown when the data cannot support one", () => {
  const signals = buildSignals({}, { now: NOW });
  const gate = signals.find((s) => s.key === "gatePass");
  const why = explainSignal(gate, {}, signals, { now: NOW });
  assert.equal(why.sufficient, false);
  assert.equal(why.cause, INSUFFICIENT);
  assert.equal(why.hypotheses.length, 0);
});

const hostelRow = (room, n, extra = {}) => ({
  _id: `id${room}${n}`,
  reference: `CMP-${room}-${n}`,
  title: "No water",
  location: `HOSTEL B · ${room}`,
  building: { code: "HST-B", name: "HOSTEL B", type: "HOSTEL" },
  priority: "HIGH",
  status: "INVESTIGATING",
  createdAt: daysAgo(n),
  ...extra
});
const basePattern = {
  key: "HST-B::WATER",
  building: { code: "HST-B", name: "HOSTEL B" },
  category: "WATER",
  occurrences: 5,
  distinctDays: 5,
  periodDays: 30,
  textSimilarity: 60,
  unresolved: 5
};

test("enrichPattern narrows a same-floor cluster to that floor and labels the cause a hypothesis", () => {
  const rows = ["B-201", "B-204", "B-207", "B-210", "B-118"].map((room, i) => hostelRow(room, i + 1));
  const intel = enrichPattern(basePattern, rows, [], { now: NOW });
  assert.equal(intel.scope, "FLOOR");
  assert.equal(intel.location, "HOSTEL B · Floor 2");
  assert.equal(intel.rooms.length, 5);
  assert.match(intel.cause, /Floor 2/);
  assert.equal(intel.causeKind, "AI HYPOTHESIS");
  assert.ok(intel.confidence > 0 && intel.confidence <= 95);
  assert.equal(intel.related.length, 5);
});

test("enrichPattern prefers campus memory, and says INSUFFICIENT when nothing supports a cause", () => {
  const rows = ["B-201", "B-305"].map((room, i) => hostelRow(room, i + 1));
  const memory = [{ incidentReference: "INC-1", occurredOn: daysAgo(90), cause: "Booster pump seal failure" }];
  assert.match(enrichPattern({ ...basePattern, occurrences: 2 }, rows, memory, { now: NOW }).cause, /Booster pump/);
  const none = enrichPattern({ ...basePattern, occurrences: 2 }, rows, [], { now: NOW });
  assert.equal(none.cause, INSUFFICIENT);
});

test("rooms outside a hostel are the reporter's, not the fault's, and are ignored", () => {
  const rows = [1, 2, 3].map((n) => ({ ...hostelRow("B-201", n), building: { code: "LIB", name: "LIBRARY", type: "LIBRARY" } }));
  const intel = enrichPattern({ ...basePattern, occurrences: 3, category: "WI-FI" }, rows, [], { now: NOW });
  assert.deepEqual(intel.rooms, []);
  assert.equal(intel.scope, "BUILDING");
});

test("tierFromRecurring follows its stated rule", () => {
  assert.equal(tierFromRecurring({ severity: "CRITICAL", trend: { direction: "STEADY" } }, { unresolved: 5 }), "CRITICAL");
  assert.equal(tierFromRecurring({ severity: "LOW", trend: { direction: "STEADY" } }, { unresolved: 8 }), "CRITICAL");
  assert.equal(tierFromRecurring({ severity: "MEDIUM", trend: { direction: "STEADY" } }, { unresolved: 3 }), "WARNING");
  assert.equal(tierFromRecurring({ severity: "LOW", trend: { direction: "DECREASING" } }, { unresolved: 1 }), "WATCH");
});

test("campusPulse is a transparent weighted mean that drops missing components", () => {
  const full = campusPulse({ attendanceMean: 80, hostelRisks: [20, 40], messRatingMean: 4, sla: { within: 8, decided: 10 }, throughput: { created: 10, resolved: 5 } });
  // 80·25 + 70·20 + 75·20 + 80·20 + 50·15 = 7250 / 100
  assert.equal(full.score, 73);
  assert.equal(full.missing.length, 0);
  assert.equal(full.label, "PROTOTYPE OPERATIONAL INDICATOR");

  const partial = campusPulse({ attendanceMean: 90, hostelRisks: [], messRatingMean: null, sla: { within: 0, decided: 0 }, throughput: { created: 0, resolved: 0 } });
  assert.equal(partial.score, 90);
  assert.deepEqual(partial.missing, ["Hostel condition", "Mess satisfaction", "Complaint resolution", "Team workload"]);
  assert.equal(partial.components.find((c) => c.key === "attendance").effectiveWeight, 100);

  const empty = campusPulse({});
  assert.equal(empty.score, null);
  assert.equal(empty.band, "INSUFFICIENT DATA");
});
