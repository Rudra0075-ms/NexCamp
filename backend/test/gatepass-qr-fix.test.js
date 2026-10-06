/**
 * Gate-pass QR fix (see CHANGES-GATEPASS-QR-FIX.md).
 *
 * The bugs: typing what page 11 shows always answered "not a campus gate
 * pass", and every GET /gatepass/:id/qr minted a new token, so any second
 * screen that opened the pass retired the QR on the student's phone.
 *
 * Unit tests run everywhere; the HTTP tests use a throwaway database
 * (GP_QR_TEST_MONGO_URI, default nex_gatepass_qr_test) and skip without one.
 */
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import mongoose from "mongoose";

process.env.JWT_SECRET ||= "a-test-secret-that-is-long-enough-1234";
process.env.GATE_PASS_REVEAL_OTP = "true";
const URI = process.env.GP_QR_TEST_MONGO_URI || "mongodb://127.0.0.1:27017/nex_gatepass_qr_test";

const gp = await import("../src/services/gatePassService.js");

// ---- unit ------------------------------------------------------------------

const fakePass = (reference = "GP-2026-000014") => ({ reference, pass: {} });

test("the QR text is read despite whitespace, invisible characters, a scanner prefix or a lower-case prefix", () => {
  const good = { reference: "GP-2026-000014", token: "abc_D-12" };
  assert.deepEqual(gp.parsePayload("NEX-GP:GP-2026-000014:abc_D-12"), good);
  assert.deepEqual(gp.parsePayload("CIOS-GP:GP-2026-000014:abc_D-12"), good); // passes issued before the NeX Camp rename still scan
  assert.deepEqual(gp.parsePayload("  NEX-GP:GP-2026-000014:abc_D-12\n"), good);
  assert.deepEqual(gp.parsePayload("​CIOS-GP:GP-2026-000014:abc_D-12﻿"), good);
  assert.deepEqual(gp.parsePayload("QR: cios-gp:gp-2026-000014:abc_D-12"), good);
});

test("a typed pass ID with its code is accepted in any spacing and case; without the code it says what is missing", () => {
  assert.deepEqual(gp.parsePayload("GP-2026-000014 7KQ4-M29X"), { reference: "GP-2026-000014", code: "7KQ4M29X" });
  assert.deepEqual(gp.parsePayload("gp-2026-000014 · 7kq4 m29x"), { reference: "GP-2026-000014", code: "7KQ4M29X" });
  const bare = gp.parsePayload("GP-2026-000014");
  assert.equal(bare.reference, "GP-2026-000014");
  assert.match(bare.error, /8-character pass code/);
});

test("anything else is still not a campus gate pass", () => {
  assert.equal(gp.parsePayload("https://example.com"), null);
  assert.equal(gp.parsePayload(""), null);
  assert.equal(gp.parsePayload("DOC-2026-0001 ABCD1234"), null);
});

test("the same QR can be shown again; a new token retires it and its code", () => {
  const pass = fakePass();
  const first = gp.issueToken(pass);
  assert.match(first, /^NEX-GP:GP-2026-000014:[A-Za-z0-9_-]{32}$/);
  assert.equal(gp.currentPayload(pass), first, "re-display returns the same payload");
  const code = gp.passCode(pass);
  assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.ok(gp.codeMatches(pass, code.toLowerCase().replace("-", " ")));
  assert.ok(gp.codeMatches(pass, code.replace(/0/g, "O").replace(/1/g, "I")), "O/0 and I/1 are forgiven");

  const second = gp.issueToken(pass);
  assert.notEqual(second, first);
  assert.ok(!gp.tokenMatches(pass.pass.tokenHash, gp.parsePayload(first).token), "the old QR no longer matches");
  assert.ok(!gp.codeMatches(pass, code), "the old code no longer matches");
});

test("a spent or pre-fix pass has nothing to show again and no valid code", () => {
  const spent = fakePass();
  gp.issueToken(spent);
  spent.pass.tokenHash = undefined;
  assert.equal(gp.currentPayload(spent), null);
  assert.equal(gp.passCode(spent), null);
  assert.ok(!gp.codeMatches(spent, "0000-0000"));
  // Issued before this fix: a random token and no nonce.
  assert.equal(gp.currentPayload({ reference: "GP-2026-000001", pass: { tokenHash: "x".repeat(64) } }), null);
});

// ---- HTTP, against a real database -------------------------------------------

let available = false;
try {
  await mongoose.connect(URI, { serverSelectionTimeoutMS: 1500 });
  available = true;
} catch {
  available = false;
}
const itest = (name, fn) => test(name, { skip: available ? false : "no MongoDB reachable" }, fn);

let server;
let base;
const tokens = {};

