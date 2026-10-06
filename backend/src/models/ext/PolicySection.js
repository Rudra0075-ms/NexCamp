import mongoose from "mongoose";
import { historySchema } from "./common.js";

export const POLICY_CATEGORIES = ["HOSTEL", "FEES", "LEAVE", "CERTIFICATE", "MESS", "ACADEMIC"];

/** One citable section of the office policy corpus. */
const policySectionSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    category: { type: String, enum: POLICY_CATEGORIES, required: true },
    body: { type: String, required: true, trim: true, maxlength: 3000 },
    keywords: [{ type: String, trim: true, lowercase: true }],
    source: { type: String, trim: true, maxlength: 200 },
    version: { type: Number, default: 1 },
    updatedByName: String,
    history: [historySchema]
  },
  { timestamps: true }
);

export const PolicySection = mongoose.model("PolicySection", policySectionSchema);
