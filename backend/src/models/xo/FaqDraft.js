import mongoose from "mongoose";

/**
 * A question students kept asking — from an imported chat (Phase 7) or the
 * knowledge-gap loop — waiting for an office answer before it becomes a cited
 * FAQ section on page 19.
 */
const faqDraftSchema = new mongoose.Schema(
  {
    question: { type: String, required: true, trim: true, maxlength: 400 },
    times: { type: Number, default: 1 },
    askers: Number,
    terms: [String],
    evidence: [String],
    source: String,
    status: { type: String, enum: ["DRAFT", "ANSWERED", "DISMISSED"], default: "DRAFT", index: true },
    answer: { type: String, trim: true, maxlength: 3000 },
    sectionKey: String,
    answeredByName: String
  },
  { timestamps: true }
);
export const FaqDraft = mongoose.models.FaqDraft || mongoose.model("FaqDraft", faqDraftSchema);
