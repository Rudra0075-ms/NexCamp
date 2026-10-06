import mongoose from "mongoose";
import {
  AI_SOURCE_VALUES,
  CATEGORIES,
  COMPLAINT_STATUS,
  DEPARTMENTS,
  DUPLICATE_DECISIONS,
  PRIORITIES,
  ROUTING_DECISIONS,
  SEVERITIES
} from "../config/constants.js";

// `aiClassification` is kept as its own sub-document so the frontend can always
// tell an inferred value apart from something a human or a sensor stated.
const classificationSchema = new mongoose.Schema(
  {
    category: { type: String, enum: CATEGORIES },
    subCategory: { type: String, trim: true },
    priority: { type: String, enum: PRIORITIES },
    severity: { type: String, enum: SEVERITIES },
    duplicateProbability: { type: Number, min: 0, max: 100, default: 0 },
    affectedArea: { type: String, trim: true },
    routedTo: { type: String, trim: true },
    slaHours: { type: Number, min: 0 },
    confidence: { type: Number, min: 0, max: 100, default: 0 },
    // Honest label for how the values above were produced.
    method: { type: String, default: "RULE_BASED_KEYWORD_MATCH" },
    reasons: [{ type: String, trim: true }],
    classifiedAt: Date,

    // ---- AI provenance ---------------------------------------------------
    // Which of the three sources actually produced this block. Absent on rows
    // written before the AI layer existed, which is why there is no default:
    // the API reports a missing value as "not recorded" rather than inventing
    // one. See config/constants.js AI_SOURCES.
    source: { type: String, enum: AI_SOURCE_VALUES },
    // Only ever set when source is AI_MODEL, so the interface can never print a
    // model name that did not do the work.
    provider: { type: String, trim: true },
    model: { type: String, trim: true },
    // Where `confidence` came from: a rule-based signal count, or the model's
    // own reported certainty.
    confidenceBasis: { type: String, trim: true },
    suggestedAction: { type: String, trim: true, maxlength: 300 },
    // Set when a deterministic safety rule fixed the priority. A model cannot
    // clear this.
    safetyRule: { type: String, trim: true },
    escalated: { type: Boolean, default: false },
    processedAt: Date
  },
  { _id: false }
);

const evidenceSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true },
    value: { type: String, trim: true },
    kind: {
      type: String,
      enum: ["ACTUAL DATA", "AI PREDICTION", "AI RECOMMENDATION", "EVIDENCE"],
      default: "EVIDENCE"
    },
    at: { type: Date, default: Date.now }
  },
  { _id: false }
);

// What the AI recommended for routing, what a human finally decided, and who
// decided it. Both values are kept: the recommendation is never overwritten by
// the override, so "who changed the AI's mind, and when" stays answerable.
const routingSchema = new mongoose.Schema(
  {
    recommendedDepartment: { type: String, enum: DEPARTMENTS },
    recommendedBy: { type: String, trim: true },
    recommendedAt: Date,
    finalDepartment: { type: String, enum: DEPARTMENTS },
    decision: { type: String, enum: ROUTING_DECISIONS },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    decidedByName: { type: String, trim: true },
    decidedByRole: { type: String, trim: true },
    decidedAt: Date,
    note: { type: String, trim: true, maxlength: 400 }
  },
  { _id: false }
);

// An administrator's verdict on a suspected duplicate. Nothing is deleted
// either way — LINKED records the relationship, SEPARATE dismisses it.
const duplicateReviewSchema = new mongoose.Schema(
  {
    decision: { type: String, enum: DUPLICATE_DECISIONS },
    relatedComplaint: { type: mongoose.Schema.Types.ObjectId, ref: "Complaint" },
    relatedReference: { type: String, trim: true },
    similarity: { type: Number, min: 0, max: 100 },
    decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    decidedByName: { type: String, trim: true },
    decidedAt: Date,
    note: { type: String, trim: true, maxlength: 400 }
  },
  { _id: false }
);

