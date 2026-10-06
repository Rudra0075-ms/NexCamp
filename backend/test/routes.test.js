/**
 * Route and authorisation tests.
 *
 * Boots the real Express app — the same createApp() the server uses — with no
 * database behind it. That is enough to prove what this file is for: that every
 * new endpoint is mounted, that each one refuses an unauthenticated caller, and
 * that nothing added here changed how the existing routes answer.
 *
 * A 401 rather than a 404 is the assertion that matters: 404 would mean the
 * route is missing, and 200 would mean it is unguarded.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";

process.env.MONGO_URI ||= "mongodb://127.0.0.1:27017/test";
process.env.JWT_SECRET ||= "a-test-secret-that-is-long-enough-1234";
process.env.NODE_ENV = "test";

const { createApp } = await import("../src/app.js");

let server;
let base;

before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server?.close());

async function hit(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, body: json, headers: res.headers };
}

// Every route the AI layer added, with the method it answers on.
const AI_ROUTES = [
  ["GET", "/api/ai/status"],
  ["GET", "/api/ai/notifications"],
  ["GET", "/api/ai/timeline/complaint/507f1f77bcf86cd799439011"],
  ["GET", "/api/ai/recurring"],
  ["GET", "/api/ai/root-cause/HST-B/WATER"],
  ["GET", "/api/ai/summary"],
  ["GET", "/api/ai/anomalies"],
  ["GET", "/api/ai/predictions"],
  ["GET", "/api/ai/copilot/questions"],
  ["POST", "/api/ai/copilot"],
  ["GET", "/api/ai/gatepass-risk"],
  ["GET", "/api/ai/gatepass-risk/507f1f77bcf86cd799439011"],
  ["GET", "/api/ai/audit"],
  ["GET", "/api/ai/sla"],
  ["GET", "/api/ai/workload"],
  ["GET", "/api/ai/digital-twin"],
  ["GET", "/api/ai/digital-twin/HST-B"],
  ["GET", "/api/ai/correlations"],
  ["GET", "/api/ai/feedback"],
  ["POST", "/api/ai/simulate"],
  ["GET", "/api/ai/data-quality"]
];

const COMPLAINT_AI_ROUTES = [
  ["GET", "/api/complaints/507f1f77bcf86cd799439011/duplicates"],
  ["PATCH", "/api/complaints/507f1f77bcf86cd799439011/routing"],
  ["POST", "/api/complaints/507f1f77bcf86cd799439011/duplicate-review"],
  ["POST", "/api/complaints/507f1f77bcf86cd799439011/reclassify"],
  ["GET", "/api/complaints/507f1f77bcf86cd799439011/resolution-suggestions"],
  ["POST", "/api/complaints/507f1f77bcf86cd799439011/feedback"]
];

test("the app boots with no database and health still answers", async () => {
  const res = await hit("GET", "/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.data.status, "ok");
  assert.equal(res.body.data.database, "disconnected");
});

for (const [method, path] of [...AI_ROUTES, ...COMPLAINT_AI_ROUTES]) {
  test(`${method} ${path} is mounted and refuses an anonymous caller`, async () => {
    const res = await hit(method, path, method === "GET" ? undefined : {});
    assert.notEqual(res.status, 404, "route is not mounted");
    assert.equal(res.status, 401, `expected 401, got ${res.status}`);
    assert.equal(res.body.success, false);
  });
}

test("an unknown route under /api still 404s", async () => {
  const res = await hit("GET", "/api/definitely-not-a-route");
  assert.equal(res.status, 404);
});

test("an unknown path under /api/ai answers 401, not 404", async () => {
  // The AI router authenticates before it routes — the same arrangement the
  // gate-pass router already uses. An anonymous caller therefore cannot probe
  // which AI endpoints exist, which is the intended behaviour, not a missing
  // route.
  const res = await hit("GET", "/api/ai/definitely-not-a-route");
  assert.equal(res.status, 401);
});

test("the pre-existing public routes are untouched by the AI layer", async () => {
  // These need a database to answer, but they must not 401 or 404 — the AI
  // layer must not have changed who may reach them.
  for (const path of ["/api/campus", "/api/incidents", "/api/intelligence/questions"]) {
    const res = await hit("GET", path);
    assert.notEqual(res.status, 404, `${path} disappeared`);
    assert.notEqual(res.status, 401, `${path} became authenticated`);
  }
});

test("the pre-existing authenticated routes still require an account", async () => {
  for (const path of ["/api/students/me/dashboard", "/api/admin/overview", "/api/gatepass/config", "/api/complaints"]) {
    const res = await hit("GET", path);
    assert.equal(res.status, 401, `${path} answered ${res.status}`);
  }
});

test("a validation failure is reported before authentication leaks anything", async () => {
  // The auth guard runs first, so an unauthenticated bad request is still 401 —
  // it must not reveal whether the body would have validated.
  const res = await hit("POST", "/api/ai/copilot", { question: "" });
  assert.equal(res.status, 401);
});

test("CORS still refuses an origin that is not allow-listed", async () => {
  const res = await fetch(`${base}/api/campus`, { headers: { origin: "https://not-the-campus.example" } });
  assert.equal(res.status, 403);
});
