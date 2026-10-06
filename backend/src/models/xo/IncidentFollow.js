import mongoose from "mongoose";

/**
 * A student who, instead of filing a duplicate, attached themselves to a known
 * open incident ("+1 & Follow", page 05). Kept in its own collection so no
 * Incident document is edited.
 */
const incidentFollowSchema = new mongoose.Schema(
  {
    incident: { type: mongoose.Schema.Types.ObjectId, ref: "Incident", required: true, index: true },
    incidentReference: String,
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    note: { type: String, trim: true, maxlength: 400 },
    room: { type: String, trim: true, maxlength: 60 },
    channel: { type: String, enum: ["APP", "KIOSK", "SMS"], default: "APP" }
  },
  { timestamps: true }
);
incidentFollowSchema.index({ incident: 1, student: 1 }, { unique: true });

export const IncidentFollow = mongoose.models.IncidentFollow || mongoose.model("IncidentFollow", incidentFollowSchema);
