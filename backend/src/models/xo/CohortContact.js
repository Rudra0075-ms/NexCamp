import mongoose from "mongoose";

/**
 * A student who relays to their cohort — the class representative of a
 * branch/year/section (Phase 5, the third rung of the reach ladder).
 */
const cohortContactSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    role: { type: String, enum: ["CLASS_REP"], default: "CLASS_REP" },
    branch: { type: String, trim: true, uppercase: true },
    year: Number,
    section: { type: String, trim: true, uppercase: true }
  },
  { timestamps: true }
);
cohortContactSchema.index({ branch: 1, year: 1, section: 1, role: 1 }, { unique: true });

export const CohortContact = mongoose.models.CohortContact || mongoose.model("CohortContact", cohortContactSchema);
