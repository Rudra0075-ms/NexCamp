import mongoose from "mongoose";
import { historySchema } from "./common.js";

export const CLASS_CHANGE_TYPES = ["CANCEL", "RESCHEDULE", "ROOM"];

/** A change to one dated session of a scheduled class. */
const classChangeSchema = new mongoose.Schema(
  {
    reference: { type: String, unique: true, index: true },
    schedule: { type: mongoose.Schema.Types.ObjectId, ref: "ClassSchedule", required: true, index: true },
    // IST calendar date of the affected session, "YYYY-MM-DD".
    sessionDate: { type: String, required: true, index: true },
    type: { type: String, enum: CLASS_CHANGE_TYPES, required: true },
    newDate: { type: String, trim: true },
    newStartTime: { type: String, trim: true },
    newRoom: { type: String, trim: true },
    reason: { type: String, trim: true, maxlength: 300 },
    // Denormalised for queries and the notice audience.
    branch: String,
    year: Number,
    section: String,
    subject: String,
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    byName: String,
    notice: { type: mongoose.Schema.Types.ObjectId, ref: "Notice" },
    noticeReference: String,
    history: [historySchema]
  },
  { timestamps: true }
);

export const ClassChange = mongoose.model("ClassChange", classChangeSchema);
