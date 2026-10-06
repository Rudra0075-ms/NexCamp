import mongoose from "mongoose";
import { CATEGORIES, RISK_LEVELS } from "../config/constants.js";

// A risk score is a snapshot, not a mutable field: the frontend animates change
// over time, so history has to be queryable.
const riskSchema = new mongoose.Schema(
  {
    building: { type: mongoose.Schema.Types.ObjectId, ref: "Building", index: true },
    scope: { type: String, enum: ["BUILDING", "CAMPUS", "DOMAIN"], default: "BUILDING" },
    domainLabel: { type: String, trim: true },
    category: { type: String, enum: CATEGORIES, default: "OTHER" },

    riskScore: { type: Number, min: 0, max: 100, required: true },
    riskLevel: { type: String, enum: RISK_LEVELS, default: "LOW" },
    prediction: { type: String, trim: true },
    confidence: { type: Number, min: 0, max: 100, default: 0 },
    affectedStudents: { type: Number, min: 0, default: 0 },

    incident: { type: mongoose.Schema.Types.ObjectId, ref: "Incident" },
    timestamp: { type: Date, default: Date.now, index: true }
  },
  { timestamps: true }
);

riskSchema.index({ building: 1, timestamp: -1 });
riskSchema.index({ scope: 1, timestamp: -1 });

export const Risk = mongoose.model("Risk", riskSchema);
