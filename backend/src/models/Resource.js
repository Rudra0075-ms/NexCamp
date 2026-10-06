import mongoose from "mongoose";
import { RESOURCE_CATEGORIES, RESOURCE_TYPES, RESOURCE_STATUS } from "../config/constants.js";

const moderationSchema = new mongoose.Schema(
  {
    method: { type: String, default: "RULE_BASED" },
    isAppropriate: { type: Boolean, default: true },
    relevanceScore: { type: Number, min: 0, max: 100, default: 100 },
    reasons: [{ type: String, trim: true }],
    checkedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const resourceSchema = new mongoose.Schema(
  {
    reference: {
      type: String,
      unique: true,
      index: true
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000
    },
    category: {
      type: String,
      enum: RESOURCE_CATEGORIES || [
        "ACADEMIC",
        "QUESTIONS",
        "STUDY_MATERIAL",
        "DOCUMENTS",
        "EVENTS",
        "CLUBS",
        "CAMPUS_HELP",
        "OPEN_RESOURCES",
        "OTHER"
      ],
      default: "ACADEMIC",
      index: true
    },
    resourceType: {
      type: String,
      enum: RESOURCE_TYPES || ["FILE", "LINK", "NOTICE"],
      default: "FILE"
    },
    fileUrl: {
      type: String,
      trim: true
    },
    attachmentName: {
      type: String,
      trim: true
    },
    attachmentSize: {
      type: String,
      trim: true
    },
    linkUrl: {
      type: String,
      trim: true
    },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    authorName: {
      type: String,
      required: true,
      trim: true
    },
    authorRole: {
      type: String,
      enum: ["ADMIN", "STUDENT"],
      required: true,
      index: true
    },
    isOfficial: {
      type: Boolean,
      default: false,
      index: true
    },
    status: {
      type: String,
      enum: RESOURCE_STATUS || ["APPROVED", "REJECTED", "FLAGGED"],
      default: "APPROVED",
      index: true
    },
    moderation: {
      type: moderationSchema,
      default: () => ({})
    },
    downloadsCount: {
      type: Number,
      default: 0
    },
    viewsCount: {
      type: Number,
      default: 0
    },
    tags: [
      {
        type: String,
        trim: true
      }
    ]
  },
  {
    timestamps: true
  }
);

resourceSchema.pre("validate", function (next) {
  if (!this.reference) {
    const randomHex = Math.floor(1000 + Math.random() * 9000);
    this.reference = `RES-${randomHex}`;
  }
  next();
});

resourceSchema.index({ title: "text", description: "text", tags: "text" });

export const Resource = mongoose.model("Resource", resourceSchema);
