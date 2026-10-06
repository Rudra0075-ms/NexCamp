import mongoose from "mongoose";

/**
 * Round 3 (F5): a student accepted a "best time to eat" suggestion. Used only
 * to measure whether suggestions flatten the peak; never shown per person to
 * anyone else.
 */
const slotNudgeSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    date: { type: String, required: true },
    meal: { type: String, enum: ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"], required: true },
    slot: { type: String, required: true },
    peakSlot: { type: String },
    expectedQueueMinutes: Number
  },
  { timestamps: true }
);

slotNudgeSchema.index({ student: 1, date: 1, meal: 1 }, { unique: true });

export const SlotNudge = mongoose.models.SlotNudge || mongoose.model("SlotNudge", slotNudgeSchema);