const call = async (as, method, path, body) => {
  const res = await fetch(`${base}${path}`, { method, headers: { "content-type": "application/json", authorization: `Bearer ${tokens[as]}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
};

before(async () => {
  if (!available) return;
  await mongoose.connection.dropDatabase();
  const budget = await import("../scripts/lib/workflowBudgets.js");
  const models = { ...(await import("../src/models/index.js")), ...(await import("../src/models/ext/index.js")) };
  const { createNotice } = await import("../src/services/ext/noticeService.js");
  const fx = await budget.budgetFixtures(models, { createNotice });
  const { createApp } = await import("../src/app.js");
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [as, email] of [["student", fx.email], ["admin", "budget.admin@test.in"]]) {
    const login = await (await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: fx.password }) })).json();
    tokens[as] = login.data.token;
  }
});

after(async () => {
  if (!available) return;
  const { flushEvents } = await import("../src/services/xo/eventService.js");
  await flushEvents();
  server?.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

/** An approved pass, whichever way it gets approved (policy or the admin). */
async function approvedPass() {
  const now = Date.now();
  const applied = await call("student", "POST", "/api/gatepass", { reason: "Bank visit", destination: "Town", leaveAt: new Date(now + 20 * 60e3).toISOString(), expectedReturnAt: new Date(now + 2 * 3600e3).toISOString() });
  assert.equal(applied.status, 201, applied.body.message);
  const id = applied.body.data.gatePass.id;
  const otp = await call("student", "POST", `/api/gatepass/${id}/verify-otp`, { code: applied.body.data.otp.devCode });
  assert.equal(otp.status, 200, otp.body.message);
  if (otp.body.data.gatePass.status !== "APPROVED") {
    const ok = await call("admin", "POST", `/api/gatepass/${id}/approve`, {});
    assert.equal(ok.status, 200, ok.body.message);
  }
  return { id, reference: applied.body.data.gatePass.reference };
}

itest("opening the QR on a second screen no longer retires the one on the student's phone", async () => {
  const { id } = await approvedPass();
  const phone = await call("student", "GET", `/api/gatepass/${id}/qr`);
  const laptop = await call("student", "GET", `/api/gatepass/${id}/qr`);
  const warden = await call("admin", "GET", `/api/gatepass/${id}/qr`);
  assert.equal(phone.status, 200);
  assert.equal(laptop.body.data.payload, phone.body.data.payload);
  assert.equal(warden.body.data.payload, phone.body.data.payload);
  assert.equal(laptop.body.data.rotated, false);
  assert.ok(phone.body.data.code, "the typeable pass code is returned");

  const scan = await call("student", "POST", "/api/gatepass/scan", { token: phone.body.data.payload });
  assert.equal(scan.status, 200, scan.body.message);
  assert.equal(scan.body.data.action, "EXIT");
  const back = await call("student", "POST", "/api/gatepass/scan", { token: phone.body.data.payload });
  assert.equal(back.body.data.action, "RETURN", back.body.message);
});

itest("REGENERATE retires the earlier QR and code, and the new ones work", async () => {
  const { id } = await approvedPass();
  const old = await call("student", "GET", `/api/gatepass/${id}/qr`);
  const fresh = await call("student", "GET", `/api/gatepass/${id}/qr?rotate=1`);
  assert.equal(fresh.body.data.rotated, true);
  assert.notEqual(fresh.body.data.payload, old.body.data.payload);

  const stale = await call("student", "POST", "/api/gatepass/scan", { token: old.body.data.payload });
  assert.equal(stale.status, 400);
  assert.match(stale.body.message, /replaced by a newer one/);

  const ok = await call("student", "POST", "/api/gatepass/scan", { token: fresh.body.data.payload });
  assert.equal(ok.status, 200, ok.body.message);
  const back = await call("student", "POST", "/api/gatepass/scan", { token: fresh.body.data.payload });
  assert.equal(back.body.data.action, "RETURN", back.body.message);
});

itest("typing the pass ID and code works for exit and return; a wrong code or a bare ID is refused", async () => {
  const { id, reference } = await approvedPass();
  const qr = await call("student", "GET", `/api/gatepass/${id}/qr`);
  const code = qr.body.data.code;

  const bare = await call("student", "POST", "/api/gatepass/scan", { token: reference });
  assert.equal(bare.status, 400);
  assert.match(bare.body.message, /8-character pass code/);

  const wrong = await call("student", "POST", "/api/gatepass/scan", { token: `${reference} ${code === "0000-0000" ? "1111-1111" : "0000-0000"}` });
  assert.equal(wrong.status, 400);
  assert.match(wrong.body.message, /check the 8-character code/);

  const exit = await call("admin", "POST", "/api/gatepass/scan", { token: `${reference.toLowerCase()} ${code.toLowerCase()}` });
  assert.equal(exit.status, 200, exit.body.message);
  assert.equal(exit.body.data.action, "EXIT");

  const back = await call("admin", "POST", "/api/gatepass/scan", { token: `${reference} ${code}` });
  assert.equal(back.status, 200, back.body.message);
  assert.equal(back.body.data.action, "RETURN");

  const reused = await call("admin", "POST", "/api/gatepass/scan", { token: `${reference} ${code}` });
  assert.equal(reused.status, 400, "a spent pass's code cannot be reused");
});
