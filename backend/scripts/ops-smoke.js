/**
 * End-to-end smoke test for the operational intelligence layer, against a
 * running API and a seeded database.
 *
 *   cd backend && npm run seed:fresh && npm run dev   # terminal 1
 *   cd backend && npm run smoke:ops                   # terminal 2
 *
 * Walks SLA breach prediction, workload, the what-if simulator, the digital
 * twin, cross-module correlation, the data quality guardian, the complaint
 * lifecycle (status move → resolve → student notification → rating), the
 * resolution learning loop, feedback intelligence, the audit chain entries
 * those actions write, and the student/staff/admin authorisation boundary.
 *
 * Passes with or without an AI provider: it asserts that every response names
 * its source honestly, not that a model answered. It files one complaint of its
 * own and resolves it, so run it against a demo database.
 *
 * Exits non-zero on the first broken expectation.
 */
import { env } from "../src/config/env.js";

const BASE = process.env.SMOKE_URL || `http://127.0.0.1:${env.port}`;

let pass = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const tokens = {};

async function call(method, path, { body, as } = {}) {
  const headers = { "content-type": "application/json" };
  if (as && tokens[as]) headers.authorization = `Bearer ${tokens[as]}`;
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body && method !== "GET" ? JSON.stringify(body) : undefined
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, body: json, data: json?.data, headers: res.headers };
}

const VALID_SOURCES = [
  "AI_MODEL",
  "DETERMINISTIC_FALLBACK",
  "AI_NOT_CONFIGURED",
  "INSUFFICIENT_DATA",
  "NO_SIGNAL"
];

/**
 * The single most important assertion in this file: a result may never name a
 * provider or a model unless a model genuinely produced it.
 */
function checkProvenance(name, block) {
  check(`${name} · names its source`, VALID_SOURCES.includes(block?.source), `got ${block?.source}`);
  if (block?.source === "AI_MODEL") {
    check(`${name} · a model result names its provider and model`, Boolean(block.provider && block.model));
  } else {
    check(
      `${name} · a non-model result names no model`,
      !block?.provider && !block?.model,
      `provider=${block?.provider} model=${block?.model}`
    );
  }
}

