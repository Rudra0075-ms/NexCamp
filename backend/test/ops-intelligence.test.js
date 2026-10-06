/**
 * Operational intelligence: SLA prediction, workload, the what-if simulator,
 * the digital twin, cross-module correlation, feedback and resolution
 * learning — plus the AI narration contract over all of them.
 *
 * The scoring functions are pure and tested directly. The narration is tested
 * against a local stub provider so both paths are proven: a model answer is
 * attributed to the model, and anything else is attributed to nobody while the
 * computed figures still arrive.
 */
import assert from "node:assert/strict";
import http from "node:http";
import test, { after, before } from "node:test";

process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/test";
process.env.JWT_SECRET ||= "a-test-secret-that-is-long-enough-1234";

let mode = "good";
const server = http.createServer((req, res) => {
  const reply = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const asChoice = (content) => ({ choices: [{ message: { content } }] });
  if (mode === "error") return reply(500, { error: { message: "upstream exploded" } });
  if (mode === "resolution") {
    return reply(200, asChoice(JSON.stringify({ suggestion: "Replace the pump valve.", basedOn: ["CMP-1"], caution: "Check first." })));
  }
  return reply(
    200,
    asChoice(JSON.stringify({ headline: "Backlog grows", insights: ["Plumbing leads"], recommendation: "Add a plumber", extra: "ignored" }))
  );
});

before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  process.env.AI_PROVIDER = "openai";
  process.env.AI_API_KEY = "test-key-not-a-real-credential";
  process.env.AI_MODEL = "stub-model-ops";
  process.env.AI_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.AI_TIMEOUT_MS = "700";
});

after(() => server.close());

const ops = await import("../src/services/operationsIntelligenceService.js");
const fb = await import("../src/services/feedbackService.js");
const { oneOf } = await import("../src/validations/rules.js");
const { classifyNotification } = await import("../src/services/notificationPriority.js");

// ---------------------------------------------------------------------------
// Feature 8 · SLA
// ---------------------------------------------------------------------------

test("a complaint past its SLA is BREACHED and labelled measured, not predicted", () => {
  const result = ops.scoreSlaRisk({ ageHours: 30, slaHours: 24, history: null });
  assert.equal(result.risk, "BREACHED");
  assert.equal(result.isPrediction, false);
});

test("SLA risk is LOW early in the window with no history, and says history was missing", () => {
  const result = ops.scoreSlaRisk({ ageHours: 2, slaHours: 24, history: null });
  assert.equal(result.risk, "LOW");
  assert.equal(result.isPrediction, true);
  assert.ok(result.reasons.some((line) => /SLA clock alone/.test(line)));
});

test("slow category history raises SLA risk to HIGH", () => {
  const result = ops.scoreSlaRisk({ ageHours: 19, slaHours: 24, history: { samples: 5, medianHours: 40, p75Hours: 60 } });
  assert.equal(result.risk, "HIGH");
  assert.ok(result.reasons.some((line) => /median 40h \(5 records\)/.test(line)));
});

test("history below the minimum sample size is not trusted", () => {
  const result = ops.scoreSlaRisk({ ageHours: 2, slaHours: 24, history: { samples: 2, medianHours: 90, p75Hours: 90 } });
  assert.equal(result.risk, "LOW");
});

