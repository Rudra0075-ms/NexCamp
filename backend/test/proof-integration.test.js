/**
 * Round 3 — end-to-end tests against a real MongoDB, through the real app
 * with real tokens.
 *
 *   · every preview / simulation / analysis endpoint writes nothing (a hash
 *     of every document in every collection is identical before and after)
 *   · role-based access: students never reach staff analytics; a warden sees
 *     only their own hostel; student-only endpoints refuse staff
 *   · the impact proof measures a seeded intervention and records the effect
 *     in campus memory
 *
 * Own throwaway database (PROOF_TEST_MONGO_URI); skipped when no MongoDB is
 * reachable, as in the other integration suites.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { after, before } from "node:test";
import mongoose from "mongoose";

process.env.JWT_SECRET ||= "a-test-secret-that-is-long-enough-1234";
process.env.NODE_ENV = "test";
const URI = process.env.PROOF_TEST_MONGO_URI || "mongodb://127.0.0.1:27017/nex_proof_integration_test";

let available = false;
try {
  await mongoose.connect(URI, { serverSelectionTimeoutMS: 1500 });
  available = true;
} catch {
  available = false;
}
const itest = (name, fn) => test(name, { skip: available ? false : "no MongoDB reachable" }, fn);

const { Building, User, Complaint, Attendance, Incident, Intervention, CampusMemory, MessRecord, GatePass } = await import("../src/models/index.js");
const ext = await import("../src/models/ext/index.js");
const { signToken } = await import("../src/utils/token.js");
const { ensureAssets } = await import("../src/services/xo/assetService.js");
const { ensureDefaultRules } = await import("../src/services/xo/touchlessService.js");
const { flushEvents, setEventsEnabled } = await import("../src/services/xo/eventService.js");
const { createApp } = await import("../src/app.js");
const { istDateKey, weekdayOf } = await import("../src/services/ext/istTime.js");

const D = 864e5;
const H = 36e5;
let server;
let base;
const tokens = {};
const people = {};
let schedule;
let intervention;

async function call(who, method, path, body) {
  const res = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, body: json };
}

/** A fingerprint of every document in every collection. */
async function snapshot() {
  await flushEvents();
  const names = (await mongoose.connection.db.listCollections().toArray()).map((c) => c.name).sort();
  const out = {};
  for (const name of names) {
    const docs = await mongoose.connection.db.collection(name).find({}).sort({ _id: 1 }).toArray();
    out[name] = createHash("sha256").update(JSON.stringify(docs)).digest("hex");
  }
  return out;
}

const nextWeekday = (weekday, from = 1) => {
  for (let i = from; i < from + 8; i += 1) if (weekdayOf(istDateKey(new Date(), i)) === weekday) return istDateKey(new Date(), i);
  return istDateKey(new Date(), from);
};

