/**
 * The fallback contract.
 *
 * "The application must continue functioning if the AI service is unavailable"
 * is the requirement this file exists to prove. It stands up a local stub
 * provider, points the AI layer at it, and checks what happens when that
 * provider misbehaves in each of the ways a real one can:
 *
 *   - returns a valid JSON answer            → AI_MODEL, and the values are used
 *   - returns prose instead of JSON          → DETERMINISTIC_FALLBACK
 *   - returns JSON with invented values      → the bad fields are dropped
 *   - returns 500                            → DETERMINISTIC_FALLBACK
 *   - returns 401 (a bad key)                → DETERMINISTIC_FALLBACK
 *   - hangs past the timeout                 → DETERMINISTIC_FALLBACK
 *   - is not listening at all                → DETERMINISTIC_FALLBACK
 *
 * In every failing case the answer still arrives, still carries real data, and
 * never names a model.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import http from "node:http";

process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/test";
process.env.JWT_SECRET ||= "a-test-secret-that-is-long-enough-1234";

// Configure a provider BEFORE importing anything that reads env.ai.
let stubPort = 0;
let mode = "good";
let server;

server = http.createServer((req, res) => {
  const reply = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const asChoice = (content) => ({ choices: [{ message: { content } }] });

  if (mode === "hang") return; // never responds
  if (mode === "error") return reply(500, { error: { message: "upstream exploded" } });
  if (mode === "unauthorized") return reply(401, { error: { message: "invalid api key" } });
  if (mode === "prose") return reply(200, asChoice("I think it is probably a plumbing issue."));
  if (mode === "garbage") {
    return reply(
      200,
      asChoice(JSON.stringify({ outlook: "Busy tomorrow", driver: 42, preparation: ["not", "a", "string"] }))
    );
  }
  if (mode === "summary") {
    return reply(
      200,
      asChoice(JSON.stringify({ headline: "Quiet day", bullets: ["2 pending"], topPriority: "Clear the backlog" }))
    );
  }
  return reply(200, asChoice(JSON.stringify({ outlook: "Steady", driver: "Water complaints", preparation: "Staff the morning" })));
});

before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  stubPort = server.address().port;

  process.env.AI_PROVIDER = "openai";
  process.env.AI_API_KEY = "test-key-not-a-real-credential";
  process.env.AI_MODEL = "stub-model-1";
  process.env.AI_BASE_URL = `http://127.0.0.1:${stubPort}`;
  process.env.AI_TIMEOUT_MS = "700";
});

after(() => server?.close());

/** Imported lazily so the env above is in place when config/env.js is read. */
const load = async () => {
  const { aiConfigured } = await import("../src/config/env.js");
  const ai = await import("../src/services/aiService.js");
  return { aiConfigured, ...ai };
};

/** A forecast that predictDemand() can narrate, with no database involved. */
const prediction = {
  metric: "COMPLAINT_VOLUME",
  available: true,
  forecast: {
    expected: 26,
    range: { low: 23, high: 30 },
    trend: "RISING",
    basis: { trendPct: 18, sevenDayMean: 24, sameWeekdayMean: 27, meanAbsoluteError: 3.1 },
    method: "STATISTICAL_BASELINE",
    methodDetail: "seasonal naive"
  },
  peak: { label: "10:00 – 13:00 UTC", sharePct: 41 },
  leadingCategory: { category: "WATER", sharePct: 38 },
  sufficiency: { days: 30, activeDays: 28, events: 210, reasons: [], requirement: {} },
  disclaimer: "An estimate."
};

test("the stub provider is seen as configured", async () => {
  const { aiConfigured } = await load();
  assert.equal(aiConfigured(), true);
  mode = "good";
});

test("a working provider answers, and is named", async () => {
  mode = "good";
  const { predictDemand } = await load();
  const result = await predictDemand(prediction);

  assert.equal(result.source, "AI_MODEL");
  assert.equal(result.provider, "openai");
  assert.equal(result.model, "stub-model-1");
  assert.equal(result.outlook, "Steady");
  // The forecast numbers are untouched by the model.
  assert.equal(result.prediction.forecast.expected, 26);
});

