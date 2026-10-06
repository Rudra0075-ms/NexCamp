/**
 * End-to-end smoke test against a running API and a seeded database.
 *
 *   cd backend && npm run seed:fresh && npm run dev   # terminal 1
 *   cd backend && npm run smoke                       # terminal 2
 *
 * Walks the whole demo pipeline: sign in, read the campus, submit a complaint,
 * watch it get classified and clustered, pull the investigation and the memory
 * match, simulate attendance and interventions, record a human decision, and
 * read mission control. Exits non-zero on the first broken expectation.
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
    /* empty body */
  }
  return { status: res.status, body: json };
}

async function main() {
  console.log(`Smoke testing ${BASE}\n`);

  console.log("health");
  let res = await call("GET", "/health");
  check("health responds", res.status === 200, `status ${res.status}`);
  check("database connected", res.body?.data?.database === "connected", res.body?.data?.database);
  if (res.body?.data?.database !== "connected") {
    console.log("\nThe API is up but MongoDB is not connected — check MONGO_URI.");
    process.exit(1);
  }

  console.log("\nauth");
  res = await call("POST", "/api/auth/login", {
    body: { email: env.demo.studentEmail, password: env.demo.studentPassword }
  });
  check("student signs in", res.status === 200, JSON.stringify(res.body));
  tokens.student = res.body?.data?.token;
  check("student token issued", Boolean(tokens.student));
  check("password never returned", !JSON.stringify(res.body).includes("password"));

  res = await call("POST", "/api/auth/login", {
    body: { email: env.demo.adminEmail, password: env.demo.adminPassword }
  });
  check("admin signs in", res.status === 200, JSON.stringify(res.body));
  tokens.admin = res.body?.data?.token;

  res = await call("POST", "/api/auth/login", {
    body: { email: env.demo.studentEmail, password: "wrong-password-1" }
  });
  check("wrong password rejected", res.status === 401, `status ${res.status}`);

  res = await call("GET", "/api/auth/me", { as: "student" });
  check("current user returned", res.body?.data?.user?.role === "STUDENT", JSON.stringify(res.body?.data?.user));

  console.log("\nauthorization");
  res = await call("GET", "/api/admin/overview", { as: "student" });
  check("student blocked from mission control", res.status === 403, `status ${res.status}`);
  res = await call("GET", "/api/admin/overview", { as: "admin" });
  check("admin allowed into mission control", res.status === 200, `status ${res.status}`);

  console.log("\ncampus");
  res = await call("GET", "/api/campus");
  const campus = res.body?.data;
  check("campus loads", res.status === 200 && campus?.buildings?.length > 0, `status ${res.status}`);
  check("campus health computed", typeof campus?.campus?.health === "number", campus?.campus?.health);
  check("buildings carry risk", campus.buildings.every((b) => typeof b.currentRisk === "number"));
  const hostelB = campus.buildings.find((b) => b.code === "HST-B");
  check("Hostel B is the hot block", hostelB && hostelB.currentRisk >= 60, hostelB?.currentRisk);

  console.log("\nstudent dashboard");
  res = await call("GET", "/api/students/me/dashboard", { as: "student" });
  const dash = res.body?.data;
  check("dashboard loads", res.status === 200, `status ${res.status}`);
  check("attendance present", typeof dash?.attendance?.overall === "number", dash?.attendance?.overall);
  check("alerts carry provenance", dash.alerts.every((a) => Boolean(a.kind)));

  console.log("\nattendance simulation");
  res = await call("POST", "/api/attendance/simulate", {
    as: "student",
    body: { attendedClasses: 33, totalClasses: 46, plannedClasses: 6 }
  });
  check("simulation is real arithmetic", res.body?.data?.projected === 75, res.body?.data?.projected);
  check("simulation explains itself", Boolean(res.body?.data?.explanation), res.body?.data?.explanation);

  console.log("\ncomplaint -> classification -> clustering");
  res = await call("POST", "/api/complaints", {
    as: "student",
    body: {
      title: "No water in bathroom again",
      description: "There is no water in the bathroom on the second floor since morning.",
      category: "WATER",
      buildingCode: "HST-B",
      location: "HOSTEL B · FLOOR 2"
    }
  });
  const submitted = res.body?.data;
  check("complaint accepted", res.status === 201, JSON.stringify(res.body));
  check("complaint classified as WATER", submitted?.classification?.category === "WATER", submitted?.classification?.category);
  check("classification is labelled rule-based", submitted?.classification?.method === "RULE_BASED_KEYWORD_MATCH");
  check("duplicates detected", submitted?.classification?.duplicateProbability > 0, submitted?.classification?.duplicateProbability);
  check("routed to plumbing", submitted?.classification?.routedTo === "MAINTENANCE · PLUMBING", submitted?.classification?.routedTo);
  check("folded into an incident", Boolean(submitted?.incident), JSON.stringify(submitted?.incident));
  check("audit trail recorded", submitted?.complaint?.audit?.length >= 2, submitted?.complaint?.audit?.length);

  const complaintId = submitted?.complaint?.id;
  res = await call("GET", `/api/complaints/${complaintId}`, { as: "student" });
  check("student can read their complaint", res.status === 200, `status ${res.status}`);

  console.log("\nincidents");
  res = await call("GET", "/api/incidents?open=true");
  const incidents = res.body?.data?.incidents || [];
  check("incidents list", incidents.length > 0, `${incidents.length} incidents`);
  const water = incidents.find((i) => i.category === "WATER") || incidents[0];
  check("water incident has a cluster", water.complaintCount >= 5, water.complaintCount);

  res = await call("POST", "/api/incidents/cluster", { body: { buildingCode: "HST-B", windowDays: 30 } });
  const clustering = res.body?.data;
  check("clustering runs", res.status === 200 && clustering?.clusters?.length > 0, `status ${res.status}`);
  check("clustering is labelled deterministic", clustering?.method === "DETERMINISTIC_KEYWORD_AND_LOCATION_MATCH");
  check("cluster is smaller than its input", clustering.clusters[0].complaintCount <= clustering.inputComplaints);

  console.log("\ninvestigation and memory");
  res = await call("GET", `/api/incidents/${water.id}/investigation`);
  const investigation = res.body?.data;
  check("investigation loads", res.status === 200, `status ${res.status}`);
  check("confidence is a number", typeof investigation?.confidence === "number", investigation?.confidence);
  check("confidence breakdown sums to confidence",
    Math.abs(investigation.confidenceBreakdown.reduce((t, r) => t + r.weight, 0) - investigation.confidence) < 1.5,
    `${investigation.confidenceBreakdown.reduce((t, r) => t + r.weight, 0)} vs ${investigation.confidence}`);
  check("evidence returned", investigation.evidence.length > 0);
  check("possible causes returned", investigation.possibleCauses.length > 0);

  res = await call("GET", `/api/incidents/${water.id}/memory-match`);
  const match = res.body?.data;
  check("memory match loads", res.status === 200, `status ${res.status}`);
  check("a historical incident matched", Boolean(match?.matchedIncident), JSON.stringify(match).slice(0, 120));
  check("similarity is a percentage", match.similarity >= 0 && match.similarity <= 100, match.similarity);
  check("matching factors explained", match.matchingFactors.length > 0);

  console.log("\nrisk and silent problems");
  res = await call("GET", "/api/risk");
  check("risk centre loads", res.status === 200 && res.body?.data?.domains?.length > 0, `status ${res.status}`);
  res = await call("GET", "/api/risk/anomalies");
  const anomalies = res.body?.data;
  check("anomalies detected", anomalies?.anomalies?.length > 0, anomalies?.anomalies?.length);
  check("anomalies labelled rule-based", anomalies?.method === "RULE_BASED_THRESHOLD");
  check("a silent problem exists", anomalies.silent.length > 0, `${anomalies.silent.length} silent`);

  console.log("\nmess");
  res = await call("GET", "/api/mess/demand");
  const mess = res.body?.data;
  check("demand curve loads", res.status === 200 && mess?.slots?.length > 0, `status ${res.status}`);
  check("peak identified", Boolean(mess?.peak), JSON.stringify(mess?.peak));
  check("stagger recommendation lowers the peak", mess.recommendation.peakAfter < mess.recommendation.peakBefore);

  console.log("\nintervention what-if");
  res = await call("POST", "/api/interventions/simulate", { body: { incident: water.id } });
  const sim = res.body?.data;
  check("simulation loads", res.status === 200 && sim?.scenarios?.length === 3, `status ${res.status}`);
  const nothing = sim.scenarios.find((s) => s.scenario === "DO_NOTHING");
  const repair = sim.scenarios.find((s) => s.scenario === "REPAIR_NOW");
  check("doing nothing is worse than repairing", nothing.riskAfter > repair.riskAfter, `${nothing.riskAfter} vs ${repair.riskAfter}`);
  check("simulation is labelled a projection", sim.scenarios[0].method === "ARITHMETIC_PROJECTION");

  console.log("\nAI -> human decision");
  res = await call("GET", "/api/interventions?pending=true");
  let intervention = res.body?.data?.interventions?.[0];
  if (!intervention) {
    res = await call("POST", "/api/interventions", { as: "admin", body: { incident: water.id } });
    intervention = res.body?.data?.intervention;
    check("intervention created", res.status === 201, JSON.stringify(res.body).slice(0, 160));
  } else {
    check("a recommendation is waiting for a human", intervention.status === "RECOMMENDED", intervention.status);
  }

  res = await call("POST", `/api/interventions/${intervention.id}/decision`, {
    as: "student",
    body: { decision: "ACCEPT" }
  });
  check("students cannot decide", res.status === 403, `status ${res.status}`);

  res = await call("POST", `/api/interventions/${intervention.id}/decision`, {
    as: "admin",
    body: { decision: "REJECT" }
  });
  check("a rejection without a reason is refused", res.status === 400, `status ${res.status}`);

  res = await call("POST", `/api/interventions/${intervention.id}/decision`, {
    as: "admin",
    body: { decision: "ACCEPT" }
  });
  const decided = res.body?.data;
  check("admin accepts the recommendation", res.status === 200, JSON.stringify(res.body).slice(0, 160));
  check("decision recorded against a person", decided?.decision?.byName, JSON.stringify(decided?.decision));
  check("decision chain returned", decided?.chain?.length === 4, JSON.stringify(decided?.chain));

  res = await call("POST", `/api/interventions/${intervention.id}/decision`, {
    as: "admin",
    body: { decision: "REJECT", reason: "Changed my mind" }
  });
  check("a decided intervention cannot be re-decided", res.status === 409, `status ${res.status}`);

  console.log("\nnatural-language query");
  res = await call("POST", "/api/intelligence/query", { body: { question: "Why is Hostel B attendance falling?" } });
  const query = res.body?.data;
  check("query answered", res.status === 200 && query?.chain?.length > 0, JSON.stringify(res.body).slice(0, 160));
  check("query is labelled rule-based", query?.method === "RULE_BASED_INTENT_MATCH");

  res = await call("GET", "/api/intelligence/relationships");
  check("cross-domain graph loads", res.body?.data?.edges?.length > 0, res.body?.data?.edges?.length);

  console.log("\nmission control");
  res = await call("GET", "/api/admin/action-queue", { as: "admin" });
  const queue = res.body?.data?.queue || [];
  check("action queue loads", queue.length > 0, `${queue.length} rows`);
  check("queue is ranked", queue.every((row, i) => i === 0 || queue[i - 1].score >= row.score));

  res = await call("GET", "/api/admin/briefing", { as: "admin" });
  const briefing = res.body?.data;
  check("briefing loads", res.status === 200 && briefing?.lines?.length > 0, `status ${res.status}`);
  check("every briefing line is labelled", briefing.lines.every((line) =>
    ["ACTUAL DATA", "AI PREDICTION", "AI RECOMMENDATION", "EVIDENCE"].includes(line.kind)));

  console.log("\njudge demo");
  res = await call("GET", "/api/demo/incident-story");
  const story = res.body?.data;
  check("story loads", res.status === 200 && story?.steps?.length === 10, story?.steps?.length);
  check("every step names a page", story.steps.every((step) => Boolean(step.page)));
  check("every step is labelled", story.steps.every((step) =>
    ["ACTUAL DATA", "AI PREDICTION", "AI RECOMMENDATION", "EVIDENCE"].includes(step.kind)));
  check("timeline built", story.timeline.length > 0, story.timeline.length);

  console.log("\ncleanup");
  res = await call("DELETE", `/api/complaints/${complaintId}`, { as: "admin" });
  check("complaint removed", res.status === 200, `status ${res.status}`);

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFailed checks:");
    for (const name of failures) console.log(`  - ${name}`);
    process.exit(1);
  }
  console.log("\nEvery stage of the pipeline works end to end.");
}

main().catch((error) => {
  console.error(`\nSmoke test could not run: ${error.message}`);
  console.error("Is the API running? Start it with `npm run dev` in backend/.");
  process.exit(1);
});
