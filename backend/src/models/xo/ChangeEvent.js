import mongoose from "mongoose";
import { historySchema } from "../ext/common.js";

/**
 * One typed change and everything it touched (Phase 6 — change propagation).
 * A class cancellation, a menu change or a planned utility shutdown is recorded
 * once, and its consequences are computed and stored with it: the notice to
 * exactly the affected cohort, each affected student's attendance projection,
 * the mess demand estimate, the complaints linked to a planned shutdown.
 */
export const CHANGE_TYPES = ["CLASS_CANCEL", "CLASS_RESCHEDULE", "CLASS_ROOM", "MENU_CHANGE", "PLANNED_SHUTDOWN"];

const changeEventSchema = new mongoose.Schema(
  {
    reference: { type: String, unique: true, index: true },
    type: { type: String, enum: CHANGE_TYPES, required: true, index: true },
    title: { type: String, trim: true, maxlength: 200 },
    source: { type: new mongoose.Schema({ kind: String, id: String, reference: String }, { _id: false }), default: undefined },
    cohort: {
      branches: [String],
      years: [Number],
      sections: [String],
      hostels: [String]
    },
    // Planned shutdowns: where, what and when.
    buildingCode: { type: String, trim: true, uppercase: true, index: true },
    utility: { type: String, enum: ["WATER", "ELECTRICITY", "WI-FI", null], default: undefined },
    window: { type: new mongoose.Schema({ from: Date, to: Date }, { _id: false }), default: undefined },
    notice: { type: new mongoose.Schema({ id: String, reference: String, reach: Number, status: String }, { _id: false }), default: undefined },
    effects: { type: mongoose.Schema.Types.Mixed, default: undefined },
    linkedComplaints: [{ type: new mongoose.Schema({ id: String, reference: String, at: Date }, { _id: false }) }],
    byName: String,
    byRole: String,
    history: [historySchema]
  },
  { timestamps: true }
);

export const ChangeEvent = mongoose.models.ChangeEvent || mongoose.model("ChangeEvent", changeEventSchema);
