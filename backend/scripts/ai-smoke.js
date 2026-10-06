/**
 * End-to-end smoke test for the AI layer, against a running API and a seeded
 * database.
 *
 *   cd backend && npm run seed:fresh && npm run dev   # terminal 1
 *   cd backend && npm run smoke:ai                    # terminal 2
 *
 * Walks every AI surface: status, classification on a real submission, the
 * safety-rule escalation path, duplicate detection, the routing accept and
 * override, recurring detection, the campus summary, anomalies, predictions,
 * the admin copilot, the audit chain and its verification, the gate-pass risk
 * board, the universal timeline, graded notifications, and the authorisation
 * boundary between a student and staff.
 *
 * Designed to pass with or without an AI provider configured: it asserts that
 * every response names its source honestly, not that a model answered.
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
  console.log(`AI smoke against ${BASE}\n`);

  // ---- sign in ------------------------------------------------------------
  console.log("auth");
  const student = await call("POST", "/api/auth/login", {
    body: { email: env.demo.studentEmail, password: env.demo.studentPassword }
  });
  check("student signs in", student.status === 200 && student.data?.token, `status ${student.status}`);
  tokens.student = student.data?.token;

  const admin = await call("POST", "/api/auth/login", {
    body: { email: env.demo.adminEmail, password: env.demo.adminPassword }
  });
  check("admin signs in", admin.status === 200 && admin.data?.token, `status ${admin.status}`);
  tokens.admin = admin.data?.token;

  if (!tokens.student || !tokens.admin) {
    console.log("\nCannot continue without both accounts. Run `npm run seed:fresh` first.");
    process.exit(1);
  }

  // ---- AI status ----------------------------------------------------------
  console.log("\nai status");
  const status = await call("GET", "/api/ai/status", { as: "student" });
  check("status is readable by any signed-in user", status.status === 200);
  check("status says whether a provider is configured", typeof status.data?.configured === "boolean");
  check("status never carries a key", !JSON.stringify(status.data).toLowerCase().includes("apikey"));
  check("status names its fallback", status.data?.fallback === "DETERMINISTIC_SERVICES");
  const configured = status.data?.configured;
  console.log(`       (AI provider ${configured ? `configured: ${status.data.provider}/${status.data.model}` : "NOT configured — the deterministic path is under test)"}`);

  check("unauthenticated requests are refused", (await call("GET", "/api/ai/status")).status === 401);

  // ---- Feature 1: classification on a real submission ---------------------
  console.log("\nfeature 1 · complaint classification");
  const filed = await call("POST", "/api/complaints", {
    as: "student",
    body: {
      title: "Water leaking from the hostel bathroom",
      description: "Water is leaking continuously from the hostel bathroom on the second floor since morning.",
      category: "WATER",
      location: "HOSTEL B · FLOOR 2"
    }
  });
  check("a complaint can be filed", filed.status === 201, `status ${filed.status}`);
  const complaint = filed.data?.complaint;
  const ai = filed.data?.ai;
  checkProvenance("classification", ai);
  check("classification returns a category", Boolean(ai?.category));
  check("classification returns a priority", Boolean(ai?.priority));
  check("classification returns a department", Boolean(ai?.department));
  check("classification explains itself", Array.isArray(ai?.reasons) && ai.reasons.length > 0);
  check("classification states what its confidence rests on", Boolean(ai?.confidenceBasis));
  check("the classification is persisted on the complaint", Boolean(complaint?.aiClassification?.category));
  check("the stored classification records its source", VALID_SOURCES.includes(complaint?.aiClassification?.source));

  // ---- Feature 6: the safety rule, which must not need a model ------------
  console.log("\nfeature 6 · deterministic safety escalation");
  const hazard = await call("POST", "/api/complaints", {
    as: "student",
    body: {
      title: "Sparks from the distribution board",
      description: "Electrical sparks are coming from the distribution board outside the common room.",
      category: "ELECTRICITY",
      location: "HOSTEL B · GROUND FLOOR"
    }
  });
  check("a hazard complaint is accepted", hazard.status === 201);
  check("a safety rule forces CRITICAL", hazard.data?.escalation?.priority === "CRITICAL", `got ${hazard.data?.escalation?.priority}`);
  check("the safety rule is named as a rule, not as AI", hazard.data?.escalation?.rule === "SAFETY_RULE");
  check("the escalation says it escalates", hazard.data?.escalation?.escalate === true);
  check("the escalation explains which wording triggered it", /spark/i.test(hazard.data?.escalation?.reasons?.[0] || ""));

  // ---- Feature 3: duplicate detection -------------------------------------
  console.log("\nfeature 3 · duplicate detection");
  const near = await call("POST", "/api/complaints", {
    as: "student",
    body: {
      title: "Bathroom water leak continues",
      description: "The bathroom on the second floor is still leaking water continuously since this morning.",
      category: "WATER",
      location: "HOSTEL B · FLOOR 2"
    }
  });
  check("a similar complaint is accepted, never rejected as a duplicate", near.status === 201);
  const dupes = await call("GET", `/api/complaints/${near.data?.complaint?.id}/duplicates`, { as: "admin" });
  check("duplicates are readable", dupes.status === 200);
  checkProvenance("duplicate detection", dupes.data?.duplicate);
  check("a similarity figure is returned", typeof dupes.data?.duplicate?.similarity === "number");
  check("the similarity says what it is based on", Boolean(dupes.data?.duplicate?.similarityBasis || dupes.data?.duplicate?.keywordMethod));
  check("candidates come with their references", Array.isArray(dupes.data?.duplicate?.candidates));

  const review = await call("POST", `/api/complaints/${near.data?.complaint?.id}/duplicate-review`, {
    as: "admin",
    body: { decision: "SEPARATE", note: "Different floor riser" }
  });
  check("an admin can mark two complaints separate", review.status === 200);
  check("nothing was deleted by that decision", (await call("GET", `/api/complaints/${near.data?.complaint?.id}`, { as: "admin" })).status === 200);

  // ---- Feature 2: routing, accepted and overridden ------------------------
  console.log("\nfeature 2 · routing with a human in the loop");
  const accepted = await call("PATCH", `/api/complaints/${complaint?.id}/routing`, { as: "admin", body: {} });
  check("an admin can accept the recommendation", accepted.status === 200, `status ${accepted.status}`);
  check("the decision is recorded as ACCEPTED", accepted.data?.routing?.decision === "ACCEPTED");
  check("the person who decided is recorded", Boolean(accepted.data?.routing?.decidedByName));
  check("the timestamp is recorded", Boolean(accepted.data?.routing?.decidedAt));

  const overridden = await call("PATCH", `/api/complaints/${complaint?.id}/routing`, {
    as: "admin",
    body: { department: "GENERAL ADMINISTRATION", note: "Handled centrally this week" }
  });
  check("an admin can override the recommendation", overridden.status === 200);
  check("the override is recorded as MODIFIED", overridden.data?.routing?.decision === "MODIFIED");
  check(
    "the original recommendation survives the override",
    Boolean(overridden.data?.routing?.recommendedDepartment) &&
      overridden.data?.routing?.recommendedDepartment !== overridden.data?.routing?.finalDepartment
  );

  check(
    "a student cannot change routing",
    (await call("PATCH", `/api/complaints/${complaint?.id}/routing`, { as: "student", body: {} })).status === 403
  );

  // ---- Feature 4 + 5: recurrence and root cause ---------------------------
  console.log("\nfeatures 4 and 5 · recurring problems and root cause");
  const recurring = await call("GET", "/api/ai/recurring", { as: "admin" });
  check("recurring detection is readable by staff", recurring.status === 200);
  check("recurrence reports how many complaints it examined", typeof recurring.data?.complaintsExamined === "number");
  check("recurrence is labelled as a database aggregation", recurring.data?.method === "DATABASE_AGGREGATION");
  check("every pattern carries counted evidence", (recurring.data?.patterns || []).every((p) => Array.isArray(p.evidence) && p.evidence.length));
  check("a student cannot read campus-wide recurrence", (await call("GET", "/api/ai/recurring", { as: "student" })).status === 403);

  const pattern = recurring.data?.patterns?.[0];
  if (pattern) {
    const rootCause = await call("GET", `/api/ai/root-cause/${encodeURIComponent(pattern.building.code)}/${encodeURIComponent(pattern.category)}`, { as: "admin" });
    check("root cause is readable for a detected pattern", rootCause.status === 200, `status ${rootCause.status}`);
    checkProvenance("root cause", rootCause.data?.analysis);
    check("root cause is labelled as AI-generated analysis", rootCause.data?.analysis?.label === "AI-GENERATED ANALYSIS");
    check("root cause carries a caveat", Boolean(rootCause.data?.analysis?.caveat));
    check("root cause ships the complaints behind it", Array.isArray(rootCause.data?.supportingComplaints));
  } else {
    console.log("       (no recurring pattern in the seeded window — root cause not exercised)");
    const missing = await call("GET", "/api/ai/root-cause/HST-B/WATER", { as: "admin" });
    check("root cause refuses a pattern that does not exist", missing.status === 404);
  }

  // ---- Feature 10: the campus summary -------------------------------------
  console.log("\nfeature 10 · campus summary");
  const summary = await call("GET", "/api/ai/summary", { as: "admin" });
  check("the summary is readable by staff", summary.status === 200);
  checkProvenance("summary", summary.data?.summary);
  check("the summary carries counted facts", Boolean(summary.data?.summary?.facts?.counts));
  check("the counts are numbers from the database", typeof summary.data?.summary?.facts?.counts?.pendingComplaints === "number");
  check("the summary has bullets", (summary.data?.summary?.bullets || []).length > 0);
  check("a student cannot read the campus summary", (await call("GET", "/api/ai/summary", { as: "student" })).status === 403);

  // ---- Feature 11: anomalies ----------------------------------------------
  console.log("\nfeature 11 · anomaly detection");
  const anomalies = await call("GET", "/api/ai/anomalies", { as: "admin" });
  check("anomalies are readable by staff", anomalies.status === 200);
  check("anomaly detection is labelled statistical, not model-driven", anomalies.data?.method === "STATISTICAL_BASELINE");
  check("anomaly detection states its threshold rule", /z-score/i.test(anomalies.data?.disclaimer || ""));
  check(
    "a quiet campus reports zero findings rather than inventing one",
    Array.isArray(anomalies.data?.findings) && (anomalies.data.findings.length > 0 || Boolean(anomalies.data.note))
  );
  check("every finding carries the numbers behind it", (anomalies.data?.findings || []).every((f) => typeof f.baselineMedian === "number" && typeof f.current === "number"));

  // ---- Feature 8: predictions ---------------------------------------------
  console.log("\nfeature 8 · demand prediction");
  const predictions = await call("GET", "/api/ai/predictions", { as: "admin" });
  check("predictions are readable by staff", predictions.status === 200);
  const prediction = predictions.data?.prediction;
  check("the prediction says whether it is available at all", typeof prediction?.available === "boolean");
  if (prediction?.available) {
    check("an available forecast carries a range", Boolean(prediction.forecast?.range));
    check("the forecast is labelled an estimate", predictions.data?.narrated?.label === "ESTIMATE");
    check("the forecast names its method", prediction.forecast?.method === "STATISTICAL_BASELINE");
  } else {
    check("an unavailable forecast says why", (prediction?.sufficiency?.reasons || []).length > 0);
    check("an unavailable forecast shows no number", predictions.data?.narrated?.available === false);
  }

  // ---- Feature 9: the admin copilot ---------------------------------------
  console.log("\nfeature 9 · admin copilot");
  for (const question of [
    "How many unresolved complaints are there?",
    "Which hostel has the most complaints?",
    "Which department has the largest pending workload?",
    "Are there recurring problems?"
  ]) {
    const answer = await call("POST", "/api/ai/copilot", { as: "admin", body: { question } });
    check(`copilot answers: "${question}"`, answer.status === 200, `status ${answer.status}`);
    check(`  · the intent is named`, Boolean(answer.data?.intent));
    check(`  · the answer ships the facts it used`, Array.isArray(answer.data?.answer?.facts) && answer.data.answer.facts.length > 0);
    check(`  · the answer ships the records behind it`, Boolean(answer.data?.answer?.records));
    checkProvenance(`  · copilot`, answer.data?.answer);
  }

  const unknown = await call("POST", "/api/ai/copilot", { as: "admin", body: { question: "what is the weather on mars" } });
  check("an unrecognised question is admitted, not guessed at", unknown.data?.recognised === false);

  check("a student cannot use the copilot", (await call("POST", "/api/ai/copilot", { as: "student", body: { question: "how many complaints" } })).status === 403);
  check("the copilot rejects an empty question", (await call("POST", "/api/ai/copilot", { as: "admin", body: {} })).status === 400);

  // ---- Feature 14: the audit chain ----------------------------------------
  console.log("\nfeature 14 · tamper-evident audit history");
  const audit = await call("GET", "/api/ai/audit?limit=25", { as: "admin" });
  check("the audit chain is readable by an admin", audit.status === 200);
  check("the chain verifies", audit.data?.chain?.intact === true, audit.data?.chain?.detail);
  check("the chain is labelled a hash chain, not a blockchain", audit.data?.method === "SHA256_HASH_CHAIN" && /not a blockchain/i.test(audit.data?.disclaimer || ""));
  check("the routing override was recorded", (audit.data?.entries || []).some((e) => e.action === "ROUTING_OVERRIDDEN"));
  check("audit entries record the previous and the new value", (audit.data?.entries || []).every((e) => "previousValue" in e && "newValue" in e));
  check("audit entries record who acted", (audit.data?.entries || []).every((e) => Boolean(e.actorName)));
  check("a student cannot read the audit chain", (await call("GET", "/api/ai/audit", { as: "student" })).status === 403);

  // ---- Feature 13: the universal timeline ---------------------------------
  console.log("\nfeature 13 · universal request timeline");
  const timeline = await call("GET", `/api/ai/timeline/complaint/${complaint?.id}`, { as: "student" });
  check("a student can read their own complaint's timeline", timeline.status === 200);
  check("the timeline has stages", (timeline.data?.timeline?.stages || []).length > 0);
  check("the first stage is submission and it is done", timeline.data?.timeline?.stages?.[0]?.state === "DONE");
  check("the timeline is derived from the stored record", timeline.data?.timeline?.method === "DERIVED_FROM_STORED_RECORD");
  check("an unknown timeline kind is rejected", (await call("GET", `/api/ai/timeline/banana/${complaint?.id}`, { as: "admin" })).status === 400);

  // ---- Feature 7: graded notifications ------------------------------------
  console.log("\nfeature 7 · notification priority");
  const notifications = await call("GET", "/api/ai/notifications", { as: "admin" });
  check("notifications are readable", notifications.status === 200);
  check("notifications are graded", (notifications.data?.notifications || []).every((n) => Boolean(n.priority)));
  check("each priority says where it came from", (notifications.data?.notifications || []).every((n) => Boolean(n.prioritySource)));
  check(
    "the hazard complaint raised a CRITICAL alert",
    (notifications.data?.notifications || []).some((n) => n.kind === "COMPLAINT_ESCALATED" && n.priority === "CRITICAL"),
    "no CRITICAL escalation notification found"
  );

  // ---- Feature 16: gate-pass risk -----------------------------------------
  console.log("\nfeature 16 · gate pass risk signals");
  const risk = await call("GET", "/api/ai/gatepass-risk", { as: "admin" });
  check("the risk board is readable by an admin", risk.status === 200);
  check("the board says how much it examined", typeof risk.data?.passesExamined === "number");
  check("the board states that it takes no action", /no automatic action/i.test(risk.data?.disclaimer || ""));
  check("every listed student comes with their records", (risk.data?.rows || []).every((row) => Array.isArray(row.records)));
  check("a student cannot read the risk board", (await call("GET", "/api/ai/gatepass-risk", { as: "student" })).status === 403);

  // ---- Feature 12: low-bandwidth behaviour --------------------------------
  console.log("\nfeature 12 · low-bandwidth behaviour");
  const lite = await call("GET", "/api/ai/recurring?lite=1", { as: "admin" });
  check("a lite response is served", lite.status === 200);
  check("a lite response declares that it is trimmed", lite.body?.lite === true && Boolean(lite.body?.liteNote));
  const full = await call("GET", "/api/ai/recurring", { as: "admin" });
  check("the full response is not trimmed", !full.body?.lite);
  check(
    "a lite response is no larger than the full one",
    JSON.stringify(lite.body).length <= JSON.stringify(full.body).length
  );
  check("slow-moving reads are cacheable", /max-age=\d+/.test(full.headers.get("cache-control") || ""));
  check("the audit chain is never cached", (await call("GET", "/api/ai/audit", { as: "admin" })).headers.get("cache-control") === "no-store");

  // ---- existing functionality, unchanged ----------------------------------
  console.log("\nregression · the application this extends");
  check("health still responds", (await call("GET", "/health")).status === 200);
  check("the campus map still loads without an account", (await call("GET", "/api/campus")).status === 200);
  check("the student dashboard still loads", (await call("GET", "/api/students/me/dashboard", { as: "student" })).status === 200);
  check("attendance still loads", (await call("GET", "/api/attendance/me", { as: "student" })).status === 200);
  check("mission control still loads", (await call("GET", "/api/admin/overview", { as: "admin" })).status === 200);
  check("the original briefing endpoint still works", (await call("GET", "/api/admin/briefing", { as: "admin" })).status === 200);
  check("the original intelligence query still works", (await call("POST", "/api/intelligence/query", { body: { question: "What are the biggest problems on campus today?" } })).status === 200);
  check("gate pass config still loads", (await call("GET", "/api/gatepass/config", { as: "student" })).status === 200);
  check("gate pass notifications still load", (await call("GET", "/api/gatepass/notifications", { as: "student" })).status === 200);
  check("incidents still load", (await call("GET", "/api/incidents")).status === 200);
  check("interventions still load", (await call("GET", "/api/interventions")).status === 200);

  // ---- summary ------------------------------------------------------------
  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFailed:");
    for (const name of failures) console.log(`  - ${name}`);
    process.exit(1);
  }
  console.log("\nAI layer smoke test passed.");
}

main().catch((error) => {
  console.error("\nSmoke run could not complete:", error.message);
  console.error("Is the API running? cd backend && npm run seed:fresh && npm run dev");
  process.exit(1);
});
