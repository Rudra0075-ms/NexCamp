// Thin fetch wrapper over the NeX Camp API.
//
// Every surface in NexCamp.jsx keeps its original hard-coded values as a
// fallback, so the interface renders identically when the backend is not
// running. `live` below is what replaces those values once it is.

import { enqueue, flushQueue, isOnline, queueSize, readCache, withRetry, writeCache } from "./net.js";

const BASE = (import.meta.env?.VITE_API_URL || "http://localhost:5000").replace(/\/$/, "");

// Kept in memory rather than localStorage: the API also sets an httpOnly
// cookie, and this header is only a convenience for non-cookie clients.
let token = null;

export function setToken(next) {
  token = next || null;
}

export function getToken() {
  return token;
}

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function request(path, { method = "GET", body, signal } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
      signal
    });
  } catch (error) {
    // Network-level failure: the backend is not running, or CORS refused us.
    throw new ApiError(0, error.name === "AbortError" ? "Request cancelled" : "Backend unreachable");
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* no body */
  }

  if (!res.ok || payload?.success === false) {
    throw new ApiError(res.status, payload?.message || `Request failed (${res.status})`, payload?.details);
  }
  return payload?.data;
}

const get = (path, signal) => request(path, { signal });
const post = (path, body) => request(path, { method: "POST", body });
const patch = (path, body) => request(path, { method: "PATCH", body });

/**
 * A GET that survives a bad connection.
 *
 * Tries the network with one bounded retry; on failure falls back to the last
 * good response for the same path. The result is wrapped so a caller always
 * knows what it is holding:
 *
 *   { data, stale: false }                 fresh from the server
 *   { data, stale: true, cachedAt, error } the cached copy, and why
 *
 * Nothing invents data: with no cache and no network this rejects, exactly as
 * a plain request would.
 */
export async function getResilient(path, { maxAgeMs = 20000, signal } = {}) {
  try {
    const data = await withRetry(() => request(path, { signal }));
    writeCache(path, data);
    return { data, stale: false, cachedAt: Date.now() };
  } catch (error) {
    const cached = readCache(path, { maxAgeMs: Infinity });
    if (cached) return { data: cached.data, stale: true, cachedAt: cached.at, error: error.message };
    throw error;
  }
}

/**
 * A write that is held rather than lost when the device is offline.
 * Returns { queued: true } when it was stored for later, so the interface can
 * say so honestly instead of reporting a success that never happened.
 */
export async function postResilient(path, body, { priority = "normal" } = {}) {
  if (!isOnline()) {
    const entry = enqueue({ path, body, method: "POST", priority });
    return { queued: true, entry, queueSize: queueSize() };
  }
  try {
    const data = await withRetry(() => request(path, { method: "POST", body }));
    return { queued: false, data };
  } catch (error) {
    // A transport failure is the offline case arriving a moment late.
    if (error.status === 0) {
      const entry = enqueue({ path, body, method: "POST", priority });
      return { queued: true, entry, queueSize: queueSize(), error: error.message };
    }
    throw error;
  }
}

/** Replays everything the queue is holding. Safe to call repeatedly. */
export function syncQueue() {
  return flushQueue((item) => request(item.path, { method: item.method || "POST", body: item.body }));
}

export { queueSize, isOnline } from "./net.js";

