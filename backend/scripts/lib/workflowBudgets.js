/**
 * Phase 9 — what four everyday workflows cost on a 2G connection.
 *
 * Each workflow is the API calls the student app makes for it, run for real
 * against the real Express app (createApp) over HTTP. Bytes are MEASURED:
 * request body + response body, uncompressed (what the server sends before any
 * proxy gzip — a conservative figure). Time is SIMULATED from those bytes with
 * the network ASSUMPTIONS below. Used by `npm run budgets` (writes the page-21
 * report) and by test/xo-budget.test.js (fails when a workflow is over budget).
 */

export const NETWORK = {
  name: "2G (EDGE)",
  kbps: 50, // ASSUMPTION — effective EDGE throughput, both directions
  rttMs: 600, // ASSUMPTION — round trip per request on a 2G bearer
  headerBytes: 700 // ASSUMPTION — HTTP request + response headers per call
};

/** Budgets in bytes (request + response bodies). A test fails above these. */
export const BUDGETS = {
  complaint: 12 * 1024,
  gatepass: 10 * 1024,
  certificate: 8 * 1024,
  notice: 6 * 1024, // REEL HOOK (see CHANGES-REEL.md): trailing comma only
  reel: 12 * 1024 // REEL HOOK (see CHANGES-REEL.md): the 30-second proof, one request
};

export const ASSUMPTIONS = [
  `Throughput ${NETWORK.kbps} kbps and ${NETWORK.rttMs} ms round trip per request (typical EDGE figures) — ASSUMPTION.`,
  `${NETWORK.headerBytes} bytes of HTTP headers per request — ASSUMPTION.`,
  "Bodies are measured uncompressed; with gzip on the way the real transfer is smaller.",
  "The app shell is cached by the service worker after the first visit, so it is not counted here.",
  "The gate-pass run includes the development OTP echo (a few bytes) that production does not send."
];

/** Pure: simulated seconds on the network above. */
export function simulatedSeconds(bytes, requests, net = NETWORK) {
  const wire = bytes + requests * net.headerBytes;
  return Math.round(((requests * net.rttMs) / 1000 + (wire * 8) / (net.kbps * 1000)) * 10) / 10;
}

const plusHours = (h) => new Date(Date.now() + h * 3600000).toISOString();

export const WORKFLOWS = [
  {
    key: "complaint",
    label: "File a complaint",
    steps: [
      { label: "Send the complaint", method: "POST", path: () => "/api/complaints", body: () => ({ title: "Tap leaking in washroom", description: "The tap in the B-101 washroom has been leaking since last night", category: "WATER", location: "HOSTEL B · B-101" }) },
      { label: "See it in My requests", method: "GET", path: () => "/api/requests/mine?lite=1" }
    ]
  },
  {
    key: "gatepass",
    label: "Apply for a gate pass",
    steps: [
      { label: "Apply", method: "POST", path: () => "/api/gatepass", body: () => ({ reason: "Bank visit", destination: "Town", leaveAt: plusHours(20), expectedReturnAt: plusHours(23) }), keep: (d, ctx) => { ctx.passId = d.gatePass.id; ctx.otp = d.otp?.devCode; } },
      { label: "Guardian code", method: "POST", path: (ctx) => `/api/gatepass/${ctx.passId}/verify-otp`, body: (ctx) => ({ code: ctx.otp }) },
      { label: "Check status", method: "GET", path: (ctx) => `/api/gatepass/${ctx.passId}/status` }
    ]
  },
  {
    key: "certificate",
    label: "Request a certificate",
    steps: [
      { label: "Request bonafide", method: "POST", path: () => "/api/documents", body: () => ({ type: "BONAFIDE", purpose: "Bank account opening" }) },
      { label: "See it in My documents", method: "GET", path: () => "/api/documents?lite=1" }
    ]
  },
  {
    key: "notice",
    label: "Read a notice",
    steps: [
      { label: "Notice feed", method: "GET", path: () => "/api/notices/feed?lite=1", keep: (d, ctx) => { ctx.noticeId = d.notices[0]?.id; } },
      { label: "Mark read", method: "POST", path: (ctx) => `/api/notices/${ctx.noticeId}/read`, body: () => ({}) }
    ]
  }
];

// REEL HOOK (see CHANGES-REEL.md): a staff workflow, measured separately (seeded database, admin token) so the
// four student workflows above and their test are unchanged.
export const REEL_WORKFLOW = {
  key: "reel",
  label: "30-second proof",
  steps: [{ label: "All ten scenes", method: "GET", path: () => "/api/xo/reel?lite=1" }]
};

/** Runs every workflow as `token`'s user against `base`, measuring each call. */
export async function measureWorkflows(base, token, workflows = WORKFLOWS) { // REEL HOOK: optional list (default unchanged)
  const out = [];
  for (const wf of workflows) {
    const ctx = {};
    const steps = [];
    for (const step of wf.steps) {
      const body = step.body ? JSON.stringify(step.body(ctx)) : undefined;
      const r = await fetch(base + step.path(ctx), { method: step.method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body });
      const text = await r.text();
      if (!r.ok) throw new Error(`${wf.label} · ${step.label}: HTTP ${r.status} ${text.slice(0, 200)}`);
      const json = JSON.parse(text);
      step.keep?.(json.data, ctx);
      steps.push({ label: step.label, method: step.method, path: step.path(ctx).replace(/[0-9a-f]{24}/g, ":id"), up: body ? Buffer.byteLength(body) : 0, down: Buffer.byteLength(text) });
    }
    const bytes = steps.reduce((t, s) => t + s.up + s.down, 0);
    out.push({ key: wf.key, label: wf.label, requests: steps.length, bytes, budget: BUDGETS[wf.key], withinBudget: bytes <= BUDGETS[wf.key], seconds2g: simulatedSeconds(bytes, steps.length), steps });
  }
  return out;
}

/** Minimal records the four workflows need, in an empty database. */
export async function budgetFixtures(models, { createNotice, password = "Passw0rd1" } = {}) {
  const { Building, User, StudentProfile } = models;
  const hostel = await Building.create({ code: "HST-B", mapId: "hostb", name: "HOSTEL B", type: "HOSTEL" });
  const admin = await User.create({ name: "BUDGET ADMIN", email: "budget.admin@test.in", password, role: "ADMIN", managedDepartment: "GENERAL ADMINISTRATION" });
  await User.create({ name: "BUDGET WARDEN", email: "budget.warden@test.in", password, role: "WARDEN", hostel: hostel._id, hostelName: "HOSTEL B", managedDepartment: "MAINTENANCE · PLUMBING" });
  const student = await User.create({ name: "BUDGET STUDENT", email: "budget.student@test.in", password, role: "STUDENT", studentId: "BPUT/CSE/22/0901", department: "COMPUTER SCIENCE & ENGINEERING", course: "B.TECH CSE", semester: 5, hostel: hostel._id, hostelName: "HOSTEL B", room: "B-101", parentPhone: "+919000055555", parentName: "GUARDIAN" });
  await StudentProfile.create({ student: student._id, branch: "CSE", year: 3, batch: "2022", section: "A", registeredPhone: "+919000044444" });
  await createNotice({ title: "Library open till 10 pm this week", body: "The central library stays open until 10 pm from Monday to Friday for the mid-semester tests.", priority: "NORMAL", audience: { roles: ["STUDENT"] }, overrideQuietHours: true }, admin);
  return { admin, student, email: "budget.student@test.in", password };
}
