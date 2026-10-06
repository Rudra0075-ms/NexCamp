import { readFile } from "node:fs/promises";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { ok } from "../../utils/respond.js";
import { faqDrafts, importChat } from "../../services/xo/whatsappService.js";

const SAMPLE = new URL("../../../seed/sample-whatsapp-android.txt", import.meta.url);
const SAMPLE_CSV = new URL("../../../seed/sample-complaint-diary.csv", import.meta.url);

/** POST /api/xo/import/whatsapp — dry run unless convert is true. */
export const whatsapp = asyncHandler(async (req, res) => {
  const text = req.body.sample ? await readFile(SAMPLE, "utf8") : req.body.text;
  const csv = req.body.sample && !req.body.csv ? await readFile(SAMPLE_CSV, "utf8") : req.body.csv;
  const out = await importChat(req.user, { text, csv, name: req.body.name || (req.body.sample ? "Sample: Hostel B · CSE 2022" : "WhatsApp group"), convert: req.body.convert === true });
  return ok(res, out, out.dryRun ? "Dry run — nothing written" : `Imported as ${out.batch}`);
});
export const drafts = asyncHandler(async (_req, res) => ok(res, await faqDrafts()));
