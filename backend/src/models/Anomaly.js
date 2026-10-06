import mongoose from "mongoose";

// A silent problem: a metric moving in a way that historically preceded a
// failure, before any student has complained.
const anomalySchema = new mongoose.Schema(
  {
    building: { type: mongoose.Schema.Types.ObjectId, ref: "Building", required: true, index: true },
    metric: { type: String, required: true, trim: true },
    signal: { type: String, required: true, trim: true },

    baseline: { type: Number },
    current: { type: Number },
    changePercentage: { type: Number },
    direction: { type: String, enum: ["UP", "DOWN", "FLAT"], default: "FLAT" },

    historicalPattern: { type: String, trim: true },
    matchedMemory: { type: mongoose.Schema.Types.ObjectId, ref: "CampusMemory" },

    predictedRisk: { type: Number, min: 0, max: 100, default: 0 },
    confidence: { type: Number, min: 0, max: 100, default: 0 },
    complaintsSoFar: { type: Number, min: 0, default: 0 },
    recommendedAction: { type: String, trim: true },
    daysObserved: { type: Number, min: 0, default: 0 },

    // Rule-based, and labelled as such everywhere it is returned.
    method: { type: String, default: "RULE_BASED_THRESHOLD" },
    status: {
      type: String,
      enum: ["OPEN", "ACKNOWLEDGED", "CONFIRMED", "DISMISSED", "RESOLVED"],
      default: "OPEN"
    },
    detectedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

anomalySchema.index({ predictedRisk: -1, status: 1 });

export const Anomaly = mongoose.model("Anomaly", anomalySchema);
