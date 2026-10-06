import mongoose from "mongoose";
import { historySchema } from "../ext/common.js";

/**
 * A written, cited rule that decides a routine request (Phase 2 — the
 * Touchless Lane). The policy engine evaluates a request's facts against the
 * active rule(s) for its type: when every condition of an AUTO_APPROVE rule
 * passes, the request is decided with no human touch; otherwise it goes to a
 * person with the failed conditions attached.
 *
 * Rules are versioned. Editing one creates a new DRAFT version; an
 * administrator activates it (the old version is RETIRED). The live rule set
 * never changes without that approval — the simulator and the compiler only
 * ever write drafts.
 */
export const POLICY_REQUEST_TYPES = ["BONAFIDE_CERTIFICATE", "GATE_PASS", "FEE_RECEIPT_COPY"];
export const POLICY_ACTIONS = ["AUTO_APPROVE", "ROUTE_TO_HUMAN"];
export const POLICY_OPS = ["eq", "neq", "lt", "lte", "gt", "gte", "in", "nin", "isTrue", "isFalse"];
export const POLICY_RULE_STATUS = ["DRAFT", "ACTIVE", "RETIRED"];

const conditionSchema = new mongoose.Schema(
  {
    field: { type: String, required: true, trim: true },
    op: { type: String, enum: POLICY_OPS, required: true },
    value: { type: mongoose.Schema.Types.Mixed },
    // Plain-language wording shown to the student and the staff member.
    label: { type: String, trim: true, maxlength: 160 },
    // What to tell the student when this condition fails ({actual} is filled in).
    failText: { type: String, trim: true, maxlength: 240 }
  },
  { _id: false }
);

const policyRuleSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, index: true },
    version: { type: Number, default: 1 },
    requestType: { type: String, enum: POLICY_REQUEST_TYPES, required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    conditions: [conditionSchema],
    citation: {
      section: { type: String, trim: true },
      key: { type: String, trim: true },
      text: { type: String, trim: true, maxlength: 600 },
      // Older FAQ sections on the same topic, so the FAQ answer links to this rule too.
      related: [{ type: String, trim: true }]
    },
    action: { type: String, enum: POLICY_ACTIONS, default: "AUTO_APPROVE" },
    status: { type: String, enum: POLICY_RULE_STATUS, default: "DRAFT", index: true },
    active: { type: Boolean, default: false, index: true },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    approvedByName: { type: String, trim: true },
    approvedAt: Date,
    // SEED, ADMIN (edited in the app), COMPILER (drafted from a handbook section), SIMULATOR
    source: { type: String, trim: true, default: "ADMIN" },
    notes: { type: String, trim: true, maxlength: 600 },
    history: [historySchema]
  },
  { timestamps: true }
);

policyRuleSchema.index({ key: 1, version: 1 }, { unique: true });

export const PolicyRule = mongoose.models.PolicyRule || mongoose.model("PolicyRule", policyRuleSchema);
