import mongoose from "mongoose";
import { historySchema } from "./common.js";

export const NOTICE_PRIORITIES = ["CRITICAL", "HIGH", "NORMAL", "INFO"];
export const NOTICE_STATUS = ["SCHEDULED", "HELD_QUIET_HOURS", "PUBLISHED", "CANCELLED"];
export const NOTICE_KINDS = ["GENERAL", "CLASS_CHANGE", "MENU_CHANGE", "FEE_REMINDER", "REOPEN", "DIGEST"];

const audienceSchema = new mongoose.Schema(
  {
    branches: [{ type: String, trim: true, uppercase: true }],
    years: [{ type: Number }],
    hostels: [{ type: String, trim: true, uppercase: true }],
    batches: [{ type: String, trim: true }],
    sections: [{ type: String, trim: true, uppercase: true }],
    roles: [{ type: String, trim: true, uppercase: true }],
    // Staff queues (User.managedDepartment) — used to notify a department.
    departments: [{ type: String, trim: true }],
    // Explicit recipients (a fee reminder to one student).
    users: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }]
  },
  { _id: false }
);

const noticeSchema = new mongoose.Schema(
  {
    reference: { type: String, unique: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    priority: { type: String, enum: NOTICE_PRIORITIES, default: "NORMAL", index: true },
    kind: { type: String, enum: NOTICE_KINDS, default: "GENERAL" },
    audience: { type: audienceSchema, default: () => ({}) },
    actionRequired: {
      type: new mongoose.Schema({ label: { type: String, trim: true, maxlength: 80 }, deadline: Date }, { _id: false }),
      default: undefined
    },
    author: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    authorName: { type: String, trim: true },
    authorRole: { type: String, trim: true },
    scheduledFor: Date,
    status: { type: String, enum: NOTICE_STATUS, default: "PUBLISHED", index: true },
    heldForQuietHours: { type: Boolean, default: false },
    releaseAt: Date,
    publishedAt: Date,
    // Set when a notice held for quiet hours is released with the morning digest.
    digestBatch: { type: String, trim: true },
    // Hours an unread CRITICAL / action-required notice waits before SMS.
    escalateAfterHours: { type: Number, min: 0.05, max: 168, default: 6 },
    escalatedAt: Date,
    reach: { type: Number, default: 0 },
    related: {
      type: new mongoose.Schema({ kind: String, id: String, reference: String }, { _id: false }),
      default: undefined
    },
    // EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md): guaranteed reach — a target share of
    // the audience to reach by a deadline, walked up an escalation ladder; and supersession.
    // All optional, no defaults: an existing notice is exactly as it was.
    reachTarget: { type: new mongoose.Schema({ pct: { type: Number, min: 1, max: 100 }, deadline: Date, reachedAt: Date }, { _id: false }), default: undefined },
    supersedes: { type: new mongoose.Schema({ id: String, reference: String, title: String }, { _id: false }), default: undefined },
    supersededBy: { type: new mongoose.Schema({ id: String, reference: String, title: String, at: Date }, { _id: false }), default: undefined },
    quietHoursOverride: { type: new mongoose.Schema({ byName: String, at: Date, reason: String }, { _id: false }), default: undefined },
    history: [historySchema]
  },
  { timestamps: true }
);

noticeSchema.index({ status: 1, releaseAt: 1 });
noticeSchema.index({ status: 1, scheduledFor: 1 });

export const Notice = mongoose.model("Notice", noticeSchema);
