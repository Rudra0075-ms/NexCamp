import { record } from "../auditChainService.js";

/**
 * Writes one administrative action to both audit trails the brief asks for:
 * the record's own `history` array and the existing hash-chained audit log.
 *
 * The caller saves the document; this only pushes the history row. The chain
 * write never throws (auditChainService.record swallows its own failures).
 */
export async function audit(doc, { entityType, action, actor, note, channel, field, previousValue, newValue, kind } = {}) {
  if (doc?.history) {
    doc.history.push({
      action,
      actorName: actor?.name || "system",
      actorRole: actor?.role || "SYSTEM",
      channel,
      note,
      kind: kind || "ACTUAL DATA"
    });
  }
  return record({
    entityType,
    entityId: doc?._id || "system",
    entityRef: doc?.reference || doc?.key || doc?.workflow,
    action,
    field,
    previousValue,
    newValue,
    actor,
    note: [channel ? `channel ${channel}` : null, note].filter(Boolean).join(" · ")
  });
}
