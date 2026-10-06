/**
 * npm run budgets — measures the four page-21 workflows (and, REEL HOOK, the 30-second proof as a fifth) (file a complaint,
 * apply for a gate pass, request a certificate, read a notice) against the
 * real API in a throwaway database, and writes
 * ../frontend/public/workflow-budgets.json for the Device Readiness page.
 * The demo database is never touched.
 */
import { execFile } from "node:child_process"; // REEL HOOK (see CHANGES-REEL.md)
import { promisify } from "node:util"; // REEL HOOK
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import "dotenv/config";

process.env.JWT_SECRET ||= "a-budget-secret-that-is-long-enough-1234";
process.env.GATE_PASS_REVEAL_OTP = "true";
const URI = process.env.BUDGET_MONGO_URI || "mongodb://127.0.0.1:27017/nex_workflow_budget";

const { createApp } = await import("../src/app.js");
const models = { ...(await import("../src/models/index.js")), ...(await import("../src/models/ext/index.js")) };
const { createNotice } = await import("../src/services/ext/noticeService.js");
const { flushEvents } = await import("../src/services/xo/eventService.js");
const budget = await import("./lib/workflowBudgets.js");

await mongoose.connect(URI, { serverSelectionTimeoutMS: 3000 });
await mongoose.connection.dropDatabase();
const server = createApp().listen(0);
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const fx = await budget.budgetFixtures(models, { createNotice });
  const login = await (await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: fx.email, password: fx.password }) })).json();
  const workflows = await budget.measureWorkflows(base, login.data.token);
  // REEL HOOK (see CHANGES-REEL.md): the fifth workflow, the 30-second proof, needs the demo data and a staff
  // account, so this throwaway database is re-seeded with the real seed script and measured as the admin.
  await promisify(execFile)(process.execPath, ["src/seed/index.js", "--fresh"], { cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), env: { ...process.env, MONGO_URI: URI }, timeout: 180000 }); // REEL HOOK
  const staff = await (await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "control@bput.ac.in", password: "Control@2026" }) })).json(); // REEL HOOK
  workflows.push(...(await budget.measureWorkflows(base, staff.data.token, [budget.REEL_WORKFLOW]))); // REEL HOOK
  const report = { generatedAt: new Date().toISOString(), network: budget.NETWORK, assumptions: budget.ASSUMPTIONS, workflows, method: "MEASURED_BYTES_SIMULATED_2G", kind: "SIMULATED" };
  const target = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/public/workflow-budgets.json");
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
  for (const w of workflows) console.log(`${w.label.padEnd(24)} ${String(w.requests).padStart(2)} calls ${(w.bytes / 1024).toFixed(1).padStart(6)} KB  ~${w.seconds2g}s on 2G  budget ${(w.budget / 1024).toFixed(0)} KB ${w.withinBudget ? "OK" : "OVER"}`);
  console.log(`Wrote ${target}`);
  if (workflows.some((w) => !w.withinBudget)) process.exitCode = 1;
} finally {
  await flushEvents();
  server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}
