// API client for the Exception-Only Campus (/api/xo/*).
//
// Built only on ext/api.js: reads go through getResilient (last good copy
// served, flagged stale, when the network fails), writes through the existing
// offline queue. Nothing in lib/api.js, lib/net.js or ext/api.js is changed.

import { now, read, write } from "../ext/api.js";

const q = (params = {}) => {
  const parts = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== false);
  return parts.length ? `?${parts.map(([k, v]) => `${k}=${encodeURIComponent(v === true ? "1" : v)}`).join("&")}` : "";
};

export const xo = {
  // Phase 1 — event log
  events: (params) => read(`/api/xo/events${q(params)}`),
  eventSummary: () => read("/api/xo/events/summary"),
  subjectEvents: (type, id) => read(`/api/xo/events/${type}/${id}`),
  // Phase 2 — Touchless Lane
  rules: (params) => read(`/api/xo/policy/rules${q(params)}`),
  preview: (body) => now("/api/xo/policy/preview", { method: "POST", body }),
  undo: (kind, id, reason) => write("POST", `/api/xo/policy/undo/${kind}/${id}`, { reason }),
  exceptions: () => read("/api/xo/policy/exceptions"),
  touchlessRate: (days) => read(`/api/xo/policy/touchless-rate${q({ days })}`),
  draftRule: (body) => write("POST", "/api/xo/policy/rules", body),
  activateRule: (id) => write("POST", `/api/xo/policy/rules/${id}/activate`, {}),
  services: () => read("/api/xo/services"),
  requestReceipt: (body) => write("POST", "/api/xo/services", body),
  decideService: (id, body) => write("POST", `/api/xo/services/${id}/decide`, body),
  // Phase 3 — Friction Ledger
  ledgerPublic: () => read("/api/xo/ledger/public"),
  ledger: (days) => read(`/api/xo/ledger${q({ days })}`),
  ledgerMine: () => read("/api/xo/ledger/me"),
  boardImpact: (hostel) => read(`/api/xo/board/impact${q({ hostel })}`),
  // Phase 4 — report smarter
  similar: (body) => now("/api/xo/report/similar", { method: "POST", body }),
  follow: (id, body) => write("POST", `/api/xo/incidents/${id}/follow`, body),
  eta: (params) => read(`/api/xo/eta${q(params)}`),
  incidentSignals: () => read("/api/xo/incidents/signals"),
  assets: (building) => read(`/api/xo/assets${q({ building })}`),
  closures: (days) => read(`/api/xo/closures${q({ days })}`),
  // Phase 5 — guaranteed reach
  hygiene: (body) => now("/api/xo/notices/hygiene", { method: "POST", body }),
  noticeCreate: (body) => write("POST", "/api/xo/notices", body),
  reachFunnel: (id) => read(`/api/xo/notices/${id}/reach`),
  kioskList: () => read("/api/xo/reach/kiosk-list"),
  kioskRead: (body) => write("POST", "/api/xo/reach/kiosk-read", body),
  classRep: () => read("/api/xo/reach/class-rep"),
  // Phase 6 — change propagation
  changes: () => read("/api/xo/changes"),
  myChanges: () => read("/api/xo/changes/mine"),
  planShutdown: (body) => write("POST", "/api/xo/changes/shutdown", body),
  // Phase 7 — chaos import (never queued: a dry run needs the server's answer)
  importWhatsapp: (body) => now("/api/xo/import/whatsapp", { method: "POST", body }),
  faqDrafts: () => read("/api/xo/faq/drafts"),
  // Phase 8 — policy what-if
  replay: (body) => now("/api/xo/policy/replay", { method: "POST", body }),
  // Phase 9 — SMS work loop
  smsOutbox: () => now("/api/xo/sms/outbox"),
  staffPhones: () => read("/api/xo/sms/staff-phones"),
  // Phase 10 — Tuesday Test
  tuesdayCompare: (steps) => now("/api/xo/tuesday/compare", { method: "POST", body: { steps } }),
  tuesdayReach: (noticeId) => now(`/api/xo/tuesday/reach/${noticeId}`)
};