before(async () => {
  if (!available) return;
  await mongoose.connection.dropDatabase();
  setEventsEnabled(false);
  const [a, b, c] = await Building.create([
    { code: "HST-A", mapId: "hosta", name: "HOSTEL A", type: "HOSTEL", occupancy: 300 },
    { code: "HST-B", mapId: "hostb", name: "HOSTEL B", type: "HOSTEL", occupancy: 300 },
    { code: "HST-C", mapId: "hostc", name: "HOSTEL C", type: "HOSTEL", occupancy: 300 }
  ]);
  people.admin = await User.create({ name: "ADMIN ONE", email: "admin@p.in", password: "Passw0rd1", role: "ADMIN" });
  people.warden = await User.create({ name: "WARDEN B", email: "warden@p.in", password: "Passw0rd1", role: "WARDEN", hostel: b._id, hostelName: "HOSTEL B" });
  people.mess = await User.create({ name: "MESS MGR", email: "mess@p.in", password: "Passw0rd1", role: "MESS_MANAGER" });
  const students = [];
  for (let i = 0; i < 8; i += 1) {
    const hostel = [a, b, c][i % 3];
    students.push(await User.create({ name: `STUDENT ${i}`, email: `s${i}@p.in`, password: "Passw0rd1", role: "STUDENT", studentId: `BPUT/CSE/22/10${i}`, semester: 5, hostel: hostel._id, hostelName: hostel.name, room: `${hostel.code.slice(-1)}-10${i}` }));
  }
  people.alice = students[1]; // Hostel B
  await ext.StudentProfile.insertMany(students.map((s) => ({ student: s._id, branch: "CSE", year: 3, batch: "2022", section: "A", registeredPhone: `+9190000${String(students.indexOf(s)).padStart(5, "0")}` })));
  schedule = await ext.ClassSchedule.create({ branch: "CSE", year: 3, section: "A", subject: "DBMS", subjectCode: "CS203", weekday: 1, startTime: "08:00", endTime: "08:55", room: "LH-101" });
  const now = Date.now();
  for (const [i, s] of students.entries()) {
    const sessions = Array.from({ length: 10 }, (_, k) => ({ date: new Date(now - (k * 3 + 1) * D), slot: "08:00", present: (k + i) % 4 !== 0 }));
    await Attendance.create({ student: s._id, subject: "DBMS", subjectCode: "CS203", semester: 5, totalClasses: 10, attendedClasses: sessions.filter((x) => x.present).length, semesterPlanned: 48, sessions });
  }
  // Mess register: four weeks of lunch slots.
  for (let d = 0; d < 28; d += 1) {
    const date = new Date(now - d * D);
    date.setHours(0, 0, 0, 0);
    for (const [time, crowd, queue] of [["12:00", 300, 5], ["12:30", 600, 6], ["13:00", 780, 9], ["13:30", 650, 7]]) await MessRecord.create({ date, time, meal: "LUNCH", crowd: crowd + (d % 5) * 4, demand: crowd, capacity: 850, queueMinutes: queue, waste: 5 });
  }
  // A completed intervention in Hostel B with 14 days either side, and comparable blocks A and C.
  const fixAt = new Date(now - 20 * D);
  const incident = await Incident.create({ reference: "INC-7001", title: "HOSTEL B WATER", category: "WATER", building: b._id, status: "RESOLVED", risk: 70 });
  await CampusMemory.create({ incident: incident._id, incidentReference: "INC-7001", occurredOn: fixAt, incidentType: "Hostel B water", category: "WATER", building: b._id, cause: "pump", resolution: "fixed" });
  intervention = await Intervention.create({ reference: "INT-7001", incident: incident._id, building: b._id, recommendedAction: "Fix the pump", status: "COMPLETED", outcome: { completedAt: fixAt } });
  let n = 0;
  const complaint = async (building, at) => Complaint.create({ reference: `CMP-70${String(n++).padStart(2, "0")}`, student: students[0]._id, title: "No water", description: "No water in the washroom since morning.", category: "WATER", building: building._id, createdAt: at });
  for (let k = 0; k < 14; k += 1) {
    await complaint(b, new Date(fixAt - (k + 0.5) * D));
    if (k % 3 === 0) await complaint(b, new Date(fixAt - (k + 0.6) * D));
    if (k % 5 === 0) await complaint(b, new Date(fixAt.getTime() + (k + 0.5) * D));
    if (k % 2 === 0) await complaint(a, new Date(fixAt - (k + 0.5) * D));
    if (k % 2 === 1) await complaint(a, new Date(fixAt.getTime() + (k + 0.5) * D));
    if (k % 2 === 0) await complaint(c, new Date(fixAt - (k + 0.5) * D));
    if (k % 2 === 0) await complaint(c, new Date(fixAt.getTime() + (k + 0.5) * D));
  }
  // An approved pass over tomorrow's lunch for one student.
  const tomorrow = istDateKey(new Date(), 1);
  await GatePass.create({ reference: "GP-2026-T0001", student: students[2]._id, hostel: c._id, hostelName: "HOSTEL C", date: new Date(), reason: "Home", leaveAt: new Date(`${tomorrow}T04:00:00Z`), expectedReturnAt: new Date(`${tomorrow}T12:00:00Z`), status: "APPROVED" });
  // Both bootstrap themselves on first use when empty (existing behaviour); a seeded campus already has them.
  await ensureAssets();
  await ensureDefaultRules();
  for (const [key, user] of Object.entries(people)) tokens[key] = signToken(user);
  server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (!available) return;
  server?.close();
  setEventsEnabled(true);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

itest("pre-flight, lint, portfolio and every analysis endpoint write nothing (every document hashed before and after)", async () => {
  const before = await snapshot();
  const monday = nextWeekday(1);
  const wednesday = nextWeekday(3);
  const calls = [
    ["admin", "POST", "/api/changes/preview", { kind: "CLASS", scheduleId: String(schedule._id), sessionDate: monday, type: "RESCHEDULE", newDate: wednesday, newStartTime: "13:00" }],
    ["admin", "POST", "/api/changes/preview", { kind: "CLASS", scheduleId: String(schedule._id), sessionDate: monday, type: "CANCEL" }],
    ["mess", "POST", "/api/changes/preview", { kind: "MENU", date: wednesday, meal: "LUNCH", items: ["Veg biryani"] }],
    ["admin", "POST", "/api/notices/lint", { title: "Extra class tomorrow", body: "Extra DBMS class tomorrow at 2 pm. Bring records.", audience: { branches: ["CSE"], years: [3] } }],
    ["admin", "POST", "/api/interventions/portfolio", { hours: 12 }],
    ["admin", "GET", "/api/admin/process-mining?workflow=complaint&days=90"],
    ["admin", "GET", "/api/admin/equity"],
    ["admin", "GET", "/api/attendance/sections/analysis"],
    ["admin", "GET", "/api/risk/reliability"],
    ["admin", "GET", "/api/board/proof"],
    ["alice", "GET", "/api/mess/presence-forecast?meal=LUNCH"],
    ["alice", "GET", "/api/mess/best-slot?meal=LUNCH"],
    ["alice", "GET", "/api/attendance/me/point-of-no-return"],
    ["alice", "GET", "/api/requests/unblock"]
  ];
  for (const [who, method, path, body] of calls) {
    const res = await call(who, method, path, body);
    assert.equal(res.status, 200, `${who} ${method} ${path} → ${res.status} ${JSON.stringify(res.body)?.slice(0, 200)}`);
  }
  const afterSnap = await snapshot();
  const changed = Object.keys({ ...before, ...afterSnap }).filter((k) => before[k] !== afterSnap[k]);
  assert.deepEqual(changed, [], `collections changed: ${changed.join(", ")}`);
});

itest("pre-flight shows the lunch-peak collision and the notice it would send, labelled SIMULATED", async () => {
  const res = await call("admin", "POST", "/api/changes/preview", { kind: "CLASS", scheduleId: String(schedule._id), sessionDate: nextWeekday(1), type: "RESCHEDULE", newDate: nextWeekday(3), newStartTime: "13:00" });
  const { lines, kind, writes } = res.body.data;
  assert.equal(kind, "SIMULATED");
  assert.equal(writes, 0);
  assert.ok(lines.some((l) => l.section === "MESS" && /peak at 13:00/.test(l.text)));
  assert.ok(lines.some((l) => l.section === "NOTICE" && /CSE-3A \(8\)/.test(l.text)));
  assert.ok(lines.some((l) => l.section === "ATTENDANCE"));
});

itest("students never reach staff analytics or previews", async () => {
  for (const [method, path, body] of [
    ["GET", "/api/admin/process-mining"],
    ["GET", "/api/admin/equity"],
    ["GET", `/api/interventions/${intervention._id}/impact`],
    ["POST", "/api/interventions/portfolio", {}],
    ["POST", "/api/changes/preview", { scheduleId: String(schedule._id), sessionDate: nextWeekday(1), type: "CANCEL" }],
    ["POST", "/api/notices/lint", { title: "x" }],
    ["GET", "/api/attendance/sections/analysis"]
  ]) {
    const res = await call("alice", method, path, body);
    assert.equal(res.status, 403, `student ${method} ${path} → ${res.status}`);
  }
});

itest("a mess manager may preview a menu change but not a class change; staff cannot use student-only endpoints", async () => {
  assert.equal((await call("mess", "POST", "/api/changes/preview", { scheduleId: String(schedule._id), sessionDate: nextWeekday(1), type: "CANCEL" })).status, 403);
  assert.equal((await call("mess", "POST", "/api/changes/preview", { kind: "MENU", date: nextWeekday(3), meal: "LUNCH", items: ["Rice"] })).status, 200);
  assert.equal((await call("admin", "GET", "/api/requests/unblock")).status, 403);
  assert.equal((await call("admin", "GET", "/api/mess/best-slot")).status, 403);
  assert.equal((await call("admin", "GET", "/api/attendance/me/point-of-no-return")).status, 403);
});

itest("a warden sees only their own hostel's residents in the section analysis", async () => {
  const res = await call("warden", "GET", "/api/attendance/sections/analysis");
  assert.equal(res.status, 200);
  assert.match(res.body.data.scope.sees, /HOSTEL B/);
  const names = new Set([...res.body.data.approaching.map((a) => a.name), ...res.body.data.sections.flatMap((s) => (s.individuals || []).map((i) => i.name))]);
  const hostelB = new Set((await User.find({ hostelName: "HOSTEL B", role: "STUDENT" }).lean()).map((u) => u.name));
  for (const name of names) assert.ok(hostelB.has(name), `${name} is not a Hostel B resident`);
  for (const a of res.body.data.approaching) assert.equal(a.hostel, "HOSTEL B");
});

itest("a student's point of no return covers only their own records", async () => {
  const res = await call("alice", "GET", "/api/attendance/me/point-of-no-return");
  assert.equal(res.status, 200);
  assert.equal(res.body.data.subjects.length, 1);
  const mine = await Attendance.findOne({ student: people.alice._id }).lean();
  assert.equal(res.body.data.subjects[0].attended, mine.attendedClasses);
  assert.match(res.body.data.subjects[0].formula, /^spare = ⌊/);
});

itest("impact proof: a measured DiD with named controls, written back to campus memory", async () => {
  const res = await call("admin", "GET", `/api/interventions/${intervention._id}/impact`);
  assert.equal(res.status, 200);
  const d = res.body.data;
  assert.equal(d.status, "MEASURED");
  assert.deepEqual(d.controls.map((c) => c.code).sort(), ["HST-A", "HST-C"]);
  assert.ok(["EFFECTIVE", "INCONCLUSIVE", "NO EFFECT / WORSE", "UNRELIABLE"].includes(d.verdict));
  assert.match(d.formula, /DiD = /);
  assert.equal(d.chart.treated.length, 28);
  if (d.verdict !== "UNRELIABLE") {
    const memory = await CampusMemory.findOne({ incidentReference: "INC-7001" }).lean();
    assert.equal(memory.measuredEffect.verdict, d.verdict);
  }
});

itest("impact proof refuses honestly: an unfinished intervention is 'not measurable yet'", async () => {
  const open = await Intervention.create({ reference: "INT-7002", incident: intervention.incident, recommendedAction: "Something", status: "RECOMMENDED" });
  const res = await call("admin", "GET", `/api/interventions/${open._id}/impact`);
  assert.equal(res.body.data.status, "NOT_RESOLVED");
  assert.equal(res.body.data.kind, "INSUFFICIENT DATA");
});

itest("presence forecast shows its adjustment line from approved passes, and a best slot for the student", async () => {
  const res = await call("alice", "GET", `/api/mess/presence-forecast?meal=LUNCH&date=${istDateKey(new Date(), 1)}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.awayStudents, 1);
  assert.match(res.body.data.adjustment.text, /1 student on approved passes/);
  const slot = await call("alice", "GET", "/api/mess/best-slot?meal=LUNCH");
  assert.equal(slot.status, 200);
  assert.ok(slot.body.data.recommendation || slot.body.data.insufficient || slot.body.data.text);
});

itest("invalid input is refused with 400, not a crash", async () => {
  assert.equal((await call("admin", "POST", "/api/changes/preview", { scheduleId: "nope", sessionDate: "2026-99-99", type: "CANCEL" })).status, 400);
  assert.equal((await call("admin", "GET", "/api/admin/process-mining?workflow=nonsense")).status, 400);
  assert.equal((await call("admin", "POST", "/api/interventions/portfolio", { hours: -3 })).status, 400);
  assert.equal((await call("alice", "GET", "/api/mess/best-slot?meal=BRUNCH")).status, 400);
});
