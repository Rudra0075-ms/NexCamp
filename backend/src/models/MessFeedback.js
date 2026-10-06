import mongoose from "mongoose";

export const MESS_MEALS = ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"];

// The themes a comment can be filed under. Assigned by the keyword rules in
// messIntelligenceService.js, never typed in by the student, so the counts on
// the Mess page are comparable across days.
export const MESS_FEEDBACK_THEMES = [
  "TASTE",
  "QUANTITY",
  "VARIETY",
  "TEMPERATURE",
  "HYGIENE",
  "QUEUE",
  "AVAILABILITY",
  "OTHER"
];

// One student's rating of one meal on one day.
const messFeedbackSchema = new mongoose.Schema(
  {
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    date: { type: Date, required: true, index: true },
    meal: { type: String, enum: MESS_MEALS, required: true },
    rating: { type: Number, min: 1, max: 5, required: true },
    comment: { type: String, trim: true, maxlength: 500 },

    // Derived on save, so every reader sees the same classification.
    themes: [{ type: String, enum: MESS_FEEDBACK_THEMES }],
    sentiment: { type: String, enum: ["POSITIVE", "NEUTRAL", "NEGATIVE"] },
    method: { type: String, default: "KEYWORD_THEMES + LEXICON_SENTIMENT" }
  },
  { timestamps: true }
);

messFeedbackSchema.index({ date: 1, meal: 1 });
// One rating per student per meal per day; a second submission updates it.
messFeedbackSchema.index({ student: 1, date: 1, meal: 1 }, { unique: true, partialFilterExpression: { student: { $exists: true } } });

export const MessFeedback = mongoose.model("MessFeedback", messFeedbackSchema);
