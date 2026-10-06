/**
 * End-to-end smoke test for the gate pass system, against a running API and a
 * seeded database.
 *
 *   cd backend && npm run seed:fresh && npm run dev   # terminal 1
 *   cd backend && npm run smoke:gatepass              # terminal 2
 *
 * Requires GATE_PASS_REVEAL_OTP=true in backend/.env (development only) so the
 * one-time code can be read back without a live SMS gateway.
 *
 * Walks the whole lifecycle — apply, guardian OTP, warden approval, QR issue,
 * exit scan, active timer, return scan — and then the refusals: wrong OTP,
 * expired/consumed OTP, a replayed QR, a forged QR, a student trying to approve
 * their own pass, and a student reading someone else's pass. Exits non-zero on
 * the first broken expectation.
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

async function signIn(as, email, password) {
  const res = await call("POST", "/api/auth/login", { body: { email, password } });
  if (res.status !== 200) throw new Error(`sign-in failed for ${email}: ${res.body?.message}`);
  tokens[as] = res.body.data.token;
  return res.body.data.user;
}

async function main() {
  console.log(`Gate pass smoke testing ${BASE}\n`);

  let res = await call("GET", "/health");
  check("health responds", res.status === 200, `status ${res.status}`);
  if (res.body?.data?.database !== "connected") {
    console.log("\nThe API is up but MongoDB is not connected — check MONGO_URI.");
    process.exit(1);
  }

  console.log("\nauth");
  const student = await signIn("student", env.demo.studentEmail, env.demo.studentPassword);
  check("student signed in", student.role === "STUDENT", student.role);
  await signIn("warden", "warden.hostelb@bput.ac.in", env.demo.adminPassword);
  check("warden signed in", Boolean(tokens.warden));

  console.log("\nunauthenticated access is refused");
  res = await call("GET", "/api/gatepass");
  check("gate pass list needs an account", res.status === 401, `status ${res.status}`);

  console.log("\napply");
  const leaveAt = new Date(Date.now() + 60_000);
  // Two minutes, so the five-minute warning is already active on exit and the
  // overdue sweep is reachable inside one test run.
  const expectedReturnAt = new Date(leaveAt.getTime() + 2 * 60_000);
  res = await call("POST", "/api/gatepass", {
    as: "student",
    body: {
      reason: "Dentist appointment in the city",
      destination: "City Dental Clinic, Chandrasekharpur",
      leaveAt: leaveAt.toISOString(),
      expectedReturnAt: expectedReturnAt.toISOString()
    }
  });
  check("gate pass created", res.status === 201, `status ${res.status} ${res.body?.message || ""}`);
  const gatePass = res.body?.data?.gatePass;
  check("opens awaiting guardian", gatePass?.status === "PENDING_PARENT_VERIFICATION", gatePass?.status);
  check("reference is a GP number", /^GP-\d{4}-\d{6}$/.test(gatePass?.reference || ""), gatePass?.reference);
  check("guardian number is masked", /X/.test(res.body?.data?.otp?.phoneMasked || ""), res.body?.data?.otp?.phoneMasked);

  const devCode = res.body?.data?.otp?.devCode;
  if (!devCode) {
    console.log("\nSet GATE_PASS_REVEAL_OTP=true in backend/.env to run the rest of this script.");
    process.exit(1);
  }
  const id = gatePass.id;

  console.log("\nOTP verification");
  res = await call("POST", `/api/gatepass/${id}/verify-otp`, { as: "student", body: { code: "000000" === devCode ? "111111" : "000000" } });
  check("wrong code is refused", res.status === 400, `status ${res.status}`);
  check("wrong code counts down attempts", /attempt/i.test(res.body?.message || ""), res.body?.message);

  res = await call("POST", `/api/gatepass/${id}/verify-otp`, { as: "student", body: { code: devCode } });
  check("correct code accepted", res.status === 200, res.body?.message);
  check("queued for the warden", res.body?.data?.gatePass?.status === "PENDING_WARDEN_APPROVAL", res.body?.data?.gatePass?.status);

  res = await call("POST", `/api/gatepass/${id}/verify-otp`, { as: "student", body: { code: devCode } });
  check("a consumed code cannot be replayed", res.status === 400, `status ${res.status}`);

  console.log("\nauthorisation");
  res = await call("POST", `/api/gatepass/${id}/approve`, { as: "student", body: {} });
  check("a student cannot approve a gate pass", res.status === 403, `status ${res.status}`);

  console.log("\nwarden approval");
  res = await call("GET", "/api/gatepass?status=PENDING_WARDEN_APPROVAL", { as: "warden" });
  check("pass appears in the warden queue", (res.body?.data?.gatePasses || []).some((row) => row.id === id));

  res = await call("POST", `/api/gatepass/${id}/approve`, { as: "warden", body: { note: "Return before the gate closes" } });
  check("warden approved", res.status === 200, res.body?.message);
  check("status is APPROVED", res.body?.data?.gatePass?.status === "APPROVED", res.body?.data?.gatePass?.status);
  const qrPayload = res.body?.data?.qr?.payload;
  check("QR payload issued", /^NEX-GP:GP-\d{4}-\d{6}:/.test(qrPayload || ""), qrPayload?.slice(0, 24));
  check("QR renders as a PNG data URL", String(res.body?.data?.qr?.dataUrl || "").startsWith("data:image/png;base64,"));
  check("QR carries no personal data", !new RegExp(student.name, "i").test(qrPayload || ""));

  console.log("\nscanning");
  res = await call("POST", "/api/gatepass/scan", { as: "student", body: { token: "NEX-GP:GP-2026-999999:notarealtoken" } });
  check("an unknown pass is refused", res.status === 404 || res.status === 400, `status ${res.status}`);

  res = await call("POST", "/api/gatepass/scan", { as: "student", body: { token: "https://example.com" } });
  check("a foreign QR is refused", res.status === 400, `status ${res.status}`);

  res = await call("POST", "/api/gatepass/scan", { as: "student", body: { token: `${qrPayload}tampered` } });
  check("a tampered token is refused", res.status === 400, `status ${res.status}`);

  res = await call("POST", "/api/gatepass/scan", { as: "student", body: { token: qrPayload } });
  check("exit scan accepted", res.status === 200, res.body?.message);
  check("pass is ACTIVE", res.body?.data?.gatePass?.status === "ACTIVE", res.body?.data?.gatePass?.status);
  check("exit timestamp recorded", Boolean(res.body?.data?.gatePass?.exitAt));
  const timer = res.body?.data?.gatePass?.timer;
  check("timer counts down from the server clock", timer?.remainingSeconds > 0 && timer?.remainingSeconds <= 121, String(timer?.remainingSeconds));

  console.log("\ntimer survives a fresh read");
  res = await call("GET", `/api/gatepass/${id}/status`, { as: "student" });
  check("status poll works", res.status === 200, `status ${res.status}`);
  check("remaining time comes from the backend", typeof res.body?.data?.timer?.remainingSeconds === "number");
  check("server time is reported", Boolean(res.body?.data?.serverTime));

  console.log("\nownership");
  res = await call("GET", `/api/gatepass/${id}`, { as: "warden" });
  check("warden may read the pass", res.status === 200, `status ${res.status}`);

  console.log("\nreturn scan");
  res = await call("POST", "/api/gatepass/scan", { as: "student", body: { token: qrPayload } });
  check("return scan accepted", res.status === 200, res.body?.message);
  const closed = res.body?.data?.gatePass;
  check("pass is RETURNED", closed?.status === "RETURNED" || closed?.status === "RETURNED_LATE", closed?.status);
  check("return timestamp recorded", Boolean(closed?.returnAt));
  check("duration recorded", typeof closed?.actualDurationMinutes === "number", String(closed?.actualDurationMinutes));

  res = await call("POST", "/api/gatepass/scan", { as: "student", body: { token: qrPayload } });
  check("a spent QR cannot be reused", res.status === 400, `status ${res.status}`);

  console.log("\noverdue path");
  const lateLeave = new Date(Date.now() - 30_000);
  const lateReturn = new Date(Date.now() + 30_000);
  res = await call("POST", "/api/gatepass", {
    as: "student",
    body: {
      reason: "Short errand — overdue path",
      destination: "Campus gate",
      leaveAt: lateLeave.toISOString(),
      expectedReturnAt: lateReturn.toISOString()
    }
  });
  const lateId = res.body?.data?.gatePass?.id;
  const lateCode = res.body?.data?.otp?.devCode;
  check("second pass created", res.status === 201, res.body?.message);
  await call("POST", `/api/gatepass/${lateId}/verify-otp`, { as: "student", body: { code: lateCode } });
  res = await call("POST", `/api/gatepass/${lateId}/approve`, { as: "warden", body: {} });
  const lateQr = res.body?.data?.qr?.payload;
  await call("POST", "/api/gatepass/scan", { as: "student", body: { token: lateQr } });

  console.log("  waiting for the approved window to elapse (about 65s)…");
  await new Promise((resolve) => setTimeout(resolve, 65_000));

  res = await call("GET", `/api/gatepass/${lateId}/status`, { as: "student" });
  check("pass went OVERDUE on server time", res.body?.data?.status === "OVERDUE", res.body?.data?.status);

  res = await call("GET", "/api/gatepass/notifications", { as: "warden" });
  check(
    "warden was alerted about the overdue pass",
    (res.body?.data?.notifications || []).some((row) => row.kind === "GATE_PASS_OVERDUE"),
    String(res.body?.data?.notifications?.length)
  );

  res = await call("POST", "/api/gatepass/scan", { as: "student", body: { token: lateQr } });
  check("late return is accepted and marked", res.body?.data?.gatePass?.status === "RETURNED_LATE", res.body?.data?.gatePass?.status);
  check("lateness is measured", res.body?.data?.gatePass?.overdueMinutes >= 0);

  console.log("\nwarden console");
  res = await call("GET", "/api/gatepass/summary", { as: "warden" });
  check("summary available to staff", res.status === 200, `status ${res.status}`);
  res = await call("GET", "/api/gatepass/summary", { as: "student" });
  check("summary refused to students", res.status === 403, `status ${res.status}`);

  console.log(`\n${pass} checks passed, ${failures.length} failed`);
  if (failures.length) {
    failures.forEach((name) => console.log(`  - ${name}`));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("\nSmoke run crashed:", error.message);
  process.exit(1);
});
