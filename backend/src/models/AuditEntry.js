import mongoose from "mongoose";
import { AUDIT_ENTITIES } from "../config/constants.js";

/**
 * One tamper-evident record of an administrative action.
 *
 * Each row stores the digest of the row before it, so the collection forms a
 * hash chain: altering or removing any historical row breaks every digest after
 * it, and verifyChain() in services/auditChainService.js reports exactly where.
 *
 * This is a hash chain in one database, not a blockchain. There is no
 * distributed consensus and no independent replica — an operator with write
 * access to this collection could recompute the whole chain. It detects
 * tampering; it does not prevent it. The API says so on every response.
 */
const auditEntrySchema = new mongoose.Schema(
  {
    // Position in the chain. Unique, so two writers cannot claim one slot.
    sequence: { type: Number, required: true, unique: true, index: true },

    entityType: { type: String, enum: AUDIT_ENTITIES, required: true, index: true },
    entityId: { type: String, required: true, index: true },
    // Human-readable handle — CMP-2312, GP-2026-000004.
    entityRef: { type: String, trim: true },

    action: { type: String, required: true, trim: true, maxlength: 80 },
    field: { type: String, trim: true, maxlength: 80 },
    previousValue: { type: String, trim: true, maxlength: 400 },
    newValue: { type: String, trim: true, maxlength: 400 },

    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    actorName: { type: String, trim: true },
    actorRole: { type: String, trim: true },

    note: { type: String, trim: true, maxlength: 400 },
    at: { type: Date, default: Date.now, index: true },

    // SHA-256 over the canonical form of this row plus previousHash.
    previousHash: { type: String, required: true },
    hash: { type: String, required: true, index: true }
  },
  { timestamps: true }
);

auditEntrySchema.index({ entityType: 1, entityId: 1, sequence: 1 });

export const AuditEntry = mongoose.model("AuditEntry", auditEntrySchema);
