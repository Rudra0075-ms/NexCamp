import mongoose from "mongoose";
import {
  SUPPORT_BANDS,
  SUPPORT_CONTACT_TIMES,
  SUPPORT_ORIGINS,
  SUPPORT_OUTCOMES,
  SUPPORT_PREFERENCES,
  SUPPORT_STATUS
} from "../../config/constants.js";

/**
 * A private support request (Silent Support System).
 *
 *   REQUESTED → ASSIGNED → CONTACTED → FOLLOW_UP → RESOLVED   (or WITHDRAWN by the student)
 *
 * Kept in its own collection rather than the general request tracker on
 * purpose: the general trackers are readable by every staff role, and this one
 * must be readable only by the student and the support team (COUNSELLOR role).
 *
 * Minimum necessary data: no free-text from the student, no check-in answers
 * (only the band, and only if the student chose to share it). `anonymous`
 * hides the student's identity from the support team until the student says
 * otherwise; the reference to the student is kept only so the student can see
 * and withdraw their own request and receive replies in their inbox.
 */
const historySchema = new mongoose.Schema(
  {
    status: { type: String, enum: SUPPORT_STATUS, required: true },
    at: { type: Date, default: Date.now },
    byRole: { type: String, trim: true, maxlength: 40 }
  },
  { _id: false }
);

const supportCaseSchema = new mongoose.Schema(
  {
    reference: { type: String, unique: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    origin: { type: String, enum: SUPPORT_ORIGINS, default: "STUDENT_REQUEST" },
    preference: { type: String, enum: SUPPORT_PREFERENCES, required: true },
    anonymous: { type: Boolean, default: false },
    preferredTime: { type: String, enum: SUPPORT_CONTACT_TIMES, default: "ANY" },
    urgent: { type: Boolean, default: false, index: true },

    // Shared only with the student's consent (shareCheckIn on the request).
    band: { type: String, enum: SUPPORT_BANDS },
    repeatedDifficulty: { type: Boolean, default: false },

    status: { type: String, enum: SUPPORT_STATUS, default: "REQUESTED", index: true },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    followUpAt: { type: Date, index: true },
    followUpNotifiedAt: Date,
    outcome: { type: String, enum: SUPPORT_OUTCOMES },
    // Support-team working note. Never shown to the student, never to other
    // staff. Kept short and non-clinical by design (see the UI hint).
    teamNote: { type: String, trim: true, maxlength: 500 },
    history: { type: [historySchema], default: [] },
    closedAt: Date
  },
  { timestamps: true }
);

supportCaseSchema.index({ status: 1, followUpAt: 1 });

supportCaseSchema.pre("validate", function setReference(next) {
  if (!this.reference) {
    const tail = String(this._id).slice(-6).toUpperCase();
    this.reference = `SUP-${tail}`;
  }
  next();
});

export const SupportCase = mongoose.model("SupportCase", supportCaseSchema);
