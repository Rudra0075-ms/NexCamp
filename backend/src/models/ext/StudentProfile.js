import mongoose from "mongoose";

/**
 * Academic grouping and registered phone for one student.
 *
 * Kept in its own collection so that no existing User document is edited.
 * When a student has no profile row, services/ext/profileService.js derives the
 * same fields read-only from the User record and says so (`source: DERIVED`).
 */
const studentProfileSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    branch: { type: String, trim: true, uppercase: true },
    year: { type: Number, min: 1, max: 6 },
    batch: { type: String, trim: true },
    section: { type: String, trim: true, uppercase: true },
    // The number the SMS keyword channel accepts commands from. Demo numbers in
    // the seed are placeholders in the +91 90000 00xxx range.
    registeredPhone: { type: String, trim: true, index: true },
    source: { type: String, default: "RECORDED" }
  },
  { timestamps: true }
);

export const StudentProfile = mongoose.model("StudentProfile", studentProfileSchema);
