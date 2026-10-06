/**
 * The 30-second proof reel (see CHANGES-REEL.md) — GET /api/xo/reel.
 *
 * Seeds its own throwaway database (REEL_TEST_MONGO_URI, default
 * nex_reel_test) with the real seed script, then calls the route over HTTP
 * against createApp(): ten scenes, each with a kind and a source, no document
 * written by any number of plays, and the ?lite=1 body inside its 12 KB 2G
 * budget. Skipped when no MongoDB is reachable, as the other integration
 * tests are.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test, { after, before } from "node:test";
import mongoose from "mongoose";

process.env.JWT_SECRET ||= "a-test-secret-that-is-long-enough-1234";
process.env.NODE_ENV = "test";
const URI = process.env.REEL_TEST_MONGO_URI || "mongodb://127.0.0.1:27017/nex_reel_test";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REEL_BUDGET_BYTES = 12 * 1024;

let available = false;
try {
  await mongoose.connect(URI, { serverSelectionTimeoutMS: 1500 });
  available = true;
} catch {
  available = false;
}
const itest = (name, fn) => test(name, { skip: available ? false : "no MongoDB reachable" }, fn);

const { createApp } = await import("../src/app.js");
const { REEL_SCENES } = await import("../src/services/xo/reelService.js");

let server;
let base;
let admin;
let student;

async function login(email, password) {
  const r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  return (await r.json()).data.token;
}

/** Every collection's document count, so a write anywhere shows up. */
async function counts() {
  const out = {};
  for (const c of await mongoose.connection.db.listCollections().toArray()) out[c.name] = await mongoose.connection.db.collection(c.name).countDocuments();
  return out;
}

const getReel = async (token, query = "") => {
  const r = await fetch(`${base}/api/xo/reel${query}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  const text = await r.text();
  return { status: r.status, text, body: JSON.parse(text) };
};

before(async () => {
  if (!available) return;
  // The real seed, into this test's own database only.
  await promisify(execFile)(process.execPath, ["src/seed/index.js", "--fresh"], { cwd: ROOT, env: { ...process.env, MONGO_URI: URI }, timeout: 180000 });
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  admin = await login("control@bput.ac.in", "Control@2026");
  student = await login("pritish@bput.ac.in", "Campus@2026");
});

after(async () => {
  if (!available) return;
  server?.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

test("the reel has exactly ten scene builders, one per scene key", () => {
  assert.deepEqual(REEL_SCENES.map(([key]) => key), ["certificate", "duplicate", "safety", "provenFix", "classChange", "noticeReach", "gatePass", "noSmartphone", "adminView", "ledger"]);
});

itest("GET /api/xo/reel refuses an anonymous caller and a student", async () => {
  assert.equal((await getReel(null)).status, 401);
  assert.equal((await getReel(student)).status, 403);
});

itest("GET /api/xo/reel returns ten scenes, each with a kind and a source", async () => {
  const { status, body } = await getReel(admin);
  assert.equal(status, 200);
  assert.ok(body.data.generatedAt);
  assert.equal(body.data.scenes.length, 10);
  for (const s of body.data.scenes) {
    assert.ok(s.kind, `${s.key} has a kind`);
    assert.ok(s.source, `${s.key} has a source`);
    assert.ok(["ACTUAL DATA", "SIMULATED", "ESTIMATE", "ASSUMPTION", "INSUFFICIENT DATA"].includes(s.kind), `${s.key}: ${s.kind}`);
  }
  const by = Object.fromEntries(body.data.scenes.map((s) => [s.key, s]));
  // Spot checks against the seeded data and the written rules.
  assert.equal(by.safety.data.groups, 7);
  assert.equal(Object.keys(by.safety.data.ids).length, 7);
  assert.equal(by.safety.data.priority, "CRITICAL");
  assert.equal(by.safety.data.rule, "ELECTRICAL_ARC");
  assert.equal(by.certificate.data.total, Object.keys(by.certificate.data.conditions).length);
  assert.equal(by.classChange.data.preflight?.writes ?? 0, 0);
  // No student names anywhere in the reel.
  const text = JSON.stringify(body);
  for (const name of ["PRITISH", "Pritish"]) assert.ok(!text.includes(name), `the reel names ${name}`);
});

itest("playing the reel writes nothing, however many times it plays", async () => {
  await new Promise((r) => setTimeout(r, 300)); // let login side effects settle
  const before = await counts();
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await getReel(admin)).status, 200);
    assert.equal((await getReel(admin, "?lite=1")).status, 200);
  }
  await new Promise((r) => setTimeout(r, 300)); // any fire-and-forget write would land by now
  assert.deepEqual(await counts(), before);
});

itest("?lite=1 keeps all ten scenes and stays inside the 12 KB 2G budget", async () => {
  const full = await getReel(admin);
  const lite = await getReel(admin, "?lite=1");
  assert.equal(lite.body.lite, true);
  assert.equal(lite.body.data.scenes.length, 10);
  const bytes = Buffer.byteLength(lite.text);
  assert.ok(bytes <= REEL_BUDGET_BYTES, `lite reel is ${bytes} bytes, over ${REEL_BUDGET_BYTES}`);
  // The trim changes nothing the reel draws: every scene's data is identical.
  assert.deepEqual(lite.body.data.scenes.map((s) => s.data), full.body.data.scenes.map((s) => s.data));
});