export const api = {
  base: BASE,

  // auth
  login: (email, password) => post("/api/auth/login", { email, password }),
  logout: () => post("/api/auth/logout"),
  me: () => get("/api/auth/me"),

  // campus + intelligence reads
  campus: (signal) => get("/api/campus", signal),
  buildings: () => get("/api/buildings"),
  building: (id) => get(`/api/buildings/${id}`),
  incidents: (query = "?open=true&limit=12") => get(`/api/incidents${query}`),
  incident: (id) => get(`/api/incidents/${id}`),
  investigation: (id) => get(`/api/incidents/${id}/investigation`),
  memoryMatch: (id) => get(`/api/incidents/${id}/memory-match`),
  cluster: (body) => post("/api/incidents/cluster", body),
  memory: (query = "?limit=8") => get(`/api/memory${query}`),

  // student surfaces
  dashboard: () => get("/api/students/me/dashboard"),
  attendance: () => get("/api/attendance/me"),
  simulateAttendance: (body) => post("/api/attendance/simulate", body),

  // student intelligence — dashboard summary, the question box, attendance analysis
  studentIntelligence: (windowDays = 14) => get(`/api/students/me/intelligence?window=${windowDays}`),
  studentQuery: (question, domain) => post("/api/students/me/query", domain ? { question, domain } : { question }),
  attendanceIntelligence: (windowDays = 14) => get(`/api/attendance/me/intelligence?window=${windowDays}`),

  // mess
  messDemand: (signal) => get("/api/mess/demand", signal),
  messIntelligence: (params = {}) => {
    const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== "")).toString();
    return get(`/api/mess/intelligence${query ? `?${query}` : ""}`);
  },
  messSimulate: (body) => post("/api/mess/simulate", body),
  messFeedback: (body) => post("/api/mess/feedback", body),

  // risk
  risk: (signal) => get("/api/risk", signal),
  buildingRisk: (id) => get(`/api/risk/building/${id}`),
  anomalies: () => get("/api/risk/anomalies"),

  // complaints
  createComplaint: (body) => post("/api/complaints", body),
  complaints: (query = "?limit=10") => get(`/api/complaints${query}`),

  // intervention + decision
  interventions: (query = "?limit=10") => get(`/api/interventions${query}`),
  intervention: (id) => get(`/api/interventions/${id}`),
  simulateIntervention: (body) => post("/api/interventions/simulate", body),
  decide: (id, body) => post(`/api/interventions/${id}/decision`, body),
  quality: (id) => get(`/api/interventions/${id}/quality`),

  // gate pass
  gatePassConfig: () => get("/api/gatepass/config"),
  gatePasses: (query = "?limit=20") => get(`/api/gatepass${query}`),
  gatePass: (id) => get(`/api/gatepass/${id}`),
  gatePassStatus: (id) => get(`/api/gatepass/${id}/status`),
  // GATE-PASS QR FIX (see CHANGES-GATEPASS-QR-FIX.md): rotate only on REGENERATE; otherwise the current QR is shown again.
  gatePassQr: (id, rotate = false) => get(`/api/gatepass/${id}/qr${rotate ? "?rotate=1" : ""}`),
  createGatePass: (body) => post("/api/gatepass", body),
  sendGatePassOtp: (id) => post(`/api/gatepass/${id}/send-otp`),
  verifyGatePassOtp: (id, code) => post(`/api/gatepass/${id}/verify-otp`, { code }),
  approveGatePass: (id, body = {}) => post(`/api/gatepass/${id}/approve`, body),
  rejectGatePass: (id, body = {}) => post(`/api/gatepass/${id}/reject`, body),
  cancelGatePass: (id) => post(`/api/gatepass/${id}/cancel`),
  scanGatePass: (token) => post("/api/gatepass/scan", { token }),
  gatePassSummary: () => get("/api/gatepass/summary"),
  gatePassNotifications: () => get("/api/gatepass/notifications"),
  readGatePassNotification: (id) => post(`/api/gatepass/notifications/${id}/read`),

  // mission control
  adminOverview: () => get("/api/admin/overview"),
  actionQueue: () => get("/api/admin/action-queue"),
  briefing: () => get("/api/admin/briefing"),
  relationships: () => get("/api/intelligence/relationships"),

  // ---- AI layer ----------------------------------------------------------
  // Every one of these is a backend endpoint. The browser never holds an AI
  // key and never talks to a provider directly.
  aiStatus: () => get("/api/ai/status"),
  aiSummary: (lite) => get(`/api/ai/summary${lite ? "?lite=1" : ""}`),
  aiRecurring: (lite) => get(`/api/ai/recurring${lite ? "?lite=1" : ""}`),
  aiRootCause: (buildingCode, category) =>
    get(`/api/ai/root-cause/${encodeURIComponent(buildingCode)}/${encodeURIComponent(category)}`),
  aiAnomalies: (lite) => get(`/api/ai/anomalies${lite ? "?lite=1" : ""}`),
  aiPredictions: (lite) => get(`/api/ai/predictions${lite ? "?lite=1" : ""}`),
  aiCopilot: (question) => post("/api/ai/copilot", { question }),
  aiCopilotQuestions: () => get("/api/ai/copilot/questions"),
  aiAudit: (query = "?limit=25") => get(`/api/ai/audit${query}`),
  aiGatePassRisk: () => get("/api/ai/gatepass-risk"),
  aiStudentGatePassRisk: (studentId) => get(`/api/ai/gatepass-risk/${studentId}`),
  aiTimeline: (kind, id) => get(`/api/ai/timeline/${kind}/${id}`),
  aiNotifications: (priority) => get(`/api/ai/notifications${priority ? `?priority=${priority}` : ""}`),

  // operational intelligence
  aiSla: (lite) => get(`/api/ai/sla${lite ? "?lite=1" : ""}`),
  aiWorkload: (lite) => get(`/api/ai/workload${lite ? "?lite=1" : ""}`),
  aiSimulate: (body) => post("/api/ai/simulate", body),
  aiDataQuality: () => get("/api/ai/data-quality"),
  aiFeedback: () => get("/api/ai/feedback"),
  aiDigitalTwin: () => get("/api/ai/digital-twin"),
  aiDigitalTwinNode: (code) => get(`/api/ai/digital-twin/${encodeURIComponent(code)}`),
  aiCorrelations: () => get("/api/ai/correlations"),

  // complaint workflow + learning loop
  updateComplaint: (id, body) => patch(`/api/complaints/${id}`, body),
  studentFlagComplaint: (id, body) => post(`/api/complaints/${id}/student-flag`, body),
  complaintFeedback: (id, body) => post(`/api/complaints/${id}/feedback`, body),
  resolutionSuggestions: (id) => get(`/api/complaints/${id}/resolution-suggestions`),

  // complaint AI actions
  complaintDuplicates: (id) => get(`/api/complaints/${id}/duplicates`),
  decideRouting: (id, body) => patch(`/api/complaints/${id}/routing`, body),
  reviewDuplicate: (id, body) => post(`/api/complaints/${id}/duplicate-review`, body),
  reclassifyComplaint: (id) => post(`/api/complaints/${id}/reclassify`),

  // PS07 · early warning, predictions, Campus Pulse, WHY? explanations
  aiEarlyWarning: () => get("/api/ai/early-warning"),
  aiPredictive: () => get("/api/ai/predictive"),
  aiPulse: () => get("/api/ai/pulse"),
  aiWhy: (metric) => get(`/api/ai/why?metric=${encodeURIComponent(metric)}`),
  alertAct: (body) => post("/api/ai/early-warning/act", body),

  // PS07 · assisted-access kiosk and college adoption. Kiosk writes go through
  // the offline queue, so a request made on a dropped connection is held and
  // replayed rather than lost.
  kioskLookup: (studentId) => post("/api/kiosk/lookup", { studentId }),
  kioskComplaint: (body) => postResilient("/api/kiosk/complaint", body),
  kioskGatePass: (body) => post("/api/kiosk/gatepass", body),
  kioskSendOtp: (id, studentId) => post(`/api/kiosk/gatepass/${id}/send-otp`, { studentId }),
  kioskVerifyOtp: (id, studentId, code) => post(`/api/kiosk/gatepass/${id}/verify-otp`, { studentId, code }),
  kioskMessFeedback: (body) => postResilient("/api/kiosk/mess-feedback", body),
  kioskActivity: () => get("/api/kiosk/activity"),
  importPreview: (csv) => post("/api/admin/import-preview", { csv }),

  // command bar + judge demo
  query: (question) => post("/api/intelligence/query", { question }),
  story: () => get("/api/demo/incident-story"),
  demoState: () => get("/api/demo/state"),

  // Campus Resource Sharing & Help Hub (Student <-> Admin Only)
  resources: (query = "") => get(`/api/resources${query}`),
  resource: (id) => get(`/api/resources/${id}`),
  createResource: (body) => post("/api/resources", body),
  updateResource: (id, body) => patch(`/api/resources/${id}`, body),
  deleteResource: (id) => request(`/api/resources/${id}`, { method: "DELETE" }),
  downloadResource: (id) => post(`/api/resources/${id}/download`)
};

