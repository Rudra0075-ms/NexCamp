import mongoose from "mongoose";
import { CATEGORIES, INCIDENT_STATUS, RISK_LEVELS, SEVERITIES } from "../config/constants.js";

const incidentSchema = new mongoose.Schema(
  {
    reference: { type: String, unique: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 2000 },

    category: { type: String, enum: CATEGORIES, required: true, index: true },
    building: { type: mongoose.Schema.Types.ObjectId, ref: "Building", index: true },

    complaints: [{ type: mongoose.Schema.Types.ObjectId, ref: "Complaint" }],
    status: { type: String, enum: INCIDENT_STATUS, default: "DETECTED", index: true },

    risk: { type: Number, min: 0, max: 100, default: 0 },
    riskLevel: { type: String, enum: RISK_LEVELS, default: "LOW" },
    severity: { type: String, enum: SEVERITIES, default: "MODERATE" },
    confidence: { type: Number, min: 0, max: 100, default: 0 },

    possibleCauses: [
      new mongoose.Schema(
        {
          cause: { type: String, trim: true },
          confidence: { type: Number, min: 0, max: 100 },
          basis: { type: String, trim: true }
        },
        { _id: false }
      )
    ],
    evidence: [
      new mongoose.Schema(
        {
          label: { type: String, trim: true },
          value: { type: String, trim: true },
          weight: { type: Number, min: 0, max: 100 },
          kind: {
            type: String,
            enum: ["ACTUAL DATA", "AI PREDICTION", "AI RECOMMENDATION", "EVIDENCE"],
            default: "EVIDENCE"
          }
        },
        { _id: false }
      )
    ],
    historicalMatches: [{ type: mongoose.Schema.Types.ObjectId, ref: "CampusMemory" }],

    affectedStudents: { type: Number, min: 0, default: 0 },
    predictedImpact: { type: String, trim: true },

    detectedAt: { type: Date, default: Date.now },
    firstComplaintAt: Date,
    clusteredAt: Date,

    resolution: {
      resolutionTimeHours: Number,
      resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      resolutionDescription: { type: String, trim: true },
      studentSatisfaction: { type: Number, min: 0, max: 100 },
      riskBefore: { type: Number, min: 0, max: 100 },
      riskAfter: { type: Number, min: 0, max: 100 },
      recurrence: { type: String, trim: true },
      complaintsAfterFix: { type: Number, min: 0 },
      resolvedAt: Date
    }
  },
  { timestamps: true }
);

incidentSchema.index({ risk: -1, status: 1 });
incidentSchema.index({ building: 1, category: 1 });

incidentSchema.pre("validate", async function assignReference(next) {
  if (this.reference) return next();
  const count = await this.constructor.estimatedDocumentCount();
  this.reference = `INC-${String(50 + count + 1).padStart(4, "0")}`;
  next();
});

export const Incident = mongoose.model("Incident", incidentSchema);
