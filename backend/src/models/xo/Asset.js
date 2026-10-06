import mongoose from "mongoose";
import { historySchema } from "../ext/common.js";

/**
 * A piece of campus equipment that fails and gets repaired (Phase 4 — asset
 * repair history). Failures are not stored here: they are read from resolved
 * complaints and campus-memory records that mention the asset. Costs are
 * ASSUMPTION figures a college replaces with its own quotations.
 */
const assetSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    buildingCode: { type: String, trim: true, uppercase: true },
    category: { type: String, trim: true },
    // Lower-case phrases that identify this asset in a complaint or memory record.
    keywords: [{ type: String, trim: true, lowercase: true }],
    installedOn: Date,
    replacementCost: { type: Number, min: 0 },
    typicalRepairCost: { type: Number, min: 0 },
    costSource: { type: String, trim: true, default: "ASSUMPTION — demo figures; replace with the college's own quotations" },
    history: [historySchema]
  },
  { timestamps: true }
);

export const Asset = mongoose.models.Asset || mongoose.model("Asset", assetSchema);
