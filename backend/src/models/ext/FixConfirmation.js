import mongoose from "mongoose";

export const FIX_RESPONSES = ["PENDING", "YES", "NOT_FIXED", "GREEN_FLAG", "RED_FLAG", "NO_RESPONSE"];

/** The complaint author's answer to "Is it fixed?". */
const fixConfirmationSchema = new mongoose.Schema(
  {
    complaint: { type: mongoose.Schema.Types.ObjectId, ref: "Complaint", required: true, unique: true },
    complaintReference: String,
    department: String,
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    askedAt: { type: Date, default: Date.now },
    response: { type: String, enum: FIX_RESPONSES, default: "PENDING", index: true },
    respondedAt: Date,
    comment: { type: String, trim: true, maxlength: 400 },
    reopen: { type: mongoose.Schema.Types.ObjectId, ref: "ReopenRequest" }
  },
  { timestamps: true }
);

export const FixConfirmation = mongoose.model("FixConfirmation", fixConfirmationSchema);
