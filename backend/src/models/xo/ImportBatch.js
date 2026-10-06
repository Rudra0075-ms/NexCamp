import mongoose from "mongoose";

/** One converted chat import (Phase 7). Dry runs are not stored. */
const importBatchSchema = new mongoose.Schema(
  {
    reference: { type: String, unique: true, index: true },
    name: String,
    format: String,
    messages: Number,
    counts: { type: mongoose.Schema.Types.Mixed },
    result: { type: mongoose.Schema.Types.Mixed },
    byName: String
  },
  { timestamps: true }
);
export const ImportBatch = mongoose.models.ImportBatch || mongoose.model("ImportBatch", importBatchSchema);
