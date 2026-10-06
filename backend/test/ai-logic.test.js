/**
 * Unit tests for the AI layer's deterministic logic.
 *
 *   cd backend && npm test
 *
 * Everything covered here is a pure function over data — no database, no
 * network, no provider. That is deliberate: these are the paths the whole
 * application falls back to when the AI service is unavailable, so they are
 * exactly the paths that have to be right.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { decideEscalation, maxPriority, reconcilePriority, safetyScan } from "../src/services/escalationService.js";
import { classifyNotification, higherPriority } from "../src/services/notificationPriority.js";
import { canonicalForm, GENESIS_HASH, hashEntry, verifyChain } from "../src/services/auditChainService.js";
import { detectRecurring, evidenceFor } from "../src/services/recurrenceService.js";
import { forecastNextDay, leadingCategory, peakWindow, sufficiency, toDailySeries } from "../src/services/predictionService.js";
import { mad, median, scoreSeries } from "../src/services/volumeAnomalyService.js";
import { scoreGatePassHistory } from "../src/services/gatePassRiskService.js";
import { complaintTimeline, gatePassTimeline } from "../src/services/timelineService.js";
import { guard, safeEnum, safeNumber, safeText, safeTextList } from "../src/services/ai/jsonGuard.js";
import { capInput, extractJson } from "../src/services/ai/providerClient.js";
import { detectIntent } from "../src/services/copilotService.js";
import { aiConfigured, aiPublicConfig } from "../src/config/env.js";
import { status } from "../src/services/aiService.js";

// ---------------------------------------------------------------------------
// Feature 6 · deterministic safety rules and escalation
// ---------------------------------------------------------------------------

test("safetyScan finds electrical-arc wording and names the term that matched", () => {
  const hits = safetyScan("Electrical sparks are coming from the distribution board");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].id, "ELECTRICAL_ARC");
  assert.equal(hits[0].term, "spark");
});

test("safetyScan does not fire on ordinary wording", () => {
  assert.deepEqual(safetyScan("The light bulb in my room is not working"), []);
});

test("a safety match forces CRITICAL regardless of the classifier's priority", () => {
  const result = decideEscalation({ text: "There is a fire in the hostel kitchen", basePriority: "LOW" });
  assert.equal(result.priority, "CRITICAL");
  assert.equal(result.rule, "SAFETY_RULE");
  assert.equal(result.escalate, true);
  assert.match(result.reasons[0], /FIRE/);
});

test("an ordinary low-priority complaint does not escalate", () => {
  const result = decideEscalation({ text: "Light bulb is not working", basePriority: "LOW" });
  assert.equal(result.priority, "LOW");
  assert.equal(result.escalate, false);
  assert.equal(result.rule, "CLASSIFIER_PRIORITY");
});

test("many similar open complaints raise priority to HIGH", () => {
  const result = decideEscalation({ text: "No power in several rooms", basePriority: "MEDIUM", relatedCount: 6 });
  assert.equal(result.priority, "HIGH");
  assert.equal(result.escalate, true);
});

test("maxPriority keeps the more severe of two labels", () => {
  assert.equal(maxPriority("LOW", "CRITICAL"), "CRITICAL");
  assert.equal(maxPriority("HIGH", "MEDIUM"), "HIGH");
});

test("a model may raise a priority", () => {
  const deterministic = decideEscalation({ text: "Water dripping", basePriority: "LOW" });
  const merged = reconcilePriority(deterministic, "HIGH");
  assert.equal(merged.priority, "HIGH");
  assert.equal(merged.honoured, true);
});

test("a model may NOT lower a priority a safety rule set", () => {
  const deterministic = decideEscalation({ text: "Sparks from the switchboard", basePriority: "MEDIUM" });
  const merged = reconcilePriority(deterministic, "LOW");
  assert.equal(merged.priority, "CRITICAL");
  assert.equal(merged.honoured, false);
  assert.match(merged.note, /cannot lower/);
});

test("a model may not lower a rule-based priority either", () => {
  const deterministic = decideEscalation({ text: "No water since morning", basePriority: "HIGH" });
  assert.equal(reconcilePriority(deterministic, "LOW").priority, "HIGH");
});

// ---------------------------------------------------------------------------
// Feature 7 · notification priority
// ---------------------------------------------------------------------------

test("an overdue gate pass is CRITICAL, a returned one is informational", () => {
  assert.equal(classifyNotification({ kind: "GATE_PASS_OVERDUE" }).priority, "CRITICAL");
  assert.equal(classifyNotification({ kind: "GATE_PASS_RETURNED" }).priority, "INFORMATIONAL");
});

test("safety wording raises a notification's band and says it was a safety rule", () => {
  const graded = classifyNotification({ kind: "GATE_PASS_RETURNED", body: "Student reported a fire on the way back" });
  assert.equal(graded.priority, "CRITICAL");
  assert.equal(graded.prioritySource, "SAFETY_RULE");
});

test("an unknown notification kind falls to INFORMATIONAL rather than throwing", () => {
  const graded = classifyNotification({ kind: "SOMETHING_NEW" });
  assert.equal(graded.priority, "INFORMATIONAL");
  assert.match(graded.priorityReason, /No grading rule/);
});

test("higherPriority prefers the more urgent band", () => {
  assert.equal(higherPriority("LOW", "CRITICAL"), "CRITICAL");
  assert.equal(higherPriority("HIGH", "INFORMATIONAL"), "HIGH");
});

// ---------------------------------------------------------------------------
// Feature 14 · tamper-evident audit chain
// ---------------------------------------------------------------------------

function buildChain(count = 4) {
  const rows = [];
  let previousHash = GENESIS_HASH;
  for (let i = 1; i <= count; i += 1) {
    const row = {
      sequence: i,
      entityType: "Complaint",
      entityId: `id-${i}`,
      entityRef: `CMP-${2100 + i}`,
      action: "STATUS_CHANGED",
      field: "status",
      previousValue: "PENDING",
      newValue: "ASSIGNED",
      actorName: "Warden",
      actorRole: "WARDEN",
      note: "",
      at: new Date(Date.UTC(2026, 0, i)),
      previousHash
    };
    row.hash = hashEntry(row);
    previousHash = row.hash;
    rows.push(row);
  }
  return rows;
}

test("an untouched chain verifies", () => {
  const verdict = verifyChain(buildChain());
  assert.equal(verdict.intact, true);
  assert.equal(verdict.checked, 4);
  assert.equal(verdict.fullChain, true);
});

test("editing a stored value breaks the chain at that entry", () => {
  const rows = buildChain();
  rows[1].newValue = "RESOLVED";
  const verdict = verifyChain(rows);
  assert.equal(verdict.intact, false);
  assert.equal(verdict.brokenAt, 2);
  assert.equal(verdict.reason, "CONTENT_MODIFIED");
});

test("removing an entry from the middle breaks the chain", () => {
  const rows = buildChain();
  rows.splice(1, 1);
  const verdict = verifyChain(rows);
  assert.equal(verdict.intact, false);
  assert.equal(verdict.reason, "PREVIOUS_HASH_MISMATCH");
});

test("re-dated entries do not verify, because the timestamp is hashed", () => {
  const rows = buildChain();
  rows[2].at = new Date(Date.UTC(2020, 0, 1));
  assert.equal(verifyChain(rows).intact, false);
});

test("the canonical form is stable and the digest is sha256-shaped", () => {
  const [row] = buildChain(1);
  assert.equal(canonicalForm(row), canonicalForm({ ...row }));
  assert.match(row.hash, /^[0-9a-f]{64}$/);
});

test("an empty chain verifies as intact and says so", () => {
  const verdict = verifyChain([]);
  assert.equal(verdict.intact, true);
  assert.equal(verdict.checked, 0);
});

// ---------------------------------------------------------------------------
// Feature 4 · recurring problem detection
// ---------------------------------------------------------------------------

const complaintRow = (day, overrides = {}) => ({
  reference: `CMP-${2100 + day}`,
  title: "No water in the bathroom",
  description: "Water supply stopped again in the bathroom this morning",
  category: "WATER",
  status: "PENDING",
  location: "B-214",
  building: { code: "HST-B", name: "HOSTEL B" },
  createdAt: new Date(Date.UTC(2026, 0, day)),
  ...overrides
});

test("three complaints over three days in one building is a recurring pattern", () => {
  const patterns = detectRecurring([complaintRow(1), complaintRow(3), complaintRow(5)], { windowDays: 30 });
  assert.equal(patterns.length, 1);
  assert.equal(patterns[0].occurrences, 3);
  assert.equal(patterns[0].distinctDays, 3);
  assert.equal(patterns[0].building.code, "HST-B");
  assert.ok(patterns[0].textSimilarity > 0);
});

test("two complaints is not a pattern", () => {
  assert.equal(detectRecurring([complaintRow(1), complaintRow(2)]).length, 0);
});

test("three complaints all filed on one day is not a pattern", () => {
  const rows = [complaintRow(1), { ...complaintRow(1), reference: "CMP-2" }, { ...complaintRow(1), reference: "CMP-3" }];
  assert.equal(detectRecurring(rows).length, 0);
});

test("different buildings are not pooled into one pattern", () => {
  const rows = [
    complaintRow(1),
    complaintRow(2, { building: { code: "HST-A", name: "HOSTEL A" } }),
    complaintRow(3, { building: { code: "HST-C", name: "HOSTEL C" } })
  ];
  assert.equal(detectRecurring(rows).length, 0);
});

test("a repeated room is reported as a repeated location", () => {
  const patterns = detectRecurring([complaintRow(1), complaintRow(3), complaintRow(5)]);
  assert.equal(patterns[0].repeatedLocations[0].location, "B-214");
  assert.equal(patterns[0].repeatedLocations[0].occurrences, 3);
});

test("every evidence line is a counted statement", () => {
  const [pattern] = detectRecurring([complaintRow(1), complaintRow(3), complaintRow(5)], { windowDays: 30 });
  const evidence = evidenceFor(pattern);
  assert.match(evidence[0], /3 complaints in HOSTEL B/);
  assert.match(evidence[1], /3 separate days/);
});

// ---------------------------------------------------------------------------
// Feature 8 · prediction, and the refusal to predict without data
// ---------------------------------------------------------------------------

function timestamps(perDay, days, endDate = new Date(Date.UTC(2026, 1, 1))) {
  const out = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = new Date(endDate.getTime() - offset * 864e5);
    for (let i = 0; i < perDay; i += 1) out.push(new Date(day.getTime() + i * 36e5 + 10 * 36e5));
  }
  return out;
}

test("a thin series is refused a forecast and says exactly why", () => {
  const series = toDailySeries(timestamps(1, 3), { days: 3, endDate: new Date(Date.UTC(2026, 1, 1)) });
  const check = sufficiency(series);
  assert.equal(check.available, false);
  assert.ok(check.reasons.length > 0);
  assert.equal(forecastNextDay(series), null);
});

test("a real series produces a forecast with an interval and a stated basis", () => {
  const stamps = timestamps(3, 30);
  const series = toDailySeries(stamps, { days: 30, endDate: new Date(Date.UTC(2026, 1, 1)) });
  const forecast = forecastNextDay(series);
  assert.ok(forecast, "expected a forecast");
  assert.equal(forecast.method, "STATISTICAL_BASELINE");
  assert.ok(forecast.range.low <= forecast.expected);
  assert.ok(forecast.range.high >= forecast.expected);
  assert.equal(forecast.expected, 3);
  assert.equal(forecast.trend, "STABLE");
});

test("peakWindow reports the busiest observed band, not a guessed one", () => {
  const stamps = [
    ...Array.from({ length: 10 }, (_, i) => new Date(Date.UTC(2026, 0, 5, 10, i))),
    ...Array.from({ length: 2 }, (_, i) => new Date(Date.UTC(2026, 0, 5, 20, i)))
  ];
  const peak = peakWindow(stamps);
  assert.equal(peak.fromHour, 8);
  assert.equal(peak.events, 10);
  assert.equal(peak.sharePct, 83);
});

test("leadingCategory reports the real share", () => {
  const lead = leadingCategory([{ category: "WATER" }, { category: "WATER" }, { category: "MESS" }]);
  assert.equal(lead.category, "WATER");
  assert.equal(lead.sharePct, 67);
});

// ---------------------------------------------------------------------------
// Feature 11 · anomaly detection that does not cry wolf
// ---------------------------------------------------------------------------

const series = (counts) =>
  counts.map((count, index) => ({ date: `2026-01-${String(index + 1).padStart(2, "0")}`, weekday: index % 7, count }));

test("median and mad behave on a known series", () => {
  assert.equal(median([1, 2, 3, 4, 5]), 3);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(mad([1, 2, 3, 4, 5]), 1);
});

test("normal day-to-day variation is not an anomaly", () => {
  const result = scoreSeries(series([4, 5, 4, 6, 5, 4, 5, 6, 4, 5, 6]), { label: "test" });
  assert.equal(result.anomalous, false);
  assert.equal(result.reason, "WITHIN_NORMAL_VARIATION");
});

test("a genuine spike is an anomaly, with the numbers behind it", () => {
  const result = scoreSeries(series([4, 5, 4, 6, 5, 4, 5, 6, 4, 5, 40]), { label: "Hostel A complaints" });
  assert.equal(result.anomalous, true);
  assert.equal(result.direction, "UP");
  assert.equal(result.current, 40);
  assert.ok(Math.abs(result.zScore) >= result.threshold);
  assert.match(result.detail, /median/);
});

test("too little history is reported as such, never scored", () => {
  const result = scoreSeries(series([1, 2, 9]), { label: "test" });
  assert.equal(result.anomalous, false);
  assert.equal(result.reason, "INSUFFICIENT_HISTORY");
});

test("a small move on a flat baseline is not called an anomaly", () => {
  const result = scoreSeries(series([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2]), { label: "test" });
  assert.equal(result.anomalous, false);
  assert.equal(result.reason, "NO_BASELINE_VARIATION");
  assert.equal(result.zScore, null, "a flat series has no z-score to report");
});

test("a large move on a flat baseline IS an anomaly, and says what it rested on", () => {
  const result = scoreSeries(series([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 30]), { label: "test" });
  assert.equal(result.anomalous, true);
  assert.equal(result.basis, "ABSOLUTE_CHANGE_ON_FLAT_BASELINE");
  assert.match(result.detail, /flat at 0/);
});

test("a move just under the flat-baseline floor is still not an anomaly", () => {
  const result = scoreSeries(series([2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 6]), { label: "test" });
  assert.equal(result.anomalous, false);
  assert.equal(result.reason, "NO_BASELINE_VARIATION");
});

// ---------------------------------------------------------------------------
// Feature 16 · gate-pass risk signals
// ---------------------------------------------------------------------------

const pass = (overrides = {}) => ({
  reference: "GP-2026-000001",
  status: "RETURNED",
  leaveAt: new Date(Date.UTC(2026, 0, 2, 10)),
  expectedReturnAt: new Date(Date.UTC(2026, 0, 2, 18)),
  overdueMinutes: 0,
  createdAt: new Date(Date.UTC(2026, 0, 2)),
  ...overrides
});

test("too few passes returns INSUFFICIENT_DATA rather than a score", () => {
  const result = scoreGatePassHistory([pass(), pass()]);
  assert.equal(result.level, "INSUFFICIENT_DATA");
  assert.equal(result.score, null);
});

test("a clean history produces no signals", () => {
  const rows = [1, 8, 15, 22].map((day) => pass({ createdAt: new Date(Date.UTC(2026, 0, day)), leaveAt: new Date(Date.UTC(2026, 0, day, 10)) }));
  const result = scoreGatePassHistory(rows);
  assert.deepEqual(result.signals, []);
  assert.equal(result.level, "NONE");
});

test("repeated overdue passes raise a signal that lists the records", () => {
  const rows = [
    pass({ reference: "GP-1", createdAt: new Date(Date.UTC(2026, 0, 1)), leaveAt: new Date(Date.UTC(2026, 0, 1, 10)), status: "RETURNED_LATE", overdueMinutes: 45 }),
    pass({ reference: "GP-2", createdAt: new Date(Date.UTC(2026, 0, 8)), leaveAt: new Date(Date.UTC(2026, 0, 8, 10)), status: "OVERDUE", overdueMinutes: 120 }),
    pass({ reference: "GP-3", createdAt: new Date(Date.UTC(2026, 0, 15)), leaveAt: new Date(Date.UTC(2026, 0, 15, 10)) }),
    pass({ reference: "GP-4", createdAt: new Date(Date.UTC(2026, 0, 22)), leaveAt: new Date(Date.UTC(2026, 0, 22, 10)) })
  ];
  const result = scoreGatePassHistory(rows);
  const overdueSignal = result.signals.find((signal) => signal.id === "REPEATED_OVERDUE");
  assert.ok(overdueSignal);
  assert.deepEqual(overdueSignal.references, ["GP-1", "GP-2"]);
  assert.match(overdueSignal.detail, /120 minutes/);
  assert.match(result.governance, /not a decision/);
});

// ---------------------------------------------------------------------------
// Feature 13 · one timeline shape for both request kinds
// ---------------------------------------------------------------------------

test("a resolved complaint's timeline marks every stage up to resolution", () => {
  const timeline = complaintTimeline({
    _id: "abc",
    reference: "CMP-2301",
    title: "No water",
    status: "RESOLVED",
    createdAt: new Date(Date.UTC(2026, 0, 1)),
    aiClassification: { classifiedAt: new Date(Date.UTC(2026, 0, 1, 1)) },
    resolution: { resolvedAt: new Date(Date.UTC(2026, 0, 1, 5)) },
    audit: []
  });
  const states = Object.fromEntries(timeline.stages.map((stage) => [stage.id, stage.state]));
  assert.equal(states.SUBMITTED, "DONE");
  assert.equal(states.CLASSIFIED, "DONE");
  assert.equal(states.RESOLVED, "DONE");
  // Feedback can still arrive on a resolved complaint, so it is pending, not skipped.
  assert.equal(states.FEEDBACK, "PENDING");
});

test("an in-flight complaint marks its current stage CURRENT and the rest PENDING", () => {
  const timeline = complaintTimeline({ _id: "a", status: "ASSIGNED", createdAt: new Date(), audit: [] });
  const states = Object.fromEntries(timeline.stages.map((stage) => [stage.id, stage.state]));
  assert.equal(states.ASSIGNED, "CURRENT");
  assert.equal(states.RESOLVED, "PENDING");
});

test("an active gate pass reaches the ACTIVE stage and no further", () => {
  const timeline = gatePassTimeline({
    _id: "g",
    reference: "GP-2026-000001",
    status: "ACTIVE",
    createdAt: new Date(Date.UTC(2026, 0, 1)),
    parent: { verifiedAt: new Date(Date.UTC(2026, 0, 1, 1)) },
    approval: { decidedAt: new Date(Date.UTC(2026, 0, 1, 2)) },
    pass: { issuedAt: new Date(Date.UTC(2026, 0, 1, 2)), exitScanAt: new Date(Date.UTC(2026, 0, 1, 3)) },
    exitAt: new Date(Date.UTC(2026, 0, 1, 3)),
    events: []
  });
  const states = Object.fromEntries(timeline.stages.map((stage) => [stage.id, stage.state]));
  assert.equal(states.QR_ISSUED, "DONE");
  assert.equal(states.ACTIVE, "CURRENT");
  assert.equal(states.RETURNED, "PENDING");
});

test("a rejected gate pass skips the stages it never reached and ends at REJECTED", () => {
  const timeline = gatePassTimeline({
    _id: "g",
    status: "REJECTED",
    createdAt: new Date(Date.UTC(2026, 0, 1)),
    approval: { decidedAt: new Date(Date.UTC(2026, 0, 1, 2)) },
    updatedAt: new Date(Date.UTC(2026, 0, 1, 2)),
    events: []
  });
  const last = timeline.stages[timeline.stages.length - 1];
  assert.equal(last.id, "REJECTED");
  assert.ok(timeline.stages.some((stage) => stage.state === "SKIPPED"));
});

// ---------------------------------------------------------------------------
// The guard: nothing a model returns reaches the database unvalidated
// ---------------------------------------------------------------------------

test("an invented category is rejected, a real one is kept", () => {
  assert.equal(safeEnum("water", ["WATER", "MESS"]), "WATER");
  assert.equal(safeEnum("TELEPORTATION", ["WATER", "MESS"]), null);
});

test("an out-of-range confidence is rejected rather than clamped", () => {
  assert.equal(safeNumber(94, { min: 0, max: 100 }), 94);
  assert.equal(safeNumber(400, { min: 0, max: 100 }), null);
  assert.equal(safeNumber(-5, { min: 0, max: 100 }), null);
  assert.equal(safeNumber("not a number", { min: 0, max: 100 }), null);
  // A model writing "94%" or "about 94" still yields 94 rather than nothing.
  assert.equal(safeNumber("94%", { min: 0, max: 100 }), 94);
  assert.equal(safeNumber("about 94", { min: 0, max: 100 }), 94);
});

test("model prose is length-capped and stripped of control characters", () => {
  assert.equal(safeText("  hello\u0000  world  "), "hello world");
  assert.equal(safeText("x".repeat(500), { max: 20 }).length, 20);
  assert.equal(safeText(42), null);
});

test("safeTextList drops non-strings and caps the list", () => {
  assert.deepEqual(safeTextList(["a", 3, "b", null, "c", "d", "e", "f", "g"], { limit: 3 }), ["a", "b", "c"]);
  assert.deepEqual(safeTextList("not a list"), []);
});

test("guard names the fields a model got wrong", () => {
  const { value, rejected } = guard(
    { category: "WATER", priority: "IMMEDIATELY", confidence: 999, reason: "pipe burst" },
    {
      category: { type: "enum", values: ["WATER", "MESS"] },
      priority: { type: "enum", values: ["LOW", "HIGH"] },
      confidence: { type: "number", min: 0, max: 100 },
      reason: { type: "text", max: 100 }
    }
  );
  assert.equal(value.category, "WATER");
  assert.equal(value.reason, "pipe burst");
  assert.equal(value.priority, undefined);
  assert.deepEqual(rejected.sort(), ["confidence", "priority"]);
});

// ---------------------------------------------------------------------------
// Provider plumbing
// ---------------------------------------------------------------------------

test("extractJson reads a bare object, a fenced block and a prefaced reply", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(extractJson('Here you go:\n{"a":3}\nHope that helps.'), { a: 3 });
});

test("extractJson handles a brace inside a string value", () => {
  assert.deepEqual(extractJson('{"reason":"the } character"}'), { reason: "the } character" });
});

test("extractJson returns null on prose with no object", () => {
  assert.equal(extractJson("I cannot answer that."), null);
  assert.equal(extractJson(""), null);
});

test("capInput truncates and says that it did", () => {
  const out = capInput("x".repeat(100), 20);
  assert.ok(out.length < 100);
  assert.match(out, /truncated/);
});

// ---------------------------------------------------------------------------
// The no-fake-AI contract
// ---------------------------------------------------------------------------

test("with no provider configured, status reports it honestly and names no model", () => {
  // This suite runs with no AI_* variables set, which is exactly the state the
  // application must remain usable in.
  assert.equal(aiConfigured(), false);
  const config = aiPublicConfig();
  assert.equal(config.configured, false);
  assert.equal(config.provider, null);
  assert.equal(config.model, null);
  assert.equal(Object.keys(config).includes("apiKey"), false);
});

test("the AI status payload never carries a key and names its fallback", () => {
  const payload = status();
  assert.equal(JSON.stringify(payload).toLowerCase().includes("apikey"), false);
  assert.equal(payload.fallback, "DETERMINISTIC_SERVICES");
  assert.match(payload.note, /not configured/);
  assert.ok(payload.capabilities.includes("classifyComplaint"));
});

// ---------------------------------------------------------------------------
// Feature 9 · copilot intent matching
// ---------------------------------------------------------------------------

test("copilot questions map to the intent that queries the right table", () => {
  assert.equal(detectIntent("How many unresolved complaints are there?").intent, "UNRESOLVED_COMPLAINTS");
  assert.equal(detectIntent("Which hostel has the most complaints?").intent, "WORST_BUILDING");
  assert.equal(detectIntent("Are there recurring problems?").intent, "RECURRING");
  assert.equal(detectIntent("Summarise today's campus issues").intent, "TODAY_SUMMARY");
});

test("an unrecognised question is reported as UNKNOWN, not guessed at", () => {
  const result = detectIntent("what is the airspeed velocity of an unladen swallow");
  assert.equal(result.intent, "UNKNOWN");
  assert.equal(result.matchStrength, 0);
});
