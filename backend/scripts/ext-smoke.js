/**
 * End-to-end smoke test for the PS07 extension pack, against a running API and
 * a seeded database (npm run seed:fresh includes the extension seed).
 *
 *   cd backend && npm run seed:fresh && npm run dev   # terminal 1
 *   cd backend && npm run smoke:ext                   # terminal 2
 *
 * Walks every new workflow from the student's request to the administrator's
 * resolution: notices, certificates and public verification, class changes,
 * fees, the unified tracker, the SMS keyword channel, proof of fix, the FAQ,
 * the board, the Friction Ledger and the adoption validators. Exits non-zero
 * on the first broken expectation.
 */
import { env } from "../src/config/env.js";

const BASE = process.env.SMOKE_URL || `http://127.0.0.1:${env.port}`;
let pass = 0;
const failures = [];
const tokens = {};

function check(name, condition, detail) {
  if (condition) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function call(method, path, { body, as, raw } = {}) {
  const headers = { "content-type": "application/json" };
  if (as && tokens[as]) headers.authorization = `Bearer ${tokens[as]}`;
  const res = await fetch(BASE + path, { method, headers, body: body && method !== "GET" ? JSON.stringify(body) : undefined });
  if (raw) return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()), type: res.headers.get("content-type") };
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
  check(`${as} signs in`, Boolean(tokens[as]), `status ${res.status}`);
}

