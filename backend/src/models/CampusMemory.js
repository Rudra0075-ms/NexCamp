import mongoose from "mongoose";
import { CATEGORIES } from "../config/constants.js";

// What the campus remembers after an incident closes. `signatures` are the
// short phrases the frontend staggers in when a pattern is stored.
const campusMemorySchema = new mongoose.Schema(
  {
    incident: { type: mongoose.Schema.Types.ObjectId, ref: "Incident" },
    incidentReference: { type: String, trim: true },
    occurredOn: { type: Date, required: true, index: true },

    incidentType: { type: String, required: true, trim: true },
    category: { type: String, enum: CATEGORIES, required: true, index: true },
    building: { type: mongoose.Schema.Types.ObjectId, ref: "Building", index: true },
    buildingName: { type: String, trim: true },

    cause: { type: String, trim: true },
    resolution: { type: String, trim: true },
    resolutionTimeHours: { type: Number, min: 0 },
    outcome: { type: String, trim: true },

    riskBefore: { type: Number, min: 0, max: 100 },
    riskAfter: { type: Number, min: 0, max: 100 },
    studentSatisfaction: { type: Number, min: 0, max: 100 },
    recurrence: { type: String, trim: true },
    recurrenceCount: { type: Number, min: 0, default: 0 },

    // Keyword signature used by the deterministic similarity search.
    signatures: [{ type: String, trim: true }],
    keywords: [{ type: String, trim: true, lowercase: true }],
    // ROUND-3 HOOK (see CHANGES-ROUND3.md): the difference-in-differences effect of the fix, when measured. Optional.
    measuredEffect: { type: mongoose.Schema.Types.Mixed, default: undefined }
  },
  { timestamps: true }
);

campusMemorySchema.index({ building: 1, category: 1, occurredOn: -1 });

export const CampusMemory = mongoose.model("CampusMemory", campusMemorySchema);
