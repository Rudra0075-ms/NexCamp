import mongoose from "mongoose";
import { CHANNELS, historySchema } from "./common.js";

export const DOCUMENT_TYPES = ["BONAFIDE", "NO_DUES", "HOSTEL_RESIDENCE", "CHARACTER"];
export const DOCUMENT_STATUS = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "ISSUED"];
// Service-level target per type, in hours from submission to issue.
export const DOCUMENT_SLA_HOURS = { BONAFIDE: 24, NO_DUES: 72, HOSTEL_RESIDENCE: 48, CHARACTER: 72 };

const certificateSchema = new mongoose.Schema(
  {
    serial: { type: String, trim: true },
    verificationCode: { type: String, trim: true, index: true, unique: true, sparse: true },
    // SHA-256 of the canonical content. The content itself is not stored as a
    // separate copy; it is rebuilt from this record when verifying.
    digest: { type: String, trim: true },
    canonicalVersion: { type: Number, default: 1 },
    issuedAt: Date,
    issuedByName: { type: String, trim: true },
    revokedAt: Date,
    revokedByName: { type: String, trim: true },
    revocationReason: { type: String, trim: true, maxlength: 400 }
  },
  { _id: false }
);

const documentRequestSchema = new mongoose.Schema(
  {
    reference: { type: String, unique: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: DOCUMENT_TYPES, required: true },
    purpose: { type: String, required: true, trim: true, maxlength: 300 },
    status: { type: String, enum: DOCUMENT_STATUS, default: "SUBMITTED", index: true },
    channel: { type: String, enum: CHANNELS, default: "APP" },
    operator: { type: new mongoose.Schema({ name: String, role: String }, { _id: false }), default: undefined },
    reviewer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewerName: { type: String, trim: true },
    reviewedAt: Date,
    rejectionReason: { type: String, trim: true, maxlength: 400 },
    slaHours: { type: Number, min: 1 },
    dueAt: Date,
    // Frozen at submission so the certificate says what was true when asked.
    studentSnapshot: {
      name: String,
      studentId: String,
      course: String,
      department: String,
      semester: Number,
      hostelName: String,
      room: String
    },
    certificate: { type: certificateSchema, default: undefined },
    // EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md): who decided this request — the written
    // policy (Touchless Lane) or a person — and the policy engine's full verdict. Optional, no default.
    decidedBy: { type: String, enum: ["POLICY", "HUMAN"] },
    policyDecision: { type: mongoose.Schema.Types.Mixed, default: undefined },
    policyUndo: { type: mongoose.Schema.Types.Mixed, default: undefined },
    history: [historySchema]
  },
  { timestamps: true }
);

export const DocumentRequest = mongoose.model("DocumentRequest", documentRequestSchema);
