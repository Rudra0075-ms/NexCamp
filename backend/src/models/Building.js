import mongoose from "mongoose";
import { RISK_LEVELS } from "../config/constants.js";

// One record per campus block. `code` is the id the frontend's map uses, so it
// is the stable public key; `mapId` matches the SVG/WebGL geometry keys.
const buildingSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    mapId: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    type: {
      type: String,
      enum: ["HOSTEL", "ACADEMIC", "MESS", "LIBRARY", "ADMIN", "MEDICAL", "SPORTS", "OTHER"],
      default: "OTHER"
    },
    domain: { type: String, trim: true },
    location: { type: String, trim: true },
    capacity: { type: Number, min: 0, default: 0 },
    occupancy: { type: Number, min: 0, default: 0 },

    currentRisk: { type: Number, min: 0, max: 100, default: 0 },
    riskLevel: { type: String, enum: RISK_LEVELS, default: "LOW" },
    activeProblems: { type: Number, min: 0, default: 0 },
    historicalProblems: { type: Number, min: 0, default: 0 },
    affectedStudents: { type: Number, min: 0, default: 0 },

    // Which departments own complaints raised here.
    departments: [{ type: String, trim: true }],

    // Map geometry the frontend already draws. Stored so the campus can grow
    // without a frontend change.
    geometry: {
      x: Number,
      y: Number,
      w: Number,
      d: Number,
      h: Number
    }
  },
  { timestamps: true }
);

buildingSchema.index({ currentRisk: -1 });

export const Building = mongoose.model("Building", buildingSchema);