test("quantile and resolutionHistory compute from resolved rows only", () => {
  assert.equal(ops.quantile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(ops.quantile([], 0.5), null);
  const history = ops.resolutionHistory(
    [
      { category: "WATER", resolution: { resolutionTimeHours: 10 } },
      { category: "WATER", resolution: { resolutionTimeHours: 20 } },
      { category: "WATER", resolution: {} }
    ],
    (row) => row.category
  );
  assert.deepEqual(history.get("WATER"), { samples: 2, medianHours: 15, p75Hours: 17.5 });
});

// ---------------------------------------------------------------------------
// Feature 9 · workload
// ---------------------------------------------------------------------------

test("a normal queue raises no flags", () => {
  const result = ops.workloadFlags({ pending: 2, critical: 0, high: 0, oldestAgeDays: 1, resolvedPerDay: 1 }, 3);
  assert.equal(result.attention, "NORMAL");
  assert.deepEqual(result.flags, []);
});

test("a queue with critical work and no throughput needs HIGH attention", () => {
  const result = ops.workloadFlags({ pending: 12, critical: 2, high: 1, oldestAgeDays: 9, resolvedPerDay: 0 }, 4);
  assert.equal(result.attention, "HIGH");
  assert.ok(result.flags.some((line) => /throughput cannot be measured/.test(line)));
});

// ---------------------------------------------------------------------------
// Feature 12 · simulation
// ---------------------------------------------------------------------------

const baseline = {
  windowDays: 10,
  filedInWindow: 20,
  resolvedInWindow: 10,
  pendingNow: 8,
  departments: [{ department: "IT · NETWORK", filedInWindow: 20, resolvedInWindow: 10, pendingNow: 8 }]
};

test("the simulator keeps measured and estimated figures apart and does the arithmetic", () => {
  const result = ops.simulateLoad({ baseline, increasePct: 50, horizonDays: 4 });
  assert.equal(result.current.filedInWindow, 20);
  assert.equal(result.estimated.filedInWindow, 30);
  assert.equal(result.estimated.additionalComplaints, 10);
  // inflow 3/day, throughput 1/day → +2/day × 4 days on top of 8 pending
  assert.equal(result.estimated.pendingAfterHorizon, 16);
  assert.equal(result.estimated.daysToClearBacklog, null);
  assert.equal(result.departments[0].estimatedPendingAfterHorizon, 16);
});

test("a volume drop that throughput outpaces yields a days-to-clear figure", () => {
  const result = ops.simulateLoad({ baseline, increasePct: -75, horizonDays: 4 });
  // inflow 0.5/day, throughput 1/day → net -0.5/day, 8 pending → 16 days
  assert.equal(result.estimated.daysToClearBacklog, 16);
  assert.equal(result.estimated.pendingAfterHorizon, 6);
});

// ---------------------------------------------------------------------------
// Features 10 and 11 · digital twin and correlation
// ---------------------------------------------------------------------------

test("a block with critical complaints is a PROBLEM, a quiet one is NORMAL", () => {
  assert.equal(ops.nodeStatus({ openComplaints: 1, critical: 1, openIncidents: 0, recurring: 0, overduePasses: 0 }).status, "PROBLEM");
  assert.equal(ops.nodeStatus({ openComplaints: 0, critical: 0, openIncidents: 0, recurring: 0, overduePasses: 0 }).status, "NORMAL");
  assert.equal(ops.nodeStatus({ openComplaints: 1, critical: 0, openIncidents: 1, recurring: 0, overduePasses: 0 }).status, "WATCH");
});

test("correlation needs two elevated modules in the same hostel", () => {
  const hostels = [
    { code: "A", name: "HOSTEL A", residents: 10, complaints: 12, incidents: 3, latePasses: 0, lowAttendance: 0 },
    { code: "B", name: "HOSTEL B", residents: 10, complaints: 2, incidents: 0, latePasses: 0, lowAttendance: 0 },
    { code: "C", name: "HOSTEL C", residents: 10, complaints: 2, incidents: 0, latePasses: 0, lowAttendance: 0 }
  ];
  const findings = ops.correlate(hostels);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, "A");
  assert.equal(findings[0].label, "POSSIBLE CORRELATION");
  assert.deepEqual(findings[0].modules.map((m) => m.module), ["complaints", "incidents"]);
});

test("a hostel with no residents is never flagged", () => {
  assert.deepEqual(ops.correlate([{ code: "X", name: "X", residents: 0, complaints: 9, incidents: 9, latePasses: 9, lowAttendance: 9 }]), []);
});

// ---------------------------------------------------------------------------
// Features 16 and 17 · feedback and resolution learning
// ---------------------------------------------------------------------------

test("sentiment is anchored to the star rating and handles negation", () => {
  assert.equal(fb.sentimentOf("Quick and polite, thank you", 5).label, "POSITIVE");
  assert.equal(fb.sentimentOf("Still broken, very slow", 1).label, "NEGATIVE");
  assert.equal(fb.sentimentOf("", 3).label, "NEUTRAL");
  assert.ok(fb.sentimentOf("not good", 3).matchedTerms.includes("not good"));
  assert.equal(fb.sentimentOf("x", 3).method, "LEXICON + STAR_RATING");
});

test("suggestions and repeated terms come from the comments themselves", () => {
  assert.equal(fb.isSuggestion("Maintenance should check weekly"), true);
  assert.equal(fb.isSuggestion("It was fine"), false);
  assert.deepEqual(fb.repeatedTerms(["water pump slow", "pump broken again", "water fine"]), [
    { term: "water", count: 2 },
    { term: "pump", count: 2 }
  ]);
});

test("no feedback yields an honest empty summary rather than invented figures", () => {
  const summary = fb.summariseFeedback([]);
  assert.equal(summary.available, false);
  assert.equal(summary.total, 0);
  assert.equal(summary.averageRating, undefined);
});

test("feedback summary counts what was submitted", () => {
  const rows = [
    { _id: "1", reference: "CMP-1", category: "WATER", feedback: { rating: 1, comment: "slow and still broken" } },
    { _id: "2", reference: "CMP-2", category: "WATER", feedback: { rating: 5, comment: "quick fix, thanks" } },
    { _id: "3", reference: "CMP-3", category: "WI-FI", feedback: { rating: 4 } }
  ];
  const summary = fb.summariseFeedback(rows);
  assert.equal(summary.total, 3);
  assert.equal(summary.averageRating, 3.33);
  assert.equal(summary.distribution.find((d) => d.stars === 1).count, 1);
  assert.equal(summary.lowRated.length, 1);
  assert.equal(summary.byCategory[0].key, "WATER");
});

