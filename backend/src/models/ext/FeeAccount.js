import mongoose from "mongoose";
import { historySchema } from "./common.js";

export const FEE_HEADS = ["TUITION", "HOSTEL", "MESS", "FINES"];

const paymentSchema = new mongoose.Schema(
  { amount: { type: Number, min: 0 }, at: Date, receipt: String, mode: String },
  { _id: false }
);

const headSchema = new mongoose.Schema(
  {
    head: { type: String, enum: FEE_HEADS, required: true },
    label: { type: String, trim: true },
    amount: { type: Number, min: 0, required: true },
    paid: { type: Number, min: 0, default: 0 },
    dueDate: Date,
    payments: [paymentSchema],
    remindedFor: [{ type: String }]
  },
  { _id: false }
);

/** One student's fee ledger for an academic year. Read-only in the app. */
const feeAccountSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    academicYear: { type: String, required: true },
    heads: [headSchema],
    history: [historySchema]
  },
  { timestamps: true }
);

feeAccountSchema.index({ student: 1, academicYear: 1 }, { unique: true });

export const FeeAccount = mongoose.model("FeeAccount", feeAccountSchema);
