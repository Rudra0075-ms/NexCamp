import mongoose from "mongoose";
import { historySchema } from "./common.js";

/** Optional evidence that a resolved complaint was actually fixed. */
const fixProofSchema = new mongoose.Schema(
  {
    complaint: { type: mongoose.Schema.Types.ObjectId, ref: "Complaint", required: true, index: true },
    complaintReference: String,
    department: String,
    note: { type: String, trim: true, maxlength: 600 },
    // Compressed on the client; capped server-side (see fixService.js).
    photo: { type: String },
    photoBytes: Number,
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    byName: String,
    byRole: String,
    history: [historySchema]
  },
  { timestamps: true }
);

export const FixProof = mongoose.model("FixProof", fixProofSchema);