async function main() {
  const login = async (as, email, password) => {
    const res = await call("POST", "/api/auth/login", { body: { email, password } });
    tokens[as] = res.data?.token;
    return res.status;
  };
  check("admin signs in", (await login("admin", env.demo.adminEmail, env.demo.adminPassword)) === 200);
  check("student signs in", (await login("student", env.demo.studentEmail, env.demo.studentPassword)) === 200);

  // ---- Feature 8 ------------------------------------------------------------
  console.log("\nfeature 8 · SLA breach prediction");
  const sla = await call("GET", "/api/ai/sla", { as: "admin" });
  check("SLA forecast answers", sla.status === 200);
  const f = sla.data?.forecast;
  check("every open complaint is scored", f && f.rows.length > 0 && f.rows.every((r) => ["BREACHED", "HIGH", "MEDIUM", "LOW"].includes(r.risk)));
  check("BREACHED is measured, the rest predicted", f?.rows.every((r) => (r.risk === "BREACHED") === (r.isPrediction === false)));
  check("every row carries its reasons", f?.rows.every((r) => r.reasons.length > 0));
  check("counts add up to the open complaints", Object.values(f?.counts || {}).reduce((a, b) => a + b, 0) === f?.openExamined);
  checkProvenance("SLA narration", sla.data?.narrated);

  // ---- Feature 9 ------------------------------------------------------------
  console.log("\nfeature 9 · workload");
  const work = await call("GET", "/api/ai/workload", { as: "admin" });
  check("workload answers", work.status === 200);
  const pendingTotal = (work.data?.analysis?.departments || []).reduce((a, r) => a + r.pending, 0);
  check("department queues add up to the total pending", pendingTotal === work.data?.analysis?.totalPending);
  check("days-to-clear is null, not guessed, without throughput", (work.data?.analysis?.departments || []).every((r) => r.resolvedPerDay ? r.daysToClear !== null : r.daysToClear === null));
  checkProvenance("workload narration", work.data?.narrated);

  // ---- Feature 12 -----------------------------------------------------------
  console.log("\nfeature 12 · what-if simulation");
  const sim = await call("POST", "/api/ai/simulate", { as: "admin", body: { increasePct: 30 } });
  check("simulation answers", sim.status === 200);
  check("it is labelled a simulation", sim.data?.label === "SIMULATION / ESTIMATE");
  check("current figures equal the measured baseline", sim.data?.current?.filedInWindow === sim.data?.baseline?.filedInWindow);
  check("the estimate applies the increase", Math.abs(sim.data?.estimated?.filedInWindow - sim.data?.baseline?.filedInWindow * 1.3) < 0.11);
  checkProvenance("simulation narration", sim.data?.narrated);
  check("an out-of-range increase is refused", (await call("POST", "/api/ai/simulate", { as: "admin", body: { increasePct: 9000 } })).status === 400);
  check("a student cannot run the simulator", (await call("POST", "/api/ai/simulate", { as: "student", body: { increasePct: 30 } })).status === 403);

  // ---- Feature 10 -----------------------------------------------------------
  console.log("\nfeature 10 · campus digital twin");
  const twin = await call("GET", "/api/ai/digital-twin", { as: "admin" });
  check("twin answers", twin.status === 200);
  const nodes = (twin.data?.groups || []).flatMap((g) => g.nodes);
  check("every block is placed in a group", nodes.length === twin.data?.campus?.buildings);
  check("every highlighted block says why", nodes.every((n) => n.status === "NORMAL" || n.reasons.length > 0));
  const busiest = nodes.slice().sort((a, b) => b.openComplaints - a.openComplaints)[0];
  const node = await call("GET", `/api/ai/digital-twin/${busiest.code}`, { as: "admin" });
  check("a block drills down to its records", node.status === 200 && Array.isArray(node.data?.complaints));
  check("the drill-down matches the tile's count", Math.min(busiest.openComplaints, 25) === node.data?.complaints.length);
  check("an unknown block is a 404", (await call("GET", "/api/ai/digital-twin/NOPE", { as: "admin" })).status === 404);
  check("a student cannot read the twin", (await call("GET", "/api/ai/digital-twin", { as: "student" })).status === 403);

  // ---- Feature 11 -----------------------------------------------------------
  console.log("\nfeature 11 · cross-module intelligence");
  const corr = await call("GET", "/api/ai/correlations", { as: "admin" });
  check("correlations answer", corr.status === 200);
  check("every hostel is profiled", (corr.data?.snapshot?.hostels || []).length > 0);
  check("findings are labelled possible correlations", (corr.data?.snapshot?.findings || []).every((row) => row.label === "POSSIBLE CORRELATION"));
  check("the response disclaims causation", /not evidence that one causes another/.test(corr.data?.snapshot?.disclaimer || ""));
  checkProvenance("correlation narration", corr.data?.narrated);

  // ---- Feature 15 -----------------------------------------------------------
  console.log("\nfeature 15 · data quality guardian");
  const dq = await call("GET", "/api/ai/data-quality", { as: "admin" });
  check("data quality answers", dq.status === 200);
  check("every check ran", dq.data?.report?.checksRun >= 15 && (dq.data?.report?.errored || []).length === 0, JSON.stringify(dq.data?.report?.errored));
  check("every finding names actual records", (dq.data?.report?.findings || []).every((row) => row.records.length > 0 && row.records.every((r) => r.id)));
  check("the guardian is read-only", /never modifies/.test(dq.data?.report?.governance || ""));
  check("a student cannot run it", (await call("GET", "/api/ai/data-quality", { as: "student" })).status === 403);

  // ---- Complaint lifecycle, Features 16, 17, 20, 21 -------------------------
  console.log("\ncomplaint lifecycle · resolve, notify, rate, learn");
  const filed = await call("POST", "/api/complaints", {
    as: "student",
    body: { title: "Tap leaking in hostel washroom", description: "The tap in the second floor washroom is leaking water continuously onto the floor.", category: "WATER", buildingCode: "HST-B" }
  });
  check("the student files a complaint", filed.status === 201);
  const id = filed.data?.complaint?.id;
  check("rating an unresolved complaint is refused", (await call("POST", `/api/complaints/${id}/feedback`, { as: "student", body: { rating: 4 } })).status === 400);
  check("a student cannot move a status", (await call("PATCH", `/api/complaints/${id}`, { as: "student", body: { status: "RESOLVED" } })).status === 403);

  const moved = await call("PATCH", `/api/complaints/${id}`, { as: "admin", body: { status: "INVESTIGATING" } });
  check("staff move it to INVESTIGATING", moved.data?.complaint?.status === "INVESTIGATING");
  const resolved = await call("PATCH", `/api/complaints/${id}`, { as: "admin", body: { status: "RESOLVED", resolutionDescription: "Plumber replaced the tap washer and cleared the drain." } });
  check("staff resolve it", resolved.data?.complaint?.status === "RESOLVED");
  check("the resolution is recorded", Boolean(resolved.data?.complaint?.resolution?.resolvedAt));

  const inbox = await call("GET", "/api/ai/notifications", { as: "student" });
  const notice = (inbox.data?.notifications || []).find((n) => n.kind === "COMPLAINT_RESOLVED" && n.meta?.complaint === id);
  check("the student is notified of the resolution", Boolean(notice));
  check("the resolution notice is graded LOW", notice?.priority === "LOW");

  check("staff cannot rate a student's complaint", (await call("POST", `/api/complaints/${id}/feedback`, { as: "admin", body: { rating: 5 } })).status === 403);
  check("an out-of-range rating is refused", (await call("POST", `/api/complaints/${id}/feedback`, { as: "student", body: { rating: 7 } })).status === 400);
  const rated = await call("POST", `/api/complaints/${id}/feedback`, { as: "student", body: { rating: 5, comment: "Quick fix, thank you" } });
  check("the student rates it", rated.status === 201);
  check("sentiment is labelled with its method", rated.data?.sentiment?.method === "LEXICON + STAR_RATING");
  check("a second rating is refused", (await call("POST", `/api/complaints/${id}/feedback`, { as: "student", body: { rating: 1 } })).status === 409);

  const reread = await call("GET", `/api/complaints/${id}`, { as: "student" });
  check("the rating persists on the record", reread.data?.complaint?.feedback?.rating === 5);
  const timeline = await call("GET", `/api/ai/timeline/complaint/${id}`, { as: "student" });
  check("the timeline reaches FEEDBACK", timeline.data?.timeline?.stages?.at(-1)?.state === "DONE");

  const audit = await call("GET", "/api/ai/audit?limit=10", { as: "admin" });
  const actions = (audit.data?.entries || []).filter((e) => e.entityId === id).map((e) => e.action);
  check("the resolution entered the audit chain", actions.includes("COMPLAINT_RESOLVED"));
  check("the status move entered the audit chain", actions.includes("COMPLAINT_STATUS_CHANGED"));
  check("the rating entered the audit chain", actions.includes("FEEDBACK_SUBMITTED"));
  check("the chain still verifies", audit.data?.chain?.intact === true);

  const second = await call("POST", "/api/complaints", {
    as: "student",
    body: { title: "Washroom tap leaking", description: "Water keeps leaking from the washroom tap on the second floor.", category: "WATER", buildingCode: "HST-B" }
  });
  const learn = await call("GET", `/api/complaints/${second.data?.complaint?.id}/resolution-suggestions`, { as: "admin" });
  check("resolution learning answers", learn.status === 200);
  check("the resolved complaint is offered as a precedent", (learn.data?.learning?.precedents || []).some((p) => p.id === id));
  checkProvenance("resolution suggestion", learn.data?.suggestion);
  check("a student cannot read resolution suggestions", (await call("GET", `/api/complaints/${id}/resolution-suggestions`, { as: "student" })).status === 403);

  const feedback = await call("GET", "/api/ai/feedback", { as: "admin" });
  check("feedback intelligence answers", feedback.status === 200);
  check("it counts the rating just left", feedback.data?.analysis?.available && feedback.data.analysis.recent.some((r) => r.id === id));
  checkProvenance("feedback analysis", feedback.data?.narrated);

  // ---- copilot --------------------------------------------------------------
  console.log("\ncopilot · new intents");
  const q1 = await call("POST", "/api/ai/copilot", { as: "admin", body: { question: "Which complaints may breach their SLA?" } });
  check("an SLA question maps to SLA_RISK", q1.data?.intent === "SLA_RISK");
  const q2 = await call("POST", "/api/ai/copilot", { as: "admin", body: { question: "What does student feedback say?" } });
  check("a feedback question maps to FEEDBACK", q2.data?.intent === "FEEDBACK");

  // ---- summary ------------------------------------------------------------
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFailed:");
    for (const name of failures) console.log(`  - ${name}`);
    process.exit(1);
  }
  console.log("\nOperational intelligence smoke test passed.");
}

main().catch((error) => {
  console.error("\nSmoke run could not complete:", error.message);
  console.error("Is the API running? cd backend && npm run seed:fresh && npm run dev");
  process.exit(1);
});
