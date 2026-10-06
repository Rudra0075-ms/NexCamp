import mongoose from "mongoose";

/**
 * One thing that happened on campus, in one shape (Phase 1 — the Campus Event
 * log). Emitted by the existing controllers and services as they work, and
 * derived for older records by the backfill. The Friction Ledger, ETAs,
 * process mining and the Touchless Rate are all computed from this log.
 *
 * `humanTouch` is true when a staff member acted on the subject (approved,
 * reviewed, resolved, assigned…). A POLICY decision is never a human touch.
 */
export const EVENT_CHANNELS = ["APP", "KIOSK", "SMS", "POLICY", "IMPORT", "SYSTEM"];

export const EVENT_TYPES = [
  // complaints
  "COMPLAINT_CREATED", "COMPLAINT_CLASSIFIED", "COMPLAINT_ASSIGNED", "COMPLAINT_STATUS_CHANGED", "COMPLAINT_RESOLVED",
  "COMPLAINT_REOPENED", "COMPLAINT_CONFIRMED_FIXED", "COMPLAINT_FOLLOWED", "COMPLAINT_LINKED_TO_CHANGE", "COMPLAINT_DEFLECTED",
  "COMPLAINT_WORK_DONE", "COMPLAINT_NEEDS_PART",
  // gate passes
  "GATEPASS_APPLIED", "GATEPASS_OTP_VERIFIED", "GATEPASS_APPROVED", "GATEPASS_REJECTED", "GATEPASS_EXITED", "GATEPASS_RETURNED", "GATEPASS_OVERDUE",
  // certificates and documents
  "CERTIFICATE_REQUESTED", "CERTIFICATE_REVIEWED", "CERTIFICATE_ISSUED", "CERTIFICATE_REJECTED",
  // notices
  "NOTICE_PUBLISHED", "NOTICE_DELIVERED", "NOTICE_READ", "NOTICE_ACTED", "NOTICE_ESCALATED",
  // fees
  "FEE_STATUS_VIEWED", "FEES_CLEARED",
  // changes
  "CLASS_CHANGED", "MENU_CHANGED", "SHUTDOWN_PLANNED",
  // channels
  "KIOSK_REQUEST", "SMS_REQUEST",
  // policy lane
  "POLICY_DECISION", "POLICY_UNDONE",
  // other requests
  "SERVICE_REQUESTED", "SERVICE_FULFILLED"
];

const campusEventSchema = new mongoose.Schema(
  {
    type: { type: String, enum: EVENT_TYPES, required: true, index: true },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    actorRole: { type: String, trim: true, default: "SYSTEM" },
    actorName: { type: String, trim: true },
    subjectType: { type: String, trim: true, required: true, index: true },
    subjectId: { type: String, trim: true, required: true, index: true },
    subjectRef: { type: String, trim: true },
    // The student the subject belongs to, when there is one.
    studentId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    channel: { type: String, enum: EVENT_CHANNELS, default: "APP", index: true },
    cohort: {
      hostel: { type: String, trim: true },
      branch: { type: String, trim: true },
      year: Number,
      section: { type: String, trim: true }
    },
    department: { type: String, trim: true },
    humanTouch: { type: Boolean, default: false, index: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: undefined },
    at: { type: Date, default: Date.now, index: true },
    // The hash-chained audit entry this event mirrors, when there is one ("#123").
    auditRef: { type: String, trim: true },
    // LIVE when emitted by the workflow as it ran; BACKFILL when derived later from stored records.
    origin: { type: String, enum: ["LIVE", "BACKFILL"], default: "LIVE", index: true }
  },
  { timestamps: false, versionKey: false }
);

campusEventSchema.index({ subjectType: 1, subjectId: 1, at: 1 });
campusEventSchema.index({ type: 1, at: -1 });

export const CampusEvent = mongoose.models.CampusEvent || mongoose.model("CampusEvent", campusEventSchema);
