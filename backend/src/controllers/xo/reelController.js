import { LITE_ARRAY_LIMIT } from "../../middleware/bandwidth.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { ok } from "../../utils/respond.js";
import { proofReel } from "../../services/xo/reelService.js";

/**
 * ?lite=1 for the reel (see CHANGES-REEL.md). The existing `lite` middleware
 * caps every array at three entries — applied to this response it would cap
 * `scenes` itself and drop seven of the ten scenes. So the same rule, with the
 * same limit and the same `lite` / `liteNote` flags, is applied one level
 * down: inside each scene's data. The reel's drawn lists are keyed objects or
 * counts, so the trim never changes a frame.
 */
const trim = (value, depth = 0) => {
  if (depth > 4) return value;
  if (Array.isArray(value)) return value.slice(0, LITE_ARRAY_LIMIT).map((v) => trim(v, depth + 1));
  if (value && typeof value === "object" && value.constructor === Object) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, trim(v, depth + 1)]));
  return value;
};

/** GET /api/xo/reel — the 30-second proof, every scene from the live database. Staff only; writes nothing. */
export const reel = asyncHandler(async (req, res) => {
  const out = await proofReel();
  if (req.query.lite !== "1" && req.query.lite !== "true") return ok(res, out);
  return res.status(200).json({ success: true, data: { ...out, scenes: out.scenes.map((s) => ({ ...s, data: trim(s.data) })) }, lite: true, liteNote: `Arrays inside each scene trimmed to ${LITE_ARRAY_LIMIT} entries for low-bandwidth delivery; all ten scenes are kept.` });
});
