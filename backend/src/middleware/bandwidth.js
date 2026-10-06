/**
 * Low-bandwidth support on the API side.
 *
 * The campus network this runs on is patchy, so the goal is fewer bytes and
 * fewer repeated round trips — not a claim that the application can improve
 * the network itself.
 *
 * Two mechanisms, both standard HTTP:
 *
 *   cacheable()  sets Cache-Control on reads that are expensive and change
 *                slowly. Express already computes an ETag for every JSON body
 *                and answers a matching If-None-Match with a 304, so a repeat
 *                read on a bad connection costs a header exchange instead of a
 *                payload. Adding max-age lets the browser skip even that.
 *
 *   lite()       honours ?lite=1 by trimming the large arrays out of a
 *                response. The summary figures stay; the row-by-row evidence
 *                is dropped, and `lite: true` tells the client what it is
 *                holding so it never renders a trimmed list as a complete one.
 */

/** Marks a read as cacheable for `seconds`, for this user only. */
export function cacheable(seconds = 30) {
  return (_req, res, next) => {
    // private: these responses are scoped to one account and must not be held
    // by a shared proxy.
    res.set("Cache-Control", `private, max-age=${seconds}, stale-while-revalidate=${seconds * 2}`);
    next();
  };
}

/** Never store: anything that names a student or an audit actor. */
export function noStore(_req, res, next) {
  res.set("Cache-Control", "no-store");
  next();
}

const ARRAY_LIMIT = 3;

/**
 * Recursively caps long arrays. Depth-limited so a deeply nested response
 * cannot turn one request into an expensive walk.
 */
function trim(value, depth = 0) {
  if (depth > 4) return value;
  if (Array.isArray(value)) {
    return value.slice(0, ARRAY_LIMIT).map((item) => trim(item, depth + 1));
  }
  if (value && typeof value === "object" && value.constructor === Object) {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = trim(item, depth + 1);
    return out;
  }
  return value;
}

/**
 * Wraps res.json so ?lite=1 responses carry at most three entries per array.
 * Applied per route rather than globally, so nothing that has to be complete —
 * an audit chain, a QR payload — can be trimmed by accident.
 */
export function lite(req, res, next) {
  if (req.query.lite !== "1" && req.query.lite !== "true") return next();

  const original = res.json.bind(res);
  res.json = (body) => {
    if (!body || typeof body !== "object" || body.success === false) return original(body);
    return original({
      ...body,
      data: trim(body.data),
      // The client must be able to tell a trimmed list from a short one.
      lite: true,
      liteNote: `Arrays trimmed to ${ARRAY_LIMIT} entries for low-bandwidth delivery. Re-request without ?lite=1 for the full response.`
    });
  };
  next();
}

export const LITE_ARRAY_LIMIT = ARRAY_LIMIT;