test("prose instead of JSON falls back, and names no model", async () => {
  mode = "prose";
  const { predictDemand } = await load();
  const result = await predictDemand(prediction);

  assert.equal(result.source, "DETERMINISTIC_FALLBACK");
  assert.equal(result.provider, null);
  assert.equal(result.model, null);
  // The answer still arrives, built from the real numbers.
  assert.match(result.outlook, /26/);
  assert.match(result.notice, /unavailable/i);
});

test("a 500 from the provider falls back", async () => {
  mode = "error";
  const { predictDemand } = await load();
  const result = await predictDemand(prediction);
  assert.equal(result.source, "DETERMINISTIC_FALLBACK");
  assert.equal(result.model, null);
  assert.ok(result.outlook);
});

test("a rejected API key falls back rather than failing the request", async () => {
  mode = "unauthorized";
  const { predictDemand } = await load();
  const result = await predictDemand(prediction);
  assert.equal(result.source, "DETERMINISTIC_FALLBACK");
  assert.ok(result.outlook);
});

test("a provider that hangs is cut off by the timeout and falls back", async () => {
  mode = "hang";
  const { predictDemand } = await load();
  const startedAt = Date.now();
  const result = await predictDemand(prediction);
  const elapsed = Date.now() - startedAt;

  assert.equal(result.source, "DETERMINISTIC_FALLBACK");
  assert.ok(elapsed < 3000, `took ${elapsed}ms — the timeout did not fire`);
  assert.ok(result.outlook);
});

test("invalid field types are dropped, and the good ones are kept", async () => {
  mode = "garbage";
  const { predictDemand } = await load();
  const result = await predictDemand(prediction);

  // The call succeeded, so this is genuinely a model result...
  assert.equal(result.source, "AI_MODEL");
  // ...but only the field that validated survived.
  assert.equal(result.outlook, "Busy tomorrow");
  assert.equal(result.driver, null, "a numeric 'driver' must not be coerced into prose");
  assert.equal(result.preparation, null, "an array where a string was asked for must be dropped");
  assert.deepEqual(result.rejectedFields.sort(), ["driver", "preparation"]);
});

test("a campus summary keeps the counted facts whatever the model says", async () => {
  mode = "summary";
  const { summarizeCampus } = await load();
  const facts = {
    lines: ["2 complaints are pending.", "0 are CRITICAL."],
    headline: "2 complaints pending.",
    topPriority: "Nothing is escalated.",
    counts: { pendingComplaints: 2, criticalComplaints: 0 },
    method: "DATABASE_AGGREGATION"
  };
  const result = await summarizeCampus(facts);

  assert.equal(result.source, "AI_MODEL");
  assert.equal(result.headline, "Quiet day");
  // The counted figures travel with the prose, unchanged, every time.
  assert.equal(result.facts.counts.pendingComplaints, 2);
  assert.equal(result.facts.method, "DATABASE_AGGREGATION");
});

test("a provider that is not listening at all falls back", async () => {
  mode = "good";
  const { predictDemand } = await load();
  // Point at a port nothing is bound to.
  const previous = process.env.AI_BASE_URL;
  const { env } = await import("../src/config/env.js");
  env.ai.baseUrl = "http://127.0.0.1:1";

  const result = await predictDemand(prediction);
  assert.equal(result.source, "DETERMINISTIC_FALLBACK");
  assert.ok(result.outlook, "an answer must still be produced");

  env.ai.baseUrl = previous;
});

test("an insufficient forecast is never attributed to a model, even with one configured", async () => {
  mode = "good";
  const { env } = await import("../src/config/env.js");
  env.ai.baseUrl = `http://127.0.0.1:${stubPort}`;
  const { predictDemand } = await load();

  const result = await predictDemand({
    available: false,
    sufficiency: { reasons: ["only 3 days of history (14 needed)"], requirement: { minDays: 14, minActiveDays: 8, minEvents: 20 } }
  });

  assert.equal(result.available, false);
  assert.equal(result.source, "INSUFFICIENT_DATA");
  assert.equal(result.model, null);
  assert.match(result.notice, /at least 14 days/);
});
