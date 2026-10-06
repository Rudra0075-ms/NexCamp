import mongoose from "mongoose";
import { historySchema } from "../ext/common.js";

/**
 * A small routine request that has no workflow of its own elsewhere — the
 * third Touchless Lane request type: a copy of a fee receipt already on the
 * ledger (page 16). Decided by policy when in-policy, by the accounts office
 * otherwise.
 */
export const SERVICE_TYPES = ["FEE_RECEIPT_COPY"];
export const SERVICE_STATUS = ["SUBMITTED", "UNDER_REVIEW", "FULFILLED", "REJECTED"];

const serviceRequestSchema = new mongoose.Schema(
  {
    reference: { type: String, unique: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: SERVICE_TYPES, required: true },
    // For FEE_RECEIPT_COPY: the receipt number on the fee ledger.
    receipt: { type: String, trim: true, maxlength: 40 },
    purpose: { type: String, trim: true, maxlength: 300 },
    status: { type: String, enum: SERVICE_STATUS, default: "SUBMITTED", index: true },
    channel: { type: String, enum: ["APP", "KIOSK", "SMS"], default: "APP" },
    decidedBy: { type: String, enum: ["POLICY", "HUMAN"] },
    decidedByName: { type: String, trim: true },
    decidedAt: Date,
    policyDecision: { type: mongoose.Schema.Types.Mixed, default: undefined },
    policyUndo: { type: mongoose.Schema.Types.Mixed, default: undefined },
    rejectionReason: { type: String, trim: true, maxlength: 400 },
    // What was handed over: the receipt's details, re-stated from the ledger.
    output: { type: mongoose.Schema.Types.Mixed, default: undefined },
    history: [historySchema]
  },
  { timestamps: true }
);

export const ServiceRequest = mongoose.models.ServiceRequest || mongoose.model("ServiceRequest", serviceRequestSchema);