/** Reads that need no account — the public campus surfaces. */
export async function loadPublic(signal) {
  const [campus, incidents, mess, risk, memory, relationships, interventions, story] = await Promise.all([
    api.campus(signal),
    api.incidents(),
    api.messDemand(signal),
    api.risk(signal),
    api.memory(),
    api.relationships(),
    api.interventions("?limit=10"),
    api.story().catch(() => null)
  ]);
  return {
    campus,
    incidents,
    mess,
    risk,
    memory,
    relationships,
    interventions: interventions?.interventions || [],
    story
  };
}

/** Reads that need a signed-in student. */
export async function loadStudent() {
  const [dashboard, attendance, complaints, resolved] = await Promise.all([
    api.dashboard(),
    api.attendance(),
    api.complaints("?mine=true&limit=10"),
    // Feature 17: the student's resolved complaints, which they may rate.
    api.complaints("?mine=true&status=RESOLVED&limit=20").catch(() => null)
  ]);
  return { dashboard, attendance, complaints, resolved };
}

/** Reads that need staff authority. Resolves to null for a student account. */
export async function loadAdmin() {
  try {
    const [overview, queue, briefing] = await Promise.all([api.adminOverview(), api.actionQueue(), api.briefing()]);
    return { overview, queue, briefing };
  } catch (error) {
    if (error.status === 403 || error.status === 401) return null;
    throw error;
  }
}

