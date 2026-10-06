// Silent Support System — API client.
//
// Deliberately uses plain request() only: no last-good-copy cache and no
// offline write queue, because both persist to localStorage. Wellbeing answers
// and support requests must never be left on a shared or borrowed device.
// The backend answers every /api/support route with Cache-Control: no-store.

import { request } from "../lib/api.js";

const post = (path, body) => request(path, { method: "POST", body: body ?? {} });

export const support = {
  me: () => request("/api/support/me"),
  checkIn: (body) => post("/api/support/check-in", body),
  request: (body) => post("/api/support/requests", body),
  checkLater: (days) => post("/api/support/check-later", { days }),
  withdraw: (id) => post(`/api/support/requests/${id}/withdraw`),
  resources: () => request("/api/support/resources"),
  queue: (closed) => request(`/api/support/queue${closed ? "?closed=true" : ""}`),
  move: (id, body) => post(`/api/support/cases/${id}/status`, body),
  overview: (days = 30) => request(`/api/support/overview?days=${days}`)
};