async function main() {
  console.log(`Extension smoke test against ${BASE}\n`);
  const health = await call("GET", "/health");
  if (health.body?.data?.database !== "connected") {
    console.log("API or database not reachable.");
    process.exit(1);
  }
  await login("student", env.demo.studentEmail, env.demo.studentPassword);
  await login("admin", env.demo.adminEmail, env.demo.adminPassword);
  await login("warden", "warden.hostelb@bput.ac.in", env.demo.adminPassword);
  await login("facility", "facility@bput.ac.in", env.demo.adminPassword);

  console.log("\n1A notice center");
  let r = await call("POST", "/api/notices/preview", { as: "admin", body: { audience: { hostels: ["HOSTEL B"] } } });
  check("reach is computed by the server", r.status === 200 && r.data.count > 0, JSON.stringify(r.data?.count));
  check("quiet-hours rule is shown to the composer", /07:30/.test(r.data?.quietHours?.text || ""));
  const reach = r.data?.count;
  const title = `Smoke notice ${Date.now()}`;
  r = await call("POST", "/api/notices", { as: "warden", body: { title, body: "Collect the new hostel ID cards from the warden office.", priority: "CRITICAL", audience: { hostels: ["HOSTEL B"] }, actionRequired: { label: "Collect ID card" }, confirmDuplicate: true } });
  check("CRITICAL notice publishes immediately", r.status === 201 && r.data.status === "PUBLISHED" && r.data.reach === reach, JSON.stringify(r.data));
  const noticeId = r.data?.id;
  r = await call("POST", "/api/notices", { as: "warden", body: { title, body: "Collect the new hostel ID cards from the warden office.", audience: { hostels: ["HOSTEL B"] } } });
  check("a near-identical notice to the same audience is flagged as a duplicate", r.status === 409 && r.body?.details?.duplicates?.length > 0, `status ${r.status}`);
  r = await call("GET", "/api/notices/feed", { as: "student" });
  check("student feed has the notice and an unread count", r.data?.notices?.some((n) => n.id === noticeId) && r.data.unread > 0);
  r = await call("POST", `/api/notices/${noticeId}/done`, { as: "student" });
  check("student marks the action done", Boolean(r.data?.actionDoneAt));
  r = await call("GET", `/api/notices/${noticeId}/dashboard`, { as: "admin" });
  check("dashboard counts delivered/read/done with hostel breakdown", r.data?.summary?.actionDone >= 1 && r.data.byHostel.length >= 1 && Array.isArray(r.data.notRead));
  check("student cannot open the staff dashboard", (await call("GET", `/api/notices/${noticeId}/dashboard`, { as: "student" })).status === 403);

  console.log("\n1B documents");
  const purpose = `Smoke test scholarship ${Date.now()}`;
  const existing = await call("GET", "/api/documents", { as: "student" });
  const openChar = existing.data?.documents?.find((d) => d.type === "CHARACTER" && ["SUBMITTED", "UNDER_REVIEW", "APPROVED"].includes(d.status));
  let docId = openChar?.id;
  if (!docId) {
    r = await call("POST", "/api/documents", { as: "student", body: { type: "CHARACTER", purpose } });
    check("student requests a certificate", r.status === 201 && r.data.status === "SUBMITTED", `status ${r.status}`);
    docId = r.data?.id;
  }
  r = await call("POST", `/api/documents/${docId}/review`, { as: "admin", body: { decision: "REJECT" } });
  check("rejection without a reason is refused", r.status === 400);
  await call("POST", `/api/documents/${docId}/review`, { as: "admin", body: { decision: "APPROVE" } });
  r = await call("POST", `/api/documents/${docId}/issue`, { as: "admin" });
  check("admin issues it with a verification code", r.data?.status === "ISSUED" && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(r.data.certificate?.verificationCode || ""));
  const code = r.data?.certificate?.verificationCode;
  const pdf = await call("GET", `/api/documents/${docId}/pdf`, { as: "student", raw: true });
  check("the certificate downloads as a PDF", pdf.status === 200 && pdf.type === "application/pdf" && pdf.buffer.slice(0, 5).toString() === "%PDF-");
  r = await call("GET", `/api/verify/${code}`);
  check("public verification says VALID with a masked name", r.data?.status === "VALID" && /\*/.test(r.data.nameMasked));
  const canonical = /\/(?:Nex|CIO)Canonical \(([A-Za-z0-9+/=]+)\)/.exec(pdf.buffer.toString("latin1"));
  const content = canonical ? Buffer.from(canonical[1], "base64").toString("utf8") : "";
  r = await call("POST", `/api/verify/${code}`, { body: { content } });
  check("an unaltered copy matches the issued digest", r.data?.copyMatches === true);
  r = await call("POST", `/api/verify/${code}`, { body: { content: content.replace(/name=[^\n]+/, "name=SOMEONE ELSE") } });
  check("a tampered copy fails verification", r.data?.copyMatches === false);
  r = await call("POST", `/api/documents/${docId}/revoke`, { as: "admin", body: { reason: "Smoke test revocation" } });
  check("admin revokes it", Boolean(r.data?.certificate?.revokedAt));
  check("verification now says REVOKED", (await call("GET", `/api/verify/${code}`)).data?.status === "REVOKED");
  check("an unknown code is NOT_FOUND", (await call("GET", "/api/verify/ZZZZ-ZZZZ")).data?.status === "NOT_FOUND");
  r = await call("POST", "/api/documents/kiosk", { as: "warden", body: { studentId: "BPUT/CSE/22/0421", type: "HOSTEL_RESIDENCE", purpose: "Kiosk smoke" } });
  check("the kiosk files a document request as the student with channel KIOSK", (r.status === 201 && r.data.channel === "KIOSK" && r.data.operator?.name) || r.status === 409, `status ${r.status}`);

  console.log("\n1C timetable");
  r = await call("GET", "/api/timetable/day?day=next", { as: "student" });
  check("the next class day is answered from the timetable with evidence", typeof r.data?.answer === "string" && Array.isArray(r.data.sessions));
  r = await call("POST", "/api/timetable/ask", { as: "student", body: { question: "Is tomorrow's class cancelled?" } });
  check("'Is tomorrow's class cancelled?' gets an answer", /^(Yes|No)/.test(r.data?.answer || ""), r.data?.answer);
  r = await call("GET", "/api/timetable/attendance-adjusted", { as: "student" });
  check("adjusted attendance is an additional view beside the unchanged official figure", r.data?.recorded?.label?.includes("unchanged") && r.data.adjusted);
  r = await call("GET", "/api/mess-menu/next", { as: "student" });
  check("the next meal is read from the mess register", typeof r.data?.answer === "string");
  check("a student cannot record a class change", (await call("POST", "/api/timetable/changes", { as: "student", body: {} })).status === 403);

  console.log("\n1D fees");
  r = await call("GET", "/api/fees/me", { as: "student" });
  check("student sees status, dues and next due date", r.data?.accounts?.[0]?.status && r.data.accounts[0].totals);
  r = await call("GET", "/api/fees/summary", { as: "admin" });
  check("admin sees dues by hostel, branch and year", r.data?.byHostel?.length && r.data.byBranch.length && r.data.byYear.length);

  console.log("\n1E request tracker");
  r = await call("GET", "/api/requests/mine", { as: "student" });
  check("one timeline across complaints, documents and notices", ["complaint", "document", "notice"].every((k) => r.data?.items?.some((i) => i.kind === k)));
  r = await call("GET", "/api/requests/pending", { as: "admin" });
  check("unified pending queue has ageing buckets and workload", r.data?.buckets?.length === 4 && Array.isArray(r.data.workload));
  r = await call("GET", "/api/requests/pending?kind=document&lite=1", { as: "admin" });
  check("?lite=1 trims and says so", r.body?.lite === true);

  console.log("\n2A friction ledger");
  r = await call("GET", "/api/friction", { as: "admin" });
  check("ledger rows carry ACTUAL DATA and BASELINE ESTIMATE labels", r.data?.rows?.some((row) => row.actual.kind === "ACTUAL DATA") && r.data.rows.every((row) => row.baseline?.kind === "BASELINE ESTIMATE"));
  r = await call("POST", "/api/friction/compare", { as: "student", body: { steps: [{ workflow: "DOCUMENT", seconds: 30 }] } });
  check("Tuesday Mode comparison returns measured vs baseline", r.data?.rows?.[0]?.measured?.kind === "MEASURED IN THIS DEMO");

  console.log("\n2B SMS keyword channel");
  r = await call("GET", "/api/sms/phones", { as: "student" });
  check("a student sees only their own registered number", r.data?.phones?.length === 1);
  const own = r.data?.phones?.[0]?.phone;
  const other = (await call("GET", "/api/sms/phones", { as: "admin" })).data?.phones?.find((p) => p.phone !== own)?.phone;
  check("a student cannot simulate someone else's number", (await call("POST", "/api/sms/simulate", { as: "student", body: { from: other, text: "ATT" } })).status === 403);
  // Staff may drive any registered number; rotate so repeated runs stay under
  // the per-number rate limit (8 messages / 10 minutes).
  const phones = (await call("GET", "/api/sms/phones", { as: "admin" })).data?.phones || [];
  const phone = phones[Math.floor(Math.random() * phones.length)]?.phone;
  r = await call("POST", "/api/sms/simulate", { as: "admin", body: { from: phone, text: "ATT" } });
  check("ATT replies within 160 characters", r.data?.outcome === "OK" && r.data.chars <= 160, r.data?.reply);
  r = await call("POST", "/api/sms/simulate", { as: "admin", body: { from: phone, text: "WATER B-214 shower tap leaking non stop" } });
  const ref = /Filed (CMP-\d+)/.exec(r.data?.reply || "")?.[1];
  check("a category command files a complaint", Boolean(ref), r.data?.reply);
  r = await call("POST", "/api/sms/simulate", { as: "admin", body: { from: phone, text: `STATUS ${ref}` } });
  check("STATUS returns the complaint stage", (r.data?.reply || "").includes(ref || "?"));
  r = await call("GET", "/api/sms/activity", { as: "admin" });
  check("Mission Control lists SMS activity and the SMS-filed complaint", r.data?.complaintsFiled?.some((c) => c.reference === ref));

  console.log("\n2C proof of fix");
  r = await call("GET", "/api/fix/resolved", { as: "facility" });
  const target = r.data?.complaints?.[0];
  check("staff see resolved complaints to attach proof to", Boolean(target));
  if (target) {
    r = await call("POST", `/api/fix/${target.id}/proof`, { as: "facility", body: { note: "Smoke re-inspection", photo: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAD0lEQVR4nGM4gQMwDC0JAJwulgGh6TLjAAAAAElFTkSuQmCC" } });
    check("staff attach a photo and note", r.status === 201);
  }
  r = await call("GET", "/api/fix/metrics", { as: "admin" });
  check("reopen rate and proof-of-fix rate per department", r.data?.departments?.length > 0 && "reopenRate" in r.data.departments[0]);

  console.log("\n2D FAQ");
  r = await call("POST", "/api/faq/ask", { as: "student", body: { question: "What time is dinner in the mess?" } });
  check("an answer cites its section", r.data?.answered && r.data.citation?.key);
  r = await call("POST", "/api/faq/ask", { as: "student", body: { question: "Who won the football league?" } });
  check("an unmatched question says so and offers a request", r.data?.answered === false && r.data.offerRequest === true);

  console.log("\n2E / 2H");
  r = await call("GET", "/api/board", { as: "student" });
  check("You Said, We Did board has cards", r.data?.cards?.length > 0);
  r = await call("POST", "/api/adoption/validate/rooms", { as: "admin", body: { csv: "hostel,room,floor,capacity\nHOSTEL B,B-999,9,2\nHOSTEL Z,Z-1,1,2" } });
  check("adoption dry run validates rows and writes nothing", r.data?.dryRun === true && r.data.written === 0 && r.data.errors === 1);

  console.log("\naudit");
  r = await call("GET", "/api/ai/audit?limit=200", { as: "admin" });
  const types = new Set((r.data?.entries || []).map((e) => e.entityType));
  check("extension actions are in the hash chain", ["Notice", "DocumentRequest"].every((t) => types.has(t)));
  check("the hash chain still verifies", r.data?.chain?.intact === true);

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
  console.log("\nExtension smoke test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
