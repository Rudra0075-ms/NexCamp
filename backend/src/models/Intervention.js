import mongoose from "mongoose";
import { DECISIONS, INTERVENTION_STATUS, PRIORITIES } from "../config/constants.js";

// The AI's recommendation and the human's answer to it are stored separately on
// purpose: the product presents AI as decision support, not as an authority.
const interventionSchema = new mongoose.Schema(
  {
    reference: { type: String, unique: true, index: true },
    incident: { type: mongoose.Schema.Types.ObjectId, ref: "Incident", required: true, index: true },
    building: { type: mongoose.Schema.Types.ObjectId, ref: "Building" },

    recommendedAction: { type: String, required: true, trim: true },
    priority: { type: String, enum: PRIORITIES, default: "HIGH" },
    expectedImpact: { type: String, trim: true },
    estimatedResolutionHours: { type: Number, min: 0, default: 4 },
    confidence: { type: Number, min: 0, max: 100, default: 0 },
    owner: { type: String, trim: true },
    affectedStudents: { type: Number, min: 0, default: 0 },

    status: { type: String, enum: INTERVENTION_STATUS, default: "RECOMMENDED", index: true },

    decision: {
      value: { type: String, enum: DECISIONS },
      by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      byName: { type: String, trim: true },
      at: Date,
      reason: { type: String, trim: true },
      modifiedAction: { type: String, trim: true },
      modifiedWindowHours: { type: Number, min: 0 }
    },

    projection: {
      riskBefore: { type: Number, min: 0, max: 100 },
      riskAfter: { type: Number, min: 0, max: 100 },
      predictedComplaints: { type: Number, min: 0 },
      affectedStudents: { type: Number, min: 0 }
    },

    // Filled once the work is done; feeds resolution quality and campus memory.
    outcome: {
      resolutionTimeHours: Number,
      studentSatisfaction: { type: Number, min: 0, max: 100 },
      riskBefore: { type: Number, min: 0, max: 100 },
      riskAfter: { type: Number, min: 0, max: 100 },
      recurrence: { type: String, trim: true },
      complaintsAfterFix: { type: Number, min: 0 },
      completedAt: Date
    }
  },
  { timestamps: true }
);

interventionSchema.index({ status: 1, priority: 1, createdAt: -1 });

interventionSchema.pre("validate", async function assignReference(next) {
  if (this.reference) return next();
  const count = await this.constructor.estimatedDocumentCount();
  this.reference = `INT-${String(count + 1).padStart(4, "0")}`;
  next();
});

export const Intervention = mongoose.model("Intervention", interventionSchema);
