// API client for the PS07 extension surfaces.
//
// Built only on what lib/api.js and lib/net.js already export: reads go
// through getResilient (last good copy served, flagged stale, when the
// network fails), writes through the existing localStorage queue so a write
// made offline is held and replayed by the app's own syncQueue(). Nothing in
// those two modules is changed.

import { api, getResilient, getToken, postResilient, request } from "../lib/api.js";
import { enqueue, isOnline, queueSize } from "../lib/net.js";

const q = (params = {}) => {
  const parts = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== false);
  return parts.length ? `?${parts.map(([k, v]) => `${k}=${encodeURIComponent(v === true ? "1" : v)}`).join("&")}` : "";
};

/** GET with the last-good-copy fallback. Returns { data, stale, cachedAt }. */
export const read = (path, { lite } = {}) => getResilient(path + (lite ? (path.includes("?") ? "&lite=1" : "?lite=1") : ""), { maxAgeMs: 20000 });

/** POST / PATCH / PUT that queues when offline. Returns { queued, data }. */
export async function write(method, path, body) {
  if (method === "POST") return postResilient(path, body);
  if (!isOnline()) return { queued: true, entry: enqueue({ path, body, method }), queueSize: queueSize() };
  try {
    return { queued: false, data: await request(path, { method, body }) };
  } catch (error) {
    if (error.status === 0) return { queued: true, entry: enqueue({ path, body, method }), queueSize: queueSize(), error: error.message };
    throw error;
  }
}

/** Plain request for things that must not be queued (previews, the verifier). */
export const now = (path, opts) => request(path, opts);

/** Downloads a binary (the certificate PDF) with the session token. */
export async function download(path) {
  const token = getToken();
  const res = await fetch(api.base + path, { credentials: "include", headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    try {
      message = (await res.json()).message || message;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }
  return res.blob();
}

export const ext = {
  // 1A notices
  noticeFeed: (lite) => read("/api/notices/feed", { lite }),
  noticeRules: () => read("/api/notices/rules"),
  noticeStep: (id, step) => write("POST", `/api/notices/${id}/${step}`, {}),
  notices: (lite) => read("/api/notices", { lite }),
  noticePreview: (body) => now("/api/notices/preview", { method: "POST", body }),
  noticeCreate: (body) => write("POST", "/api/notices", body),
  noticeDashboard: (id, lite) => read(`/api/notices/${id}/dashboard`, { lite }),
  noticeCancel: (id, reason) => write("POST", `/api/notices/${id}/cancel`, { reason }),
  noticeSweep: () => now("/api/notices/sweep", { method: "POST", body: {} }),
  // 1B documents
  documents: (lite, params) => read(`/api/documents${q(params)}`, { lite }),
  documentRequest: (body) => write("POST", "/api/documents", body),
  documentKiosk: (body) => write("POST", "/api/documents/kiosk", body),
  documentReview: (id, body) => write("POST", `/api/documents/${id}/review`, body),
  documentIssue: (id) => write("POST", `/api/documents/${id}/issue`, {}),
  documentRevoke: (id, reason) => write("POST", `/api/documents/${id}/revoke`, { reason }),
  documentPdf: (id) => download(`/api/documents/${id}/pdf`),
  verify: (code) => now(`/api/verify/${encodeURIComponent(code)}`),
  verifyCopy: (code, content) => now(`/api/verify/${encodeURIComponent(code)}`, { method: "POST", body: { content } }),
  // 1C timetable and mess
  week: (lite) => read("/api/timetable/week", { lite }),
  day: (day) => now(`/api/timetable/day${q({ day })}`),
  ask: (question) => now("/api/timetable/ask", { method: "POST", body: { question } }),
  adjusted: (lite) => read("/api/timetable/attendance-adjusted", { lite }),
  schedules: () => read("/api/timetable/schedules"),
  classChanges: () => read("/api/timetable/changes"),
  classChange: (body) => write("POST", "/api/timetable/changes", body),
  menus: (lite) => read("/api/mess-menu", { lite }),
  nextMeal: () => now("/api/mess-menu/next"),
  menuChange: (body) => write("POST", "/api/mess-menu/changes", body),
  // 1D fees
  myFees: (lite) => read("/api/fees/me", { lite }),
  feeSummary: (lite) => read("/api/fees/summary", { lite }),
  feeReminders: () => now("/api/fees/reminders", { method: "POST", body: {} }),
  // 1E tracker
  myRequests: (lite) => read("/api/requests/mine", { lite }),
  pending: (params, lite) => read(`/api/requests/pending${q(params)}`, { lite }),
  // 2A friction
  friction: (lite) => read("/api/friction", { lite }),
  baseline: (workflow, body) => write("PATCH", `/api/friction/baselines/${workflow}`, body),
  compare: (steps) => now("/api/friction/compare", { method: "POST", body: { steps } }),
  // 2B SMS
  smsPhones: () => read("/api/sms/phones"),
  smsSimulate: (from, text) => now("/api/sms/simulate", { method: "POST", body: { from, text } }),
  smsActivity: (lite) => read("/api/sms/activity", { lite }),
  // 2C fix
  fixMine: () => read("/api/fix/mine"),
  fixConfirm: (id, body) => write("POST", `/api/fix/${id}/confirm`, body),
  fixResolved: (lite) => read("/api/fix/resolved", { lite }),
  fixProofs: (id) => read(`/api/fix/${id}/proof`),
  fixAttach: (id, body) => write("POST", `/api/fix/${id}/proof`, body),
  fixMetrics: (lite) => read("/api/fix/metrics", { lite }),
  fixReopen: (id, body) => write("POST", `/api/fix/reopen/${id}`, body),
  // 2D FAQ
  faqAsk: (question, lang) => now("/api/faq/ask", { method: "POST", body: { question, lang } }),
  faqRequest: (body) => write("POST", "/api/faq/request", body),
  faqSections: () => read("/api/faq/sections"),
  faqSave: (key, body) => write("PUT", `/api/faq/sections/${key}`, body),
  faqStats: () => read("/api/faq/stats"),
  // 2E board
  board: (hostel, lite) => read(`/api/board${q({ hostel })}`, { lite }),
  // 2H adoption
  adoption: () => read("/api/adoption/datasets"),
  adoptionTemplate: (dataset) => download(`/api/adoption/templates/${dataset}`),
  adoptionValidate: (dataset, csv) => now(`/api/adoption/validate/${dataset}`, { method: "POST", body: { csv } }),
  // existing endpoints reused by Tuesday Mode (read-only use of the app's own client)
  createComplaint: (body) => postResilient("/api/complaints", body),
  apiBase: api.base
};
