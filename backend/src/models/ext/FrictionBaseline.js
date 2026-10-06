import mongoose from "mongoose";
import { historySchema } from "./common.js";

/**
 * How long a task took under the old process. Every row is an ESTIMATE with a
 * stated source; administrators can edit it and every edit is audited.
 */
const frictionBaselineSchema = new mongoose.Schema(
  {
    workflow: { type: String, required: true, unique: true, trim: true },
    task: { type: String, required: true, trim: true },
    oldProcess: { type: String, trim: true },
    hours: { type: Number, min: 0, required: true },
    studentActions: { type: Number, min: 0, default: 0 },
    // Minutes of the student's own time the old process takes (queues, visits).
    studentMinutes: { type: Number, min: 0, default: 0 },
    source: { type: String, trim: true, maxlength: 400 },
    label: { type: String, default: "BASELINE ESTIMATE" },    label: { type: String, default: "BASELINE ESTIMATE" },
    // EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md): the old path's shape, for the measured
    // Friction Ledger — hand-offs between people, staff touches and office visits. Optional.
    hops: { type: Number, min: 0 },
    touches: { type: Number, min: 0 },
    officeVisits: { type: Number, min: 0 },
    oldPath: [{ type: String, trim: true }],
    history: [historySchema]
  },
  { timestamps: true }
);

export const FrictionBaseline = mongoose.model("FrictionBaseline", frictionBaselineSchema);
