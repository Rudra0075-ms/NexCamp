import mongoose from "mongoose";

/**
 * A staff member's registered basic-phone number for the SMS work commands
 * (Phase 9: DONE <ref>, NEED PART <ref> <part>). Only numbers registered here
 * may close work by SMS; the label is what the student is told ("Plumber").
 */
const staffPhoneSchema = new mongoose.Schema(
  {
    staff: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    phone: { type: String, required: true, trim: true, unique: true },
    label: { type: String, trim: true, maxlength: 60, default: "Maintenance staff" },
    departments: { type: [String], default: [] },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

export const StaffPhone = mongoose.models.StaffPhone || mongoose.model("StaffPhone", staffPhoneSchema);
