/**
 * Phase 9 — 2G budgets for four everyday workflows (page 21).
 *
 * Runs each workflow's real API calls over HTTP against createApp() in a
 * throwaway database (XO_BUDGET_MONGO_URI, default nex_xo_budget_test) and
 * FAILS when a workflow's measured bytes exceed its budget. Skipped when no
 * MongoDB is reachable, as the other integration tests are.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import mongoose from "mongoose";

process.env.JWT_SECRET ||= "a-test-secret-that-is-long-enough-1234";
process.env.GATE_PASS_REVEAL_OTP = "true";
const URI = process.env.XO_BUDGET_MONGO_URI || "mongodb://127.0.0.1:27017/nex_xo_budget_test";

let available = false;
try {
  await mongoose.connect(URI, { serverSelectionTimeoutMS: 1500 });
  available = true;
} catch {
  available = false;
}
const itest = (name, fn) => test(name, { skip: available ? false : "no MongoDB reachable" }, fn);

const budget = await import("../scripts/lib/workflowBudgets.js");
const { createApp } = await import("../src/app.js");
const models = { ...(await import("../src/models/index.js")), ...(await import("../src/models/ext/index.js")) };
const { createNotice } = await import("../src/services/ext/noticeService.js");
const { flushEvents } = await import("../src/services/xo/eventService.js");

let server;
let base;
let token;

before(async () => {
  if (!available) return;
  await mongoose.connection.dropDatabase();
  const fx = await budget.budgetFixtures(models, { createNotice });
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = await (await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: fx.email, password: fx.password }) })).json();
  token = login.data.token;
});

after(async () => {
  if (!available) return;
  await flushEvents();
  server?.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test("simulated 2G time grows with bytes and round trips", () => {
  assert.equal(budget.simulatedSeconds(0, 0), 0);
  assert.ok(budget.simulatedSeconds(10_000, 2) > budget.simulatedSeconds(5_000, 2));
  assert.ok(budget.simulatedSeconds(5_000, 3) > budget.simulatedSeconds(5_000, 2));
  // 2 requests: 1.2 s of round trips + (5000 + 1400) bytes at 50 kbps ≈ 1.02 s
  assert.equal(budget.simulatedSeconds(5_000, 2), 2.2);
});

itest("every page-21 workflow stays within its 2G byte budget", async () => {
  const results = await budget.measureWorkflows(base, token);
  assert.deepEqual(results.map((r) => r.key), ["complaint", "gatepass", "certificate", "notice"]);
  for (const r of results) {
    assert.ok(r.bytes > 0 && r.steps.every((s) => s.down > 0), `${r.label} measured`);
    assert.ok(r.bytes <= budget.BUDGETS[r.key], `${r.label}: ${r.bytes} bytes is over its ${budget.BUDGETS[r.key]}-byte budget`);
  }
});
