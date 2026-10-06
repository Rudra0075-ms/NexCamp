import mongoose from "mongoose";

// One record per meal slot per day, which is what the demand curve reads.
const messRecordSchema = new mongoose.Schema(
  {
    date: { type: Date, required: true, index: true },
    time: { type: String, required: true, trim: true },
    meal: { type: String, enum: ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"], required: true },

    crowd: { type: Number, min: 0, default: 0 },
    capacity: { type: Number, min: 1, default: 850 },
    demand: { type: Number, min: 0, default: 0 },
    waste: { type: Number, min: 0, max: 100, default: 0 },
    queueMinutes: { type: Number, min: 0, default: 0 },

    menu: [
      new mongoose.Schema(
        {
          item: { type: String, trim: true },
          servings: { type: Number, min: 0 },
          takenPercentage: { type: Number, min: 0, max: 100 },
          // Set when the counter ran out of this item before service ended.
          soldOutAt: { type: String, trim: true }
        },
        { _id: false }
      )
    ],

    building: { type: mongoose.Schema.Types.ObjectId, ref: "Building" }
  },
  { timestamps: true }
);

messRecordSchema.index({ date: 1, time: 1 }, { unique: true });

export const MessRecord = mongoose.model("MessRecord", messRecordSchema);
