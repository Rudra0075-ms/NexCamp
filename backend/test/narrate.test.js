/**
 * The narration layer for the student intelligence surfaces.
 *
 * A model may only reword an answer that the rules already computed, or pick
 * an intent from a fixed list. This stands up a stub provider and checks both
 * the working path and every way it can fail: the rule-based answer must
 * always survive, and a model is only named when it actually produced text.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import http from "node:http";

process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/test";
process.env.JWT_SECRET ||= "a-test-secret-that-is-long-enough-1234";

let mode = "good";
const server = http.createServer((req, res) => {
  const reply = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const choice = (content) => ({ choices: [{ message: { content } }] });
  if (mode === "error") return reply(500, { error: { message: "boom" } });
  if (mode === "prose") return reply(200, choice("Sure! Your attendance is fine."));
  if (mode === "intent") return reply(200, choice(JSON.stringify({ intent: "ATT_RISK", confidence: 81 })));
  if (mode === "bad-intent") return reply(200, choice(JSON.stringify({ intent: "DELETE_EVERYTHING", confidence: 99 })));
  return reply(200, choice(JSON.stringify({ answer: "You are 3.3 points under the 75% bar.", points: ["Six classes in a row fixes it."] })));
});

before(async () => {
  await new Promise((resolve) => server.listen(0, resolve));
  process.env.AI_PROVIDER = "openai";
  process.env.AI_API_KEY = "test-key-not-a-real-credential";
  process.env.AI_MODEL = "stub-model-1";
  process.env.AI_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.AI_TIMEOUT_MS = "700";
});
after(() => server.close());

const load = () => import("../src/services/ai/narrate.js");
const facts = { question: "How am I doing?", answer: "Attendance 71.7%, 3.3 below 75%.", points: ["6 classes clears it"] };

test("a working model rewords the answer and is named", async () => {
  mode = "good";
  const { narrate } = await load();
  const out = await narrate(facts);
  assert.equal(out.provenance.source, "AI_MODEL");
  assert.equal(out.provenance.model, "stub-model-1");
  assert.equal(out.answer, "You are 3.3 points under the 75% bar.");
});

test("prose instead of JSON keeps the rule-based answer and names no model", async () => {
  mode = "prose";
  const { narrate } = await load();
  const out = await narrate(facts);
  assert.equal(out.provenance.source, "DETERMINISTIC_FALLBACK");
  assert.equal(out.provenance.model, null);
  assert.equal(out.answer, facts.answer);
  assert.deepEqual(out.points, facts.points);
});

test("a provider error keeps the rule-based answer", async () => {
  mode = "error";
  const { narrate } = await load();
  const out = await narrate(facts);
  assert.equal(out.provenance.source, "DETERMINISTIC_FALLBACK");
  assert.equal(out.answer, facts.answer);
});

test("the model can pick an intent only from the fixed list", async () => {
  const { classifyIntentWithModel } = await load();
  const intents = [{ id: "ATT_RISK", description: "risk" }, { id: "MESS_MENU", description: "menu" }];
  mode = "intent";
  assert.deepEqual(await classifyIntentWithModel("am I in trouble", intents), { intent: "ATT_RISK", confidence: 81 });
  mode = "bad-intent";
  assert.equal(await classifyIntentWithModel("am I in trouble", intents), null);
  mode = "error";
  assert.equal(await classifyIntentWithModel("am I in trouble", intents), null);
});
