import mongoose from "mongoose";

// Cross-domain edges — "hostel water failure -> sleep disruption -> attendance
// drop". Stored as a flat edge list so the frontend can render any graph shape
// without the backend knowing about the visualisation.
const relationshipSchema = new mongoose.Schema(
  {
    chain: { type: String, required: true, trim: true, index: true },
    fromLabel: { type: String, required: true, trim: true },
    toLabel: { type: String, required: true, trim: true },
    order: { type: Number, default: 0 },

    fromType: { type: String, trim: true, default: "DOMAIN" },
    toType: { type: String, trim: true, default: "DOMAIN" },

    // Optional anchors into real records, so an edge can be traced back.
    entityType: { type: String, trim: true },
    entityId: { type: mongoose.Schema.Types.ObjectId },

    relation: { type: String, trim: true, default: "LEADS_TO" },
    confidence: { type: Number, min: 0, max: 100, default: 0 },
    basis: { type: String, trim: true },
    kind: {
      type: String,
      enum: ["ACTUAL DATA", "AI PREDICTION", "AI RECOMMENDATION", "EVIDENCE"],
      default: "AI PREDICTION"
    }
  },
  { timestamps: true }
);

relationshipSchema.index({ chain: 1, order: 1 });
relationshipSchema.index({ entityType: 1, entityId: 1 });

export const Relationship = mongoose.model("Relationship", relationshipSchema);
