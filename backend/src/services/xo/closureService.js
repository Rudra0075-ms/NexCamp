import { Complaint } from "../../models/Complaint.js";
import { Incident } from "../../models/Incident.js";
import { FixConfirmation } from "../../models/ext/FixConfirmation.js";
import { round } from "../../utils/text.js";

/**
 * False-closure detector (Phase 4). A resolved complaint is flagged when
 *   (a) its author answered "Not fixed" to "Is it fixed?" (page 17), or
 *   (b) a new complaint on the same room — or naming the same asset — in the
 *       same building and category arrives within 7 days of the resolution.
 * Reopen rate = flagged ÷ resolved, per department.
 */

export const CAME_BACK_DAYS = 7;

/** "HOSTEL A · A-118" → "A-118"; "Pump room" stays as it is. */
export function roomOf(location = "") {
  const parts = String(location).split("·").map((p) => p.trim()).filter(Boolean);
  const room = parts.length > 1 ? parts[parts.length - 1] : parts[0] || "";
  return room.toUpperCase();
}

const mentions = (text, keywords) => keywords.some((k) => String(text || "").toLowerCase().includes(k));

/** Pure: flags for resolved complaints, given later complaints and confirmations. */
export function falseClosureFlags(resolved, later, confirmations = [], { assetKeywords = [] } = {}) {
  const notFixed = new Map(confirmations.filter((c) => c.response === "NOT_FIXED").map((c) => [String(c.complaint), c]));
  const flags = [];
  for (const r of resolved) {
    const at = new Date(r.resolution?.resolvedAt || r.updatedAt);
    const room = roomOf(r.location);
    const keys = assetKeywords.filter((k) => mentions(`${r.title} ${r.description}`, [k]));
    const back = later.find((c) => {
      if (String(c._id) === String(r._id)) return false;
      const t = new Date(c.createdAt);
      if (t <= at || t - at > CAME_BACK_DAYS * 864e5) return false;
      if (String(c.building || "") !== String(r.building || "") || c.category !== r.category) return false;
      return (room && roomOf(c.location) === room) || (keys.length && mentions(`${c.title} ${c.description}`, keys));
    });
    const answer = notFixed.get(String(r._id));
    if (!answer && !back) continue;
    flags.push({
      complaintId: String(r._id),
      reference: r.reference,
      department: r.department || "UNROUTED",
      building: r.building ? String(r.building) : null,
      category: r.category,
      room,
      resolvedAt: at,
      reasons: [
        ...(answer ? [{ rule: "NOT_FIXED_ANSWER", text: `The student answered "Not fixed"${answer.comment ? `: ${answer.comment}` : ""}.` }] : []),
        ...(back ? [{ rule: "CAME_BACK_WITHIN_7_DAYS", text: `${back.reference} on the same ${keys.length && !(room && roomOf(back.location) === room) ? "asset" : "room"} ${round((new Date(back.createdAt) - at) / 864e5, 1)} days after it was closed.`, laterReference: back.reference, laterId: String(back._id), laterIncident: back.relatedIncident ? String(back.relatedIncident) : null }] : [])
      ]
    });
  }
  return flags;
}

/** Pure: reopen rate per department. */
export function reopenRates(resolved, flags) {
  const flagged = new Set(flags.map((f) => f.complaintId));
  const byDept = new Map();
  for (const r of resolved) {
    const d = r.department || "UNROUTED";
    if (!byDept.has(d)) byDept.set(d, { department: d, resolved: 0, flagged: 0 });
    const row = byDept.get(d);
    row.resolved += 1;
    if (flagged.has(String(r._id))) row.flagged += 1;
  }
  return [...byDept.values()].map((d) => ({ ...d, ratePct: d.resolved ? round((d.flagged / d.resolved) * 100, 1) : null, kind: d.resolved < 5 ? "INSUFFICIENT DATA" : "ACTUAL DATA" })).sort((a, b) => (b.ratePct ?? -1) - (a.ratePct ?? -1));
}

export async function falseClosures({ days = 180, now = new Date() } = {}) {
  const since = new Date(now - days * 864e5);
  const [resolved, later, confirmations] = await Promise.all([
    Complaint.find({ status: "RESOLVED", "resolution.resolvedAt": { $gte: since } }).select("reference title description location building category department resolution updatedAt").lean(),
    Complaint.find({ createdAt: { $gte: since } }).select("reference title description location building category createdAt relatedIncident").lean(),
    FixConfirmation.find({ response: "NOT_FIXED" }).lean()
  ]);
  const { Asset } = await import("../../models/xo/Asset.js");
  const assetKeywords = (await Asset.find().select("keywords").lean()).flatMap((a) => a.keywords || []);
  const flags = falseClosureFlags(resolved, later, confirmations, { assetKeywords });
  const rates = reopenRates(resolved, flags);
  const total = resolved.length;
  return {
    window: { days, since },
    flags: flags.sort((a, b) => new Date(b.resolvedAt) - new Date(a.resolvedAt)),
    byDepartment: rates,
    totals: { resolved: total, flagged: flags.length, ratePct: total ? round((flags.length / total) * 100, 1) : null },
    rule: `Flagged when the student answers "Not fixed", or a new complaint on the same room or asset (same building and category) arrives within ${CAME_BACK_DAYS} days of the resolution.`,
    method: "RULE_BASED_FALSE_CLOSURE_CHECK",
    kind: total < 5 ? "INSUFFICIENT DATA" : "ACTUAL DATA"
  };
}

/** Page 06: incidents that reopened (a false closure fed them) or recurred soon after a fix. */
export async function incidentReopenSignals({ now = new Date() } = {}) {
  const [{ flags }, incidents] = await Promise.all([falseClosures({ days: 365, now }), Incident.find().select("reference building category firstComplaintAt createdAt complaints").lean()]);
  const out = [];
  for (const inc of incidents) {
    const fed = flags.find((f) => f.reasons.some((r) => r.laterIncident === String(inc._id)));
    const firstAt = new Date(inc.firstComplaintAt || inc.createdAt);
    const lastFix = await Complaint.findOne({ status: "RESOLVED", building: inc.building, category: inc.category, "resolution.resolvedAt": { $lt: firstAt }, _id: { $nin: inc.complaints || [] } })
      .sort({ "resolution.resolvedAt": -1 })
      .select("reference resolution.resolvedAt resolution.resolutionDescription")
      .lean();
    const gapDays = lastFix ? round((firstAt - new Date(lastFix.resolution.resolvedAt)) / 864e5, 1) : null;
    const signal = fed ? "REOPENED" : gapDays !== null && gapDays <= 45 ? "RECURRED_AFTER_FIX" : null;
    if (!signal) continue;
    out.push({
      incidentId: String(inc._id),
      reference: inc.reference,
      signal,
      text: fed
        ? `Reopened — ${fed.reasons.find((r) => r.laterIncident === String(inc._id)).text} ${fed.reference} had been closed as fixed.`
        : `Recurred ${gapDays} days after the last fix (${lastFix.reference}: ${lastFix.resolution.resolutionDescription || "resolved"})`,
      lastFix: lastFix ? { reference: lastFix.reference, at: lastFix.resolution.resolvedAt, fix: lastFix.resolution.resolutionDescription } : null,
      gapDays,
      kind: "ACTUAL DATA"
    });
  }
  return { incidents: out, method: "RULE_BASED_FALSE_CLOSURE_CHECK", kind: "ACTUAL DATA" };
}
