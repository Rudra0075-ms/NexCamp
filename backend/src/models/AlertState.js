import mongoose from "mongoose";

/**
 * What an operator did about an early-warning alert.
 *
 * Alerts themselves are recomputed from records on every read (see
 * services/earlyWarningService.js), so only the human decision is stored here,
 * keyed by the alert's stable key — "recurring:HSTB::WATER", "trend:messRating".
 */
const alertStateSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true, maxlength: 160 },
    status: {
      type: String,
      enum: ["ACKNOWLEDGED", "INVESTIGATING", "ASSIGNED", "ESCALATED", "RESOLVED"],
      required: true
    },
    department: { type: String, trim: true },
    note: { type: String, trim: true, maxlength: 400 },
    // The tier when the action was taken, so a resolved alert that later gets
    // worse can reopen itself.
    tierAtAction: { type: String, trim: true },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    byName: { type: String, trim: true },
    history: [
      new mongoose.Schema(
        {
          at: { type: Date, default: Date.now },
          action: { type: String, trim: true },
          byName: { type: String, trim: true },
          note: { type: String, trim: true },
          complaintsTouched: { type: Number, min: 0, default: 0 }
        },
        { _id: false }
      )
    ]
  },
  { timestamps: true }
);

export const AlertState = mongoose.model("AlertState", alertStateSchema);
