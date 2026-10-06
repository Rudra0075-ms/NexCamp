import { clamp } from "./text.js";

export function paginate(query) {
  const page = clamp(Number.parseInt(query.page, 10) || 1, 1, 10000);
  const limit = clamp(Number.parseInt(query.limit, 10) || 20, 1, 100);
  return { page, limit, skip: (page - 1) * limit };
}

export function pageMeta(page, limit, total) {
  return { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) };
}
