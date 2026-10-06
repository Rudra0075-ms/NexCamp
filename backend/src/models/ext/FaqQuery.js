import mongoose from "mongoose";

/** One question asked of the office FAQ assistant, for the most-asked view. */
const faqQuerySchema = new mongoose.Schema(
  {
    question: { type: String, trim: true, maxlength: 400 },
    normalised: { type: String, trim: true, index: true },
    lang: { type: String, trim: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    answered: { type: Boolean, default: false, index: true },
    sectionKey: String,
    score: Number,
    requestReference: String
  },
  { timestamps: true }
);

export const FaqQuery = mongoose.model("FaqQuery", faqQuerySchema);
