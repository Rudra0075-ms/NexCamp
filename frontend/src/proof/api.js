// API client for Round 3 (Prove / Optimise / Audit / Prevent).
//
// Built on ext/api.js only: reads go through getResilient (the last good copy
// is served, flagged stale, when the network fails); previews, lint and the
// optimiser use `now` because a dry run needs the server's answer and must
// never be queued. The one write (accepting a lunch slot) uses the offline queue.

import { now, read, write } from "../ext/api.js";

const q = (params = {}) => {
  const parts = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "" && v !== false);
  return parts.length ? `?${parts.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&")}` : "";
};

export const pf = {
  processMining: (workflow, days) => read(`/api/admin/process-mining${q({ workflow, days })}`),
  equity: (lite) => read("/api/admin/equity", { lite }),
  impact: (id) => read(`/api/interventions/${id}/impact`),
  interventions: () => read("/api/interventions"),
  badges: (lite) => read("/api/board/proof", { lite }),
  portfolio: (hours, trade) => now("/api/interventions/portfolio", { method: "POST", body: { hours, trade: trade || undefined } }),
  preflight: (body) => now("/api/changes/preview", { method: "POST", body }),
  lint: (body) => now("/api/notices/lint", { method: "POST", body }),
  presence: (meal, date) => read(`/api/mess/presence-forecast${q({ meal, date })}`),
  bestSlot: (meal, date) => read(`/api/mess/best-slot${q({ meal, date })}`),
  acceptSlot: (body) => write("POST", "/api/mess/best-slot/accept", body),
  pointOfNoReturn: () => read("/api/attendance/me/point-of-no-return"),
  sections: (lite) => read("/api/attendance/sections/analysis", { lite }),
  unblock: () => read("/api/requests/unblock"),
  reliability: (building, lite) => read(`/api/risk/reliability${q({ building })}`, { lite })
};