test("precedents rank by similarity and exclude the complaint itself", () => {
  const complaint = { _id: "new", title: "Water pump failure", description: "No water pressure in hostel bathroom", building: "B" };
  const resolved = [
    { _id: "new", title: "Water pump failure", description: "No water pressure in hostel bathroom", resolution: { resolutionDescription: "self" } },
    { _id: "a", reference: "CMP-A", title: "Water pressure low", description: "Bathroom pump failure in hostel", building: "B", resolution: { resolutionDescription: "Replaced pump", resolutionTimeHours: 6 }, feedback: { rating: 5 } },
    { _id: "b", reference: "CMP-B", title: "Wi-Fi down", description: "Router offline in library", resolution: { resolutionDescription: "Rebooted" } }
  ];
  const ranked = fb.rankPrecedents(complaint, resolved);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].reference, "CMP-A");
  assert.equal(ranked[0].rating, 5);
});

// ---------------------------------------------------------------------------
// Fixes to shared pieces
// ---------------------------------------------------------------------------

test("oneOf accepts a lowercase vocabulary and returns its canonical spelling", () => {
  assert.deepEqual(oneOf(["complaint", "gatepass"])("COMPLAINT", "kind"), { value: "complaint" });
  assert.deepEqual(oneOf(["LOW", "HIGH"])("high", "priority"), { value: "HIGH" });
  assert.ok(oneOf(["LOW"])("banana", "priority").error);
});

test("a resolved-complaint notice is graded on its kind, LOW", () => {
  assert.equal(classifyNotification({ kind: "COMPLAINT_RESOLVED" }).priority, "LOW");
});

// ---------------------------------------------------------------------------
// The AI narration contract
// ---------------------------------------------------------------------------

test("a model answer is attributed to the model and cannot alter the computed figures", async () => {
  mode = "good";
  const ai = await import("../src/services/aiService.js");
  const result = ops.simulateLoad({ baseline, increasePct: 50, horizonDays: 4 });
  const narrated = await ai.explainSimulation({ increasePct: 50, horizonDays: 4, windowDays: 10 }, result);
  assert.equal(narrated.source, "AI_MODEL");
  assert.equal(narrated.model, "stub-model-ops");
  assert.equal(narrated.provider, "openai");
  assert.equal(narrated.headline, "Backlog grows");
  assert.equal(narrated.extra, undefined, "fields outside the spec are dropped");
  assert.equal(result.estimated.pendingAfterHorizon, 16, "the estimate is untouched");
});

test("a failing provider falls back, names no model, and still answers", async () => {
  mode = "error";
  const ai = await import("../src/services/aiService.js");
  const narrated = await ai.analyzeWorkload({
    windowDays: 14,
    totalPending: 5,
    averagePending: 5,
    departments: [{ department: "HOUSEKEEPING", pending: 5, critical: 0, high: 0, oldestAgeDays: 1, resolvedInWindow: 0, daysToClear: null, attention: "WATCH", flags: ["No complaint resolved here in the window — throughput cannot be measured."] }]
  });
  assert.equal(narrated.source, "DETERMINISTIC_FALLBACK");
  assert.equal(narrated.model, null);
  assert.match(narrated.headline, /HOUSEKEEPING carries the largest queue: 5 of 5/);
  assert.match(narrated.notice, /AI provider unavailable/);
});

test("resolution suggestions without precedents consult no model", async () => {
  mode = "good";
  const ai = await import("../src/services/aiService.js");
  const result = await ai.suggestResolution({ title: "x", description: "y" }, { precedents: [], method: "M", note: "Nothing resolved yet." });
  assert.equal(result.source, "INSUFFICIENT_DATA");
  assert.equal(result.model, null);
  assert.equal(result.suggestion, null);
});

test("resolution suggestions from a model keep the precedent list", async () => {
  mode = "resolution";
  const ai = await import("../src/services/aiService.js");
  const result = await ai.suggestResolution(
    { title: "Pump", description: "No water" },
    { precedents: [{ reference: "CMP-1", textSimilarity: 60, resolution: "Replaced valve", title: "Pump", resolutionTimeHours: 3, rating: 4 }], method: "M" }
  );
  assert.equal(result.source, "AI_MODEL");
  assert.equal(result.suggestion, "Replace the pump valve.");
  assert.deepEqual(result.basedOn, ["CMP-1"]);
});

test("feedback analysis with no ratings reports insufficient data", async () => {
  const ai = await import("../src/services/aiService.js");
  const result = await ai.analyzeFeedback(fb.summariseFeedback([]));
  assert.equal(result.source, "INSUFFICIENT_DATA");
  assert.equal(result.model, null);
});