/** The gate-pass surface: the signed-in user's passes, plus their alerts. */
export async function loadGatePass(user) {
  const [config, list, notifications, summary] = await Promise.all([
    api.gatePassConfig().catch(() => null),
    api.gatePasses("?limit=20").catch(() => null),
    api.gatePassNotifications().catch(() => null),
    // Staff only; a student simply gets null and the console stays hidden.
    user && user.role !== "STUDENT" ? api.gatePassSummary().catch(() => null) : Promise.resolve(null)
  ]);
  return {
    config,
    gatePasses: list?.gatePasses || [],
    sms: list?.sms || config?.sms || null,
    notifications: notifications?.notifications || [],
    summary
  };
}


/**
 * The staff AI surfaces. Each read is independent, so one failing endpoint —
 * or one that a warden is not authorised for — never blanks the whole panel.
 * A rejected read resolves to null and the interface says which one is missing.
 */
export async function loadAi(user, { lowBw = false, full = false } = {}) {
  const staff = user && user.role !== "STUDENT";

  // The summary is the one read worth serving from cache on a bad connection:
  // it is the panel an administrator opens the page for, and a stale copy with
  // its timestamp shown beats an empty panel. Everything else simply resolves
  // to null and its own panel reports that it is unavailable.
  const summaryPath = `/api/ai/summary${lowBw ? "?lite=1" : ""}`;

  const admin = user?.role === "ADMIN";
  const secondary = !lowBw || full;
  const [
    status, summary, recurring, anomalies, predictions, questions, audit, gatePassRisk,
    sla, workload, twin, correlations, feedback, dataQuality
  ] = await Promise.all([
    api.aiStatus().catch(() => null),
    staff ? getResilient(summaryPath, { maxAgeMs: 45000 }).catch(() => null) : Promise.resolve(null),
    staff ? api.aiRecurring(lowBw).catch(() => null) : Promise.resolve(null),
    staff ? api.aiAnomalies(lowBw).catch(() => null) : Promise.resolve(null),
    staff ? api.aiPredictions(lowBw).catch(() => null) : Promise.resolve(null),
    staff ? api.aiCopilotQuestions().catch(() => null) : Promise.resolve(null),
    // Administrators only; a warden simply gets null and the panel stays hidden.
    user?.role === "ADMIN" ? api.aiAudit("?limit=25").catch(() => null) : Promise.resolve(null),
    staff ? api.aiGatePassRisk().catch(() => null) : Promise.resolve(null),
    // Operational intelligence. Staff reads, except the data quality guardian,
    // which is administrators only. On a low-bandwidth connection the four
    // secondary analyses are deferred until asked for, so opening mission
    // control costs four fewer requests.
    staff ? api.aiSla(lowBw).catch(() => null) : Promise.resolve(null),
    staff ? api.aiWorkload(lowBw).catch(() => null) : Promise.resolve(null),
    staff && secondary ? api.aiDigitalTwin().catch(() => null) : Promise.resolve(null),
    staff && secondary ? api.aiCorrelations().catch(() => null) : Promise.resolve(null),
    staff && secondary ? api.aiFeedback().catch(() => null) : Promise.resolve(null),
    admin && secondary ? api.aiDataQuality().catch(() => null) : Promise.resolve(null)
  ]);

  return {
    status,
    // Unwrapped so callers see the same shape as before, with the cache state
    // alongside it rather than folded into it.
    summary: summary?.data ?? null,
    summaryStale: Boolean(summary?.stale),
    summaryCachedAt: summary?.cachedAt ?? null,
    summaryError: summary?.error ?? null,
    recurring,
    anomalies,
    predictions,
    questions,
    audit,
    gatePassRisk,
    sla,
    workload,
    twin,
    correlations,
    feedback,
    dataQuality,
    // True when the secondary analyses were held back for bandwidth.
    deferred: Boolean(staff && !secondary),
    lite: Boolean(lowBw)
  };
}
