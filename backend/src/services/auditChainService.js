import crypto from "node:crypto";
import { AuditEntry } from "../models/AuditEntry.js";

/**
 * Tamper-evident audit history.
 *
 * Every recorded action carries the digest of the one before it, so the
 * collection is a hash chain. Editing a stored row, deleting one, or inserting
 * one in the middle leaves a digest that no longer reproduces — verifyChain()
 * names the first sequence where that happens.
 *
 * What this is NOT: a blockchain. One database, one writer, no consensus and no
 * independent replica. Somebody with write access could recompute every digest
 * from the edit onwards and the chain would verify again. It makes tampering
 * *detectable by an auditor who holds an earlier digest*, which is a real and
 * useful property, and it is described in exactly those terms everywhere it is
 * surfaced.
 */

// The first row's previousHash. Any constant works; this one is legible.
export const GENESIS_HASH = "0".repeat(64);

const truncate = (value, max = 400) => {
  if (value === undefined || value === null) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? text.slice(0, max) : text;
};

/**
 * The exact bytes that get hashed. Field order is fixed here rather than taken
 * from the document, so a stored row always re-hashes to the same digest.
 */
export function canonicalForm(entry) {
  return [
    entry.sequence,
    entry.entityType,
    entry.entityId,
    entry.entityRef || "",
    entry.action,
    entry.field || "",
    entry.previousValue || "",
    entry.newValue || "",
    entry.actorName || "",
    entry.actorRole || "",
    entry.note || "",
    new Date(entry.at).toISOString(),
    entry.previousHash
  ].join("␟");
}

export function hashEntry(entry) {
  return crypto.createHash("sha256").update(canonicalForm(entry), "utf8").digest("hex");
}

/**
 * Appends one action to the chain.
 *
 * Never throws into the caller's path: an audit write that fails must not undo
 * the action it was recording, so the error is logged and null is returned.
 */
export async function record({
  entityType,
  entityId,
  entityRef,
  action,
  field,
  previousValue,
  newValue,
  actor,
  note
} = {}) {
  try {
    const last = await AuditEntry.findOne().sort({ sequence: -1 }).lean();

    const draft = {
      sequence: (last?.sequence ?? 0) + 1,
      entityType,
      entityId: String(entityId),
      entityRef,
      action,
      field,
      previousValue: truncate(previousValue),
      newValue: truncate(newValue),
      actor: actor?._id,
      actorName: actor?.name || "system",
      actorRole: actor?.role || "SYSTEM",
      note: truncate(note),
      at: new Date(),
      previousHash: last?.hash || GENESIS_HASH
    };

    draft.hash = hashEntry(draft);
    return await AuditEntry.create(draft);
  } catch (error) {
    // A unique-index clash means two writers raced for the same sequence; one
    // retry picks up the new tail.
    if (error?.code === 11000) {
      try {
        const last = await AuditEntry.findOne().sort({ sequence: -1 }).lean();
        const draft = {
          sequence: (last?.sequence ?? 0) + 1,
          entityType,
          entityId: String(entityId),
          entityRef,
          action,
          field,
          previousValue: truncate(previousValue),
          newValue: truncate(newValue),
          actor: actor?._id,
          actorName: actor?.name || "system",
          actorRole: actor?.role || "SYSTEM",
          note: truncate(note),
          at: new Date(),
          previousHash: last?.hash || GENESIS_HASH
        };
        draft.hash = hashEntry(draft);
        return await AuditEntry.create(draft);
      } catch (retryError) {
        console.error("auditChainService: retry failed —", retryError.message);
        return null;
      }
    }
    console.error("auditChainService: could not record action —", error.message);
    return null;
  }
}

/**
 * Re-hashes a list of rows in sequence order and reports the first break.
 * Pure — takes rows, returns a verdict — so it is testable without a database.
 */
export function verifyChain(rows = []) {
  const ordered = [...rows].sort((a, b) => a.sequence - b.sequence);
  let expectedPrevious = ordered[0]?.previousHash ?? GENESIS_HASH;
  // A full-chain check starts at the genesis digest; a windowed one starts at
  // whatever the first row claims, and says so.
  const fullChain = ordered[0]?.sequence === 1;

  for (let index = 0; index < ordered.length; index += 1) {
    const row = ordered[index];

    if (row.previousHash !== expectedPrevious) {
      return {
        intact: false,
        checked: index,
        brokenAt: row.sequence,
        reason: "PREVIOUS_HASH_MISMATCH",
        detail: `Entry ${row.sequence} points at a predecessor digest that does not match the entry before it — a row was altered, removed or inserted.`,
        fullChain
      };
    }

    const recomputed = hashEntry(row);
    if (recomputed !== row.hash) {
      return {
        intact: false,
        checked: index,
        brokenAt: row.sequence,
        reason: "CONTENT_MODIFIED",
        detail: `Entry ${row.sequence} no longer hashes to its stored digest — its contents were changed after it was written.`,
        fullChain
      };
    }

    if (index > 0 && row.sequence !== ordered[index - 1].sequence + 1) {
      return {
        intact: false,
        checked: index,
        brokenAt: row.sequence,
        reason: "SEQUENCE_GAP",
        detail: `Sequence jumps from ${ordered[index - 1].sequence} to ${row.sequence} — an entry is missing.`,
        fullChain
      };
    }

    expectedPrevious = row.hash;
  }

  return {
    intact: true,
    checked: ordered.length,
    brokenAt: null,
    headHash: ordered[ordered.length - 1]?.hash || GENESIS_HASH,
    fullChain,
    detail: ordered.length
      ? `${ordered.length} entries re-hashed in sequence and every digest reproduced.`
      : "No audit entries recorded yet."
  };
}

/** Reads a page of the chain and verifies the whole thing behind it. */
export async function history({ entityType, entityId, limit = 50, skip = 0 } = {}) {
  const filter = {};
  if (entityType) filter.entityType = entityType;
  if (entityId) filter.entityId = String(entityId);

  const [rows, total, everything] = await Promise.all([
    AuditEntry.find(filter).sort({ sequence: -1 }).skip(skip).limit(limit).lean(),
    AuditEntry.countDocuments(filter),
    // Verification has to run over the unfiltered chain: a filtered slice is
    // not contiguous, so it could not be verified honestly.
    AuditEntry.find().sort({ sequence: 1 }).lean()
  ]);

  return {
    entries: rows.map((row) => ({
      sequence: row.sequence,
      entityType: row.entityType,
      entityId: row.entityId,
      entityRef: row.entityRef,
      action: row.action,
      field: row.field,
      previousValue: row.previousValue,
      newValue: row.newValue,
      actorName: row.actorName,
      actorRole: row.actorRole,
      note: row.note,
      at: row.at,
      // Short forms are what an auditor compares by eye.
      hash: row.hash,
      hashShort: row.hash.slice(0, 12),
      previousHashShort: row.previousHash.slice(0, 12)
    })),
    total,
    chain: verifyChain(everything),
    method: "SHA256_HASH_CHAIN",
    disclaimer:
      "Hash-chained audit records in this application's own database. This makes modification detectable; it is " +
      "not a blockchain and provides no distributed guarantee."
  };
}
