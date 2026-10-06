import mongoose from "mongoose";
import { historySchema } from "./common.js";

/**
 * Raised when a student says a resolved complaint is NOT FIXED. The original
 * complaint is left exactly as it is; this is a new, linked record.
 */
const reopenRequestSchema = new mongoose.Schema(
  {
    reference: { type: String, unique: true, index: true },
    complaint: { type: mongoose.Schema.Types.ObjectId, ref: "Complaint", required: true, index: true },
    complaintReference: String,
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    department: String,
    reason: { type: String, trim: true, maxlength: 600 },
    status: { type: String, enum: ["OPEN", "ACKNOWLEDGED", "CLOSED"], default: "OPEN", index: true },
    slaHours: { type: Number, default: 24 },
    notice: { type: mongoose.Schema.Types.ObjectId, ref: "Notice" },
    history: [historySchema]
  },
  { timestamps: true }
);

export const ReopenRequest = mongoose.model("ReopenRequest", reopenRequestSchema);
