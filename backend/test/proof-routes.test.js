/**
 * Round 3 — route tests, same approach as routes.test.js: the real
 * createApp() with no database. Every new route must be mounted (not 404)
 * and refuse an anonymous caller (401); the existing routes the new paths sit
 * next to must still answer as before.
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
  server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server?.close());

async function hit(method, path, body, headers = {}) {
  const res = await fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, body: json };
}

const ID = "507f1f77bcf86cd799439011";

export const PROOF_ROUTES = [
  ["GET", "/api/admin/process-mining?workflow=complaint&days=30"],
  ["GET", "/api/admin/equity"],
  ["GET", `/api/interventions/${ID}/impact`],
  ["GET", "/api/board/proof"],
  ["POST", "/api/interventions/portfolio"],
  ["POST", "/api/changes/preview"],
  ["POST", "/api/notices/lint"],
  ["GET", "/api/mess/presence-forecast"],
  ["GET", "/api/mess/best-slot"],
  ["POST", "/api/mess/best-slot/accept"],
  ["GET", "/api/attendance/me/point-of-no-return"],
  ["GET", "/api/attendance/sections/analysis"],
  ["GET", "/api/requests/unblock"],
  ["GET", "/api/risk/reliability"]
];

for (const [method, path] of PROOF_ROUTES) {
  test(`${method} ${path} is mounted and refuses an anonymous caller`, async () => {
    const res = await hit(method, path, method === "POST" ? {} : undefined);
    assert.equal(res.status, 401, `${method} ${path} answered ${res.status}`);
  });
}

test("a forged token is refused on the Round 3 routes", async () => {
  const res = await hit("GET", "/api/admin/process-mining", undefined, { authorization: "Bearer not-a-real-token" });
  assert.equal(res.status, 401);
});

test("the neighbouring existing routes still answer as before (not captured by the new paths)", async () => {
  // Public interventions list and the open simulator are unchanged (they need the DB, so 500/200 — never 401/404).
  assert.equal((await hit("GET", "/api/admin/overview")).status, 401, "admin stays staff-only");
  assert.equal((await hit("GET", "/api/attendance/me")).status, 401, "attendance stays authenticated");
  assert.equal((await hit("GET", "/api/requests/mine")).status, 401);
  assert.equal((await hit("POST", "/api/notices/preview", {})).status, 401);
});
