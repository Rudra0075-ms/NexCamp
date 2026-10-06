export function ok(res, data, message) {
  return res.status(200).json({ success: true, data, message });
}

export function created(res, data, message) {
  return res.status(201).json({ success: true, data, message });
}

export function fail(res, status, message, details) {
  const body = { success: false, message };
  if (details) body.details = details;
  return res.status(status).json(body);
}
