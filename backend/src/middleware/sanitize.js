// Strips the Mongo query operators an attacker would need to turn a JSON body
// into a query ({ "email": { "$ne": null } }). Keeps dotted keys out too.
function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object" && value.constructor === Object) {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (key.startsWith("$") || key.includes(".")) continue;
      out[key] = clean(item);
    }
    return out;
  }
  return value;
}

export function sanitizeRequest(req, _res, next) {
  if (req.body) req.body = clean(req.body);
  if (req.params) req.params = clean(req.params);
  // req.query is a getter on Express 5-style apps; assign defensively.
  if (req.query) {
    const cleaned = clean(req.query);
    for (const key of Object.keys(req.query)) delete req.query[key];
    Object.assign(req.query, cleaned);
  }
  next();
}
