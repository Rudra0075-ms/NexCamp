/**
 * PS07 extension pack — route and authorisation tests.
 *
 * Same approach as routes.test.js: the real createApp() with no database.
 * Every new route must be mounted (not 404) and must refuse an anonymous
 * caller (401). The only public routes are the certificate verifier and the
 * SMS webhook, which authenticate differently and are tested separately.
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

export const GUARDED = [
  ["GET", "/api/notices/feed"],
  ["GET", "/api/notices/rules"],
  ["GET", "/api/notices"],
  ["POST", "/api/notices"],
  ["POST", "/api/notices/preview"],
  ["POST", "/api/notices/sweep"],
  ["GET", `/api/notices/${ID}/dashboard`],
  ["POST", `/api/notices/${ID}/read`],
  ["POST", `/api/notices/${ID}/ack`],
  ["POST", `/api/notices/${ID}/done`],
  ["POST", `/api/notices/${ID}/cancel`],
  ["GET", "/api/documents"],
  ["POST", "/api/documents"],
  ["POST", "/api/documents/kiosk"],
  ["GET", `/api/documents/${ID}/pdf`],
  ["POST", `/api/documents/${ID}/review`],
  ["POST", `/api/documents/${ID}/issue`],
  ["POST", `/api/documents/${ID}/revoke`],
  ["GET", "/api/timetable/week"],
  ["GET", "/api/timetable/day?day=tomorrow"],
  ["POST", "/api/timetable/ask"],
  ["GET", "/api/timetable/attendance-adjusted"],
  ["GET", "/api/timetable/schedules"],
  ["GET", "/api/timetable/changes"],
  ["POST", "/api/timetable/changes"],
  ["GET", "/api/mess-menu"],
  ["GET", "/api/mess-menu/next"],
  ["POST", "/api/mess-menu/changes"],
  ["GET", "/api/fees/me"],
  ["GET", "/api/fees/summary"],
  ["POST", "/api/fees/reminders"],
  ["GET", "/api/requests/mine"],
  ["GET", "/api/requests/pending"],
  ["GET", "/api/friction"],
  ["PATCH", "/api/friction/baselines/COMPLAINT"],
  ["POST", "/api/friction/compare"],
  ["POST", "/api/sms/simulate"],
  ["GET", "/api/sms/phones"],
  ["GET", "/api/sms/activity"],
  ["GET", "/api/fix/mine"],
  ["GET", "/api/fix/metrics"],
  ["GET", "/api/fix/resolved"],
  ["POST", `/api/fix/reopen/${ID}`],
  ["GET", `/api/fix/${ID}/proof`],
  ["POST", `/api/fix/${ID}/proof`],
  ["POST", `/api/fix/${ID}/confirm`],
  ["POST", "/api/faq/ask"],
  ["POST", "/api/faq/request"],
  ["GET", "/api/faq/sections"],
  ["GET", "/api/faq/stats"],
  ["PUT", "/api/faq/sections/HOSTEL-IN-TIME"],
  ["GET", "/api/board"],
  ["GET", "/api/adoption/datasets"],
  ["GET", "/api/adoption/templates/fees"],
  ["POST", "/api/adoption/validate/fees"]
];

for (const [method, path] of GUARDED) {
  test(`${method} ${path} is mounted and refuses an anonymous caller`, async () => {
    const res = await hit(method, path, method === "GET" ? undefined : {});
    assert.equal(res.status, 401, `${method} ${path} answered ${res.status}`);
    assert.equal(res.body?.success, false);
  });
}

test("a forged token is refused on the new routes too", async () => {
  const res = await hit("GET", "/api/notices/feed", undefined, { authorization: "Bearer not-a-real-token" });
  assert.equal(res.status, 401);
});

test("the public verifier rejects a malformed code before touching the database", async () => {
  const res = await hit("GET", "/api/verify/bad!!code");
  assert.equal(res.status, 400);
});

test("the public copy check validates its body", async () => {
  const res = await hit("POST", "/api/verify/ABCD-EF23", {});
  assert.equal(res.status, 400);
  assert.equal(res.body.details.content, "content is required");
});

test("existing routes still answer exactly as before (spot check)", async () => {
  assert.equal((await hit("GET", "/api/complaints")).status, 401);
  assert.equal((await hit("GET", "/api/kiosk/activity")).status, 401);
  const root = await hit("GET", "/api");
  assert.equal(root.status, 200);
  assert.equal(root.body.data.name, "NeX Camp API");
  assert.equal((await hit("GET", "/api/no-such-route")).status, 404);
});

test("the SMS webhook answers 503 until a shared secret is configured", async () => {
  delete process.env.SMS_WEBHOOK_SECRET;
  const res = await hit("POST", "/api/sms/inbound", { from: "+919000000001", text: "ATT" });
  assert.equal(res.status, 503);
});

test("the SMS webhook refuses a wrong or missing secret", async () => {
  process.env.SMS_WEBHOOK_SECRET = "right-secret-value";
  try {
    assert.equal((await hit("POST", "/api/sms/inbound", { from: "+919000000001", text: "ATT" })).status, 401);
    assert.equal((await hit("POST", "/api/sms/inbound", { from: "+919000000001", text: "ATT" }, { "x-sms-webhook-secret": "wrong-secret-value" })).status, 401);
    // Right secret, but no sender: rejected before any lookup.
    assert.equal((await hit("POST", "/api/sms/inbound", { text: "ATT" }, { "x-sms-webhook-secret": "right-secret-value" })).status, 400);
  } finally {
    delete process.env.SMS_WEBHOOK_SECRET;
  }
});