const complaintSchema = new mongoose.Schema(
  {
    reference: { type: String, unique: true, index: true },
    student: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },

    title: { type: String, required: true, trim: true, maxlength: 160 },
    description: { type: String, required: true, trim: true, maxlength: 2000 },

    // What the student picked. The AI's own read lives in aiClassification.
    category: { type: String, enum: CATEGORIES, default: "OTHER", index: true },
    subCategory: { type: String, trim: true },
    location: { type: String, trim: true },
    // How the report reached the system. Absent on rows filed in the app before
    // the assisted-access kiosk existed; KIOSK marks one filed at a help desk.
    channel: { type: String, enum: ["APP", "KIOSK", /* EXTENSION HOOK: SMS keyword channel */ "SMS"] },
    building: { type: mongoose.Schema.Types.ObjectId, ref: "Building", index: true },

    priority: { type: String, enum: PRIORITIES, default: "MEDIUM" },
    severity: { type: String, enum: SEVERITIES, default: "MODERATE" },
    status: { type: String, enum: COMPLAINT_STATUS, default: "PENDING", index: true },

    department: { type: String, enum: DEPARTMENTS },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    relatedIncident: { type: mongoose.Schema.Types.ObjectId, ref: "Incident", index: true },

    aiClassification: { type: classificationSchema, default: () => ({}) },
    // Feature 2: the AI's routing recommendation and the human's final call.
    aiRouting: { type: routingSchema, default: undefined },
    // Feature 3: what an administrator decided about a suspected duplicate.
    duplicateReview: { type: duplicateReviewSchema, default: undefined },
    duplicateProbability: { type: Number, min: 0, max: 100, default: 0 },
    duplicateOf: { type: mongoose.Schema.Types.ObjectId, ref: "Complaint" },

    evidence: [evidenceSchema],
    audit: [
      new mongoose.Schema(
        {
          at: { type: Date, default: Date.now },
          actor: { type: String, trim: true },
          message: { type: String, trim: true },
          kind: {
            type: String,
            enum: ["ACTUAL DATA", "AI PREDICTION", "AI RECOMMENDATION", "EVIDENCE"],
            default: "ACTUAL DATA"
          }
        },
        { _id: false }
      )
    ],

    // Feature 17: the author's own rating of a resolved complaint. Absent until
    // they leave one; never written by staff or by the system.
    feedback: {
      type: new mongoose.Schema(
        {
          rating: { type: Number, min: 1, max: 5, required: true },
          comment: { type: String, trim: true, maxlength: 500 },
          submittedAt: { type: Date, default: Date.now },
          sentiment: { type: String, enum: ["POSITIVE", "NEUTRAL", "NEGATIVE"] },
          sentimentMethod: { type: String, trim: true }
        },
        { _id: false }
      ),
      default: undefined
    },

    resolution: {
      resolutionTimeHours: Number,
      resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      resolvedByName: { type: String, trim: true },
      resolvedByRole: { type: String, trim: true },
      resolutionDescription: { type: String, trim: true },
      adminMessage: { type: String, trim: true },
      studentSatisfaction: { type: Number, min: 0, max: 100 },
      riskBefore: { type: Number, min: 0, max: 100 },
      riskAfter: { type: Number, min: 0, max: 100 },
      recurrence: { type: String, trim: true },
      resolvedAt: Date,
      confirmWindowDays: { type: Number, default: 6 },
      studentConfirmedAt: Date,
      studentFlag: { type: String, enum: ["PENDING", "GREEN_FLAG", "RED_FLAG"], default: "PENDING" },
      studentDisputeReason: { type: String, trim: true }
    }
  },
  { timestamps: true }
);

complaintSchema.index({ building: 1, category: 1, createdAt: -1 });
complaintSchema.index({ status: 1, createdAt: -1 });

// CMP-2312 style references, sequential per collection so the demo reads well.
complaintSchema.pre("validate", async function assignReference(next) {
  if (this.reference) return next();
  const count = await this.constructor.estimatedDocumentCount();
  this.reference = `CMP-${2100 + count + 1}`;
  next();
});

export const Complaint = mongoose.model("Complaint", complaintSchema);
