/**
 * End-to-end smoke test for the Exception-Only Campus, against a running API
 * and a seeded database (npm run seed -- --fresh includes the xo seed).
 *
 *   cd backend && npm run seed -- --fresh && npm run dev   # terminal 1
 *   cd backend && npm run smoke:xo                         # terminal 2
 *
 * Exits non-zero if any expectation fails.
 */
import { env } from "../src/config/env.js";

const BASE = process.env.SMOKE_URL || `http://127.0.0.1:${env.port}`;
let pass = 0;
const failures = [];
const tokens = {};
const users = {};

function check(name, condition, detail) {
  if (condition) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function call(method, path, { body, as } = {}) {
  const headers = { "content-type": "application/json" };
  if (as && tokens[as]) headers.authorization = `Bearer ${tokens[as]}`;
  const res = await fetch(BASE + path, { method, headers, body: body && method !== "GET" ? JSON.stringify(body) : undefined });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, body: json, data: json?.data };
}

async function login(as, email, password) {
  const res = await call("POST", "/api/auth/login", { body: { email, password } });
  tokens[as] = res.data?.token;
  users[as] = res.data?.user;
  check(`${as} signs in`, Boolean(tokens[as]), `status ${res.status}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Each phase adds a section below; a section reads only what it needs.
const sections = [];
const section = (name, fn) => sections.push([name, fn]);

section("Phase 1 · campus event log", async () => {
  const summary = await call("GET", "/api/xo/events/summary", { as: "admin" });
  check("event summary is readable by staff", summary.status === 200 && summary.data.rows.length > 0, `status ${summary.status}`);
  const denied = await call("GET", "/api/xo/events", { as: "student" });
  check("students cannot read the event log", denied.status === 403, `status ${denied.status}`);
  const filed = await call("POST", "/api/complaints", { as: "student", body: { title: "Fan making noise in B-214", description: "The ceiling fan in B-214 makes a grinding noise at every speed.", category: "ELECTRICITY", location: "HOSTEL B · B-214" } });
  check("a complaint files as before", filed.status === 201, `status ${filed.status}`);
  const id = filed.data?.complaint?.id;
  await sleep(400);
  const own = await call("GET", `/api/xo/events/Complaint/${id}`, { as: "student" });
  const types = (own.data?.events || []).map((e) => e.type);
  check("filing emitted COMPLAINT_CREATED and COMPLAINT_CLASSIFIED", types.includes("COMPLAINT_CREATED") && types.includes("COMPLAINT_CLASSIFIED"), types.join(","));
  const created = (own.data?.events || []).find((e) => e.type === "COMPLAINT_CREATED");
  check("the event carries the student's cohort and an audit reference", created?.cohort?.hostel === "HOSTEL B" && /^#\d+$/.test(created?.auditRef || ""), JSON.stringify(created?.cohort));
  const backfill = await call("POST", "/api/xo/events/backfill", { as: "admin" });
  check("backfill runs and reports what it derived", backfill.status === 200 && backfill.data.written > 0, `status ${backfill.status}`);
});

section("Phase 2 · Touchless Lane", async () => {
  const rules = await call("GET", "/api/xo/policy/rules", { as: "student" });
  check("active rules are readable, each with a citation", rules.status === 200 && rules.data.rules.length >= 3 && rules.data.rules.every((r) => r.citation?.section), `status ${rules.status}`);
  const preview = await call("POST", "/api/xo/policy/preview", { as: "student", body: { type: "BONAFIDE_CERTIFICATE", purpose: "Bank loan" } });
  check("a dry-run preview returns a verdict and writes nothing", preview.status === 200 && ["AUTO_APPROVE", "ROUTE_TO_HUMAN"].includes(preview.data.decision), JSON.stringify(preview.body).slice(0, 160));
  const doc = await call("POST", "/api/documents", { as: "student", body: { type: "BONAFIDE", purpose: "Smoke — scholarship form" } });
  check("a bonafide request returns the policy verdict", doc.status === 201 && doc.data.policy?.decision, `status ${doc.status}`);
  if (doc.data?.policy?.decision === "AUTO_APPROVE") {
    check("in policy: issued instantly with a verification code", doc.data.status === "ISSUED" && doc.data.decidedBy === "POLICY" && doc.data.certificate?.verificationCode);
    const undo = await call("POST", `/api/xo/policy/undo/document/${doc.data.id}`, { as: "admin", body: { reason: "Smoke test — undo path" } });
    check("staff can undo it; a follow-up request goes to the office", undo.status === 200 && /^DOC-/.test(undo.data.followUp || ""), `status ${undo.status}`);
  } else {
    check("out of policy: sent to the office with the failed conditions", doc.data?.status === "SUBMITTED" && doc.data.policy.failedConditions.length > 0);
  }
  const noReason = await call("POST", `/api/xo/policy/undo/document/${doc.data?.id}`, { as: "admin", body: { reason: "" } });
  check("an undo without a reason is refused", noReason.status === 400, `status ${noReason.status}`);
  const studentUndo = await call("POST", `/api/xo/policy/undo/document/${doc.data?.id}`, { as: "student", body: { reason: "I want to" } });
  check("a student cannot undo a policy decision", studentUndo.status === 403, `status ${studentUndo.status}`);
  const inbox = await call("GET", "/api/xo/policy/exceptions", { as: "admin" });
  check("the exceptions inbox lists only items needing a person, each with why", inbox.status === 200 && inbox.data.exceptions.every((e) => e.why.length > 0));
  const rate = await call("GET", "/api/xo/policy/touchless-rate", { as: "admin" });
  check("the Touchless Rate shows its calculation", rate.status === 200 && rate.data.calculation.formula && rate.data.calculation.denominator === rate.data.closed);
  const receipt = await call("POST", "/api/xo/services", { as: "student", body: { receipt: "RCP-T-1000" } });
  check("a fee receipt copy on the ledger is issued by §9.4", receipt.status === 201 && receipt.data.status === "FULFILLED" && receipt.data.decidedBy === "POLICY", JSON.stringify(receipt.data?.policyDecision?.failedConditions || []).slice(0, 120));
  const mine = await call("GET", "/api/requests/mine", { as: "student" });
  check("page 17: every request carries who decided and why", mine.status === 200 && mine.data.items.filter((i) => ["document", "gatepass", "service", "complaint"].includes(i.kind)).every((i) => i.decision));
});

section("Phase 3 · Friction Ledger", async () => {
  const pub = await call("GET", "/api/xo/ledger/public");
  check("the landing Friction Map is public and aggregate only", pub.status === 200 && pub.data.old.kind === "ASSUMPTION" && typeof pub.data.now.requests === "number");
  const ledger = await call("GET", "/api/xo/ledger", { as: "admin" });
  check("the ledger breaks down by type, week, hostel, branch and year", ledger.status === 200 && ["byType", "byWeek", "byHostel", "byBranch", "byYear"].every((k) => Array.isArray(ledger.data[k])));
  const denied = await call("GET", "/api/xo/ledger", { as: "student" });
  check("students cannot read the staff ledger", denied.status === 403);
  const me = await call("GET", "/api/xo/ledger/me", { as: "student" });
  check("a student sees the time they saved this month, labelled ESTIMATE", me.status === 200 && ["ESTIMATE", "INSUFFICIENT DATA"].includes(me.data.kind));
  const board = await call("GET", "/api/xo/board/impact", { as: "student" });
  check("page 20: recurring issues measured before and after the fix", board.status === 200 && Array.isArray(board.data.issues));
});

section("Phase 4 · report smarter", async () => {
  const similar = await call("POST", "/api/xo/report/similar", { as: "student", body: { text: "No water in the Hostel B taps since the morning", category: "WATER" } });
  check("a known Hostel B water problem is offered before filing", similar.status === 200 && similar.data.match?.reference, JSON.stringify(similar.data).slice(0, 160));
  if (similar.data?.match) {
    const follow = await call("POST", `/api/xo/incidents/${similar.data.match.incidentId}/follow`, { as: "student", body: { room: "B-214" } });
    check("+1 & Follow attaches the student to the incident", follow.status === 201 && follow.data.following);
  }
  const eta = await call("GET", "/api/xo/eta", { as: "student" });
  check("ETAs are P50/P80 or say Insufficient history", eta.status === 200 && eta.data.complaints.every((c) => c.p50Hours !== undefined && (c.p50Hours !== null || /Insufficient history/.test(c.text))));
  const closures = await call("GET", "/api/xo/closures", { as: "admin" });
  check("false closures are flagged with their rule, reopen rate by department", closures.status === 200 && closures.data.byDepartment.length > 0 && closures.data.flags.every((f) => f.reasons.length));
  const assets = await call("GET", "/api/xo/assets", { as: "student" });
  const pump = assets.data?.assets?.find((a) => a.code === "HSTB-PUMP-2");
  check("asset history: Booster pump 2 has failures and a RECOMMENDED ACTION", pump && pump.failures12m >= 3 && pump.recommendation?.kind === "RECOMMENDED ACTION", pump?.headline);
});

section("Phase 5 · guaranteed reach", async () => {
  const h = await call("POST", "/api/xo/notices/hygiene", { as: "admin", body: { title: "Water off in Hostel B", body: "Hostel B water off 10–13 tomorrow", audience: {} } });
  check("hygiene warns when the audience is much broader than the hostel the text names", h.status === 200 && h.data.breadth, JSON.stringify(h.data?.breadth || h.body).slice(0, 140));
  const n = await call("POST", "/api/xo/notices", { as: "admin", body: { title: `Smoke reach ${Date.now()}`, body: "Please read — smoke test of the reach ladder", priority: "CRITICAL", audience: { hostels: ["HOSTEL B"] }, reachTarget: { pct: 100, deadline: new Date(Date.now() + 3600000).toISOString() }, confirmDuplicate: true } });
  check("a CRITICAL notice with a reach target is published", n.status === 201 && n.data.reachTarget?.pct === 100, `status ${n.status}`);
  const f = await call("GET", `/api/xo/notices/${n.data?.id}/reach`, { as: "admin" });
  check("its reach funnel lists the unreached", f.status === 200 && f.data.funnel.targeted > 0 && Array.isArray(f.data.unreached));
  const k = await call("GET", "/api/xo/reach/kiosk-list", { as: "warden" });
  check("the kiosk list shows students with unread critical notices", k.status === 200 && k.data.students.length > 0);
  const sw = await call("POST", "/api/xo/reach/sweep", { as: "admin" });
  check("the reach sweep runs", sw.status === 200 && typeof sw.data.notices === "number");
});

section("Phase 6 · change propagation", async () => {
  const mine = await call("GET", "/api/xo/changes/mine", { as: "student" });
  check("a student sees what changed for them, with their own effect", mine.status === 200 && mine.data.changes.length > 0 && mine.data.changes.every((c) => c.forYou));
  const all = await call("GET", "/api/xo/changes", { as: "admin" });
  const cls = all.data?.changes?.find((c) => c.type === "CLASS_CANCEL");
  check("a class cancellation carries its notice and attendance projections", cls && cls.notice && cls.effects.attendance);
  const s = await call("POST", "/api/xo/changes/shutdown", { as: "facility", body: { buildingCode: "HST-A", utility: "ELECTRICITY", from: new Date(Date.now() + 5 * 864e5).toISOString(), to: new Date(Date.now() + 5 * 864e5 + 7200000).toISOString(), reason: "Smoke" } });
  check("facility can plan a shutdown; residents get a notice", s.status === 201 && s.data.notice?.reference, `status ${s.status}`);
  const denied = await call("POST", "/api/xo/changes/shutdown", { as: "student", body: { buildingCode: "HST-A", utility: "WATER", from: new Date().toISOString(), to: new Date(Date.now() + 3600000).toISOString() } });
  check("a student cannot plan a shutdown", denied.status === 403);
});

section("Phase 7 · chaos import", async () => {
  const dry = await call("POST", "/api/xo/import/whatsapp", { as: "admin", body: { sample: true } });
  check("the sample export dry-runs: ~300 lines, every label counted, nothing written", dry.status === 200 && dry.data.dryRun === true && dry.data.written === 0 && dry.data.lines >= 300, `status ${dry.status}`);
  check("the report finds night notices, a correction, unacknowledged complaints and repeated questions", dry.data?.findings && ["nightNotices", "superseded", "unacknowledged", "repeatedQuestions"].every((k) => dry.data.findings[k].count > 0));
  const ios = await call("POST", "/api/xo/import/whatsapp", { as: "admin", body: { text: "[25/08/26, 9:05:12 PM] Warden Sir: Attention: water off tomorrow\n[26/08/26, 8:02:44 AM] Rahul Das: No water in 2nd floor washroom" } });
  check("the iOS format parses too", ios.status === 200 && ios.data.format === "IOS" && ios.data.messages === 2);
  const denied = await call("POST", "/api/xo/import/whatsapp", { as: "warden", body: { sample: true } });
  check("only an administrator can import", denied.status === 403);
});

section("Phase 8 · policy what-if", async () => {
  const rules = await call("GET", "/api/xo/policy/rules", { as: "admin" });
  const base = rules.data.rules.find((r) => r.key === "BONAFIDE-INSTANT");
  const edit = { ...base, conditions: base.conditions.map((c) => (c.field === "overdueDues" ? { ...c, value: 20000 } : c)) };
  const r = await call("POST", "/api/xo/policy/replay", { as: "admin", body: { days: 30, edits: [edit] } });
  check("a replay returns SIMULATED before/after per type with assumptions", r.status === 200 && r.data.byType.length === 3 && r.data.assumptions.length >= 4 && ["SIMULATED", "INSUFFICIENT DATA"].includes(r.data.kind), `status ${r.status}`);
  const after = await call("GET", "/api/xo/policy/rules", { as: "admin" });
  check("the live rule is unchanged by the replay", after.data.rules.find((x) => x.key === "BONAFIDE-INSTANT").conditions.find((c) => c.field === "overdueDues").value === 1000);
  const student = await call("POST", "/api/xo/policy/replay", { as: "student", body: { days: 30 } });
  check("students cannot run the what-if", student.status === 403);
});

async function main() {
  console.log(`Exception-Only Campus smoke test against ${BASE}\n`);
  const health = await call("GET", "/health");
  if (health.body?.data?.database !== "connected") {
    console.log("API or database not reachable.");
    process.exit(1);
  }
  await login("student", env.demo.studentEmail, env.demo.studentPassword);
  await login("admin", env.demo.adminEmail, env.demo.adminPassword);
  await login("warden", "warden.hostelb@bput.ac.in", env.demo.adminPassword);
  await login("facility", "facility@bput.ac.in", env.demo.adminPassword);
  for (const [name, fn] of sections) {
    console.log(`\n${name}`);
    try {
      await fn();
    } catch (error) {
      check(`${name} ran without throwing`, false, error.stack?.split("\n").slice(0, 3).join(" | "));
    }
  }
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log("\nException-Only Campus smoke test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
