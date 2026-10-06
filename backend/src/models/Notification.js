import mongoose from "mongoose";
import {
  NOTIFICATION_AUDIENCES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_KINDS,
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_PRIORITY_SOURCES
} from "../config/constants.js";

// Alerts the backend raises on its own schedule — the five-minute warning and
// the overdue alarm — so they do not depend on a browser tab staying open.
const notificationSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: NOTIFICATION_KINDS, required: true, index: true },
    audience: { type: String, enum: NOTIFICATION_AUDIENCES, required: true, index: true },
    channel: { type: String, enum: NOTIFICATION_CHANNELS, default: "IN_APP" },

    // Who should see it in-app. Absent for PARENT notifications, which only
    // ever leave over SMS.
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    gatePass: { type: mongoose.Schema.Types.ObjectId, ref: "GatePass", index: true },

    title: { type: String, required: true, trim: true, maxlength: 160 },
    body: { type: String, trim: true, maxlength: 600 },
    tone: { type: String, enum: ["low", "mid", "high"], default: "mid" },

    // ---- priority --------------------------------------------------------
    // Graded by services/notificationPriority.js when the row is created. The
    // existing `tone` field is untouched, so anything already reading it keeps
    // working; `priority` is what the new UI sorts and colours by.
    //
    // MEDIUM is the default rather than nothing, so rows written before this
    // field existed still sort sensibly instead of disappearing from a filter.
    priority: { type: String, enum: NOTIFICATION_PRIORITIES, default: "MEDIUM", index: true },
    prioritySource: { type: String, enum: NOTIFICATION_PRIORITY_SOURCES, default: "RULE_BASED" },
    priorityReason: { type: String, trim: true, maxlength: 400 },

    // Free-form context for non-gate-pass notifications (which complaint raised
    // this, for instance). Typed loosely on purpose: the gate-pass rows that
    // predate it simply leave it unset.
    meta: { type: mongoose.Schema.Types.Mixed },

    readAt: Date,
    deliveredAt: Date,
    deliveryMode: { type: String, trim: true },
    deliveryError: { type: String, trim: true }
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ user: 1, priority: 1, createdAt: -1 });

export const Notification = mongoose.model("Notification", notificationSchema);
