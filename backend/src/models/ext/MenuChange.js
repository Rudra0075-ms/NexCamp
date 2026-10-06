import mongoose from "mongoose";
import { historySchema } from "./common.js";

/** A change to a planned meal, announced through the Notice Center. */
const menuChangeSchema = new mongoose.Schema(
  {
    reference: { type: String, unique: true, index: true },
    date: { type: String, required: true, index: true },
    meal: { type: String, enum: ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"], required: true },
    items: [{ type: String, trim: true }],
    replaces: [{ type: String, trim: true }],
    reason: { type: String, trim: true, maxlength: 300 },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    byName: String,
    notice: { type: mongoose.Schema.Types.ObjectId, ref: "Notice" },
    noticeReference: String,
    history: [historySchema]
  },
  { timestamps: true }
);

export const MenuChange = mongoose.model("MenuChange", menuChangeSchema);
