import { Building } from "../../models/Building.js";
import { Complaint } from "../../models/Complaint.js";
import { Incident } from "../../models/Incident.js";
import { User } from "../../models/User.js";
import { IncidentFollow } from "../../models/xo/IncidentFollow.js";
import { ApiError } from "../../utils/ApiError.js";
import { round, sharedTerms, similarity } from "../../utils/text.js";
import { record } from "../auditChainService.js";
import { pairScore } from "../incidentClusteringService.js";
import { complaintEta } from "./etaService.js";
import { emitEvent } from "./eventService.js";
import { plannedShutdownFor } from "./changeService.js";

/**
 * Report smarter (Phase 4, page 05): while the student is still typing, the
 * existing clustering score (incidentClusteringService.pairScore, the same
 * 0.3 threshold attachToIncident uses) is run against open incidents. A match
 * is offered as "Known issue … +1 & Follow"; "Report anyway" files exactly as
 * before. Nothing is written by the check itself.
 */

export const MATCH_THRESHOLD = 0.3;
export const MIN_WORD_OVERLAP = 0.08;

const mostCommon = (values) => {
  const counts = new Map();
  for (const v of values.filter(Boolean)) counts.set(v, (counts.get(v) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
};

/** An incident's department is the one its complaints are routed to. */
export async function incidentDepartment(incident) {
  const rows = await Complaint.find({ _id: { $in: incident.complaints || [] } }).select("department").lean();
  return mostCommon(rows.map((r) => r.department));
}

async function buildingFrom({ buildingCode, location }) {
  if (buildingCode) return Building.findOne({ code: String(buildingCode).toUpperCase() }).lean();
  const head = String(location || "").split("·")[0].trim();
  if (!head) return null;
  return Building.findOne({ $or: [{ name: new RegExp(`^${head.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }, { code: head.toUpperCase() }] }).lean();
}

export async function similarOpenIncident(user, { text = "", category, location, buildingCode } = {}) {
  const clean = String(text).trim();
  if (clean.length < 12) return { match: null, reason: "Type a little more — at least 12 characters." };
  const building = await buildingFrom({ buildingCode, location: location || user.hostelName });
  // Planned work first: a water or power problem during a scheduled shutdown is expected, not a fault.
  const planned = building && category ? await plannedShutdownFor({ building, category, at: new Date() }) : null;
  if (planned) {
    return { match: null, planned: { reference: planned.reference, title: planned.title, window: planned.window, notice: planned.notice?.reference || null, text: `${planned.title} until ${new Date(planned.window.to).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short", hour12: false })} — planned work (${planned.reference}). If you still report it, it is linked to the planned work.` }, method: "PLANNED_WORK_WINDOW", kind: "ACTUAL DATA" };
  }
  const filter = { status: { $ne: "RESOLVED" } };
  if (building) filter.building = building._id;
  if (category && category !== "OTHER") filter.category = category;
  const incidents = await Incident.find(filter).populate("building", "code name").sort({ updatedAt: -1 }).limit(8).lean();
  const probe = { title: clean.slice(0, 80), description: clean, building: building?._id, category: category && category !== "OTHER" ? category : null, createdAt: new Date() };
  let best = null;
  for (const incident of incidents) {
    const members = await Complaint.find({ _id: { $in: (incident.complaints || []).slice(-10) } }).select("title description building category createdAt department").lean();
    // No category chosen means no category bonus; and some shared wording is required, so a
    // student in the same building is never told an unrelated problem is "known".
    const scored = members.filter((m) => similarity(clean, `${m.title} ${m.description}`) >= MIN_WORD_OVERLAP).map((m) => ({ m, score: pairScore(probe, m) }));
    const top = scored.sort((a, b) => b.score - a.score)[0];
    if (top && (!best || top.score > best.score)) best = { incident, score: top.score, member: top.m, department: mostCommon(members.map((m) => m.department)) };
  }
  if (!best || best.score < MATCH_THRESHOLD) return { match: null, checked: incidents.length, threshold: MATCH_THRESHOLD, method: "EXISTING_CLUSTER_SCORE" };
  const { incident, department } = best;
  const [followers, owner, eta, mine] = await Promise.all([
    IncidentFollow.countDocuments({ incident: incident._id }),
    (department ? User.findOne({ managedDepartment: department, role: { $ne: "STUDENT" } }) : null).select("name role").lean(),
    complaintEta({ department, category: incident.category }),
    IncidentFollow.findOne({ incident: incident._id, student: user._id }).lean()
  ]);
  return {
    match: {
      incidentId: String(incident._id),
      reference: incident.reference,
      title: incident.title,
      building: incident.building?.name || null,
      status: incident.status,
      reports: (incident.complaints || []).length,
      followers,
      alreadyFollowing: Boolean(mine),
      assignedTo: department || "Not routed yet",
      owner: owner?.name || null,
      eta,
      overlapPct: round(best.score * 100),
      sharedTerms: sharedTerms(clean, `${best.member.title} ${best.member.description}`),
      basis: `Same scoring the system uses to merge complaints into incidents (text overlap, same building, same category, recency) — ${round(best.score * 100)}% against the ${MATCH_THRESHOLD * 100}% threshold.`
    },
    method: "EXISTING_CLUSTER_SCORE",
    kind: "ACTUAL DATA"
  };
}

/** "+1 & Follow": attach the student to the incident instead of filing a duplicate. */
export async function followIncident(user, incidentId, { note, room, channel = "APP" } = {}) {
  const incident = await Incident.findById(incidentId).lean();
  if (!incident) throw ApiError.notFound("No incident with that id");
  if (incident.status === "RESOLVED") throw ApiError.badRequest("This incident is already resolved — report it anew if the problem is back");
  const existing = await IncidentFollow.findOne({ incident: incident._id, student: user._id });
  if (existing) return { following: true, already: true, followers: await IncidentFollow.countDocuments({ incident: incident._id }), reference: incident.reference };
  await IncidentFollow.create({ incident: incident._id, incidentReference: incident.reference, student: user._id, note, room, channel });
  const followers = await IncidentFollow.countDocuments({ incident: incident._id });
  const department = await incidentDepartment(incident);
  await record({ entityType: "Incident", entityId: incident._id, entityRef: incident.reference, action: "STUDENT_FOLLOWED_INCIDENT", actor: user, newValue: String(followers), note: `+1 instead of a duplicate report${room ? ` · ${room}` : ""}` });
  emitEvent({ type: "COMPLAINT_FOLLOWED", actor: user, student: user, subjectType: "Incident", subjectId: incident._id, subjectRef: incident.reference, department, channel, payload: { followers, room } });
  emitEvent({ type: "COMPLAINT_DEFLECTED", actor: user, student: user, subjectType: "Incident", subjectId: incident._id, subjectRef: incident.reference, department, channel, humanTouch: false, payload: { duplicateAvoided: true } });
  return { following: true, already: false, followers, reference: incident.reference, kind: "ACTUAL DATA" };
}

export async function incidentFollowers() {
  const rows = await IncidentFollow.aggregate([{ $group: { _id: "$incident", n: { $sum: 1 } } }]);
  return Object.fromEntries(rows.map((r) => [String(r._id), r.n]));
}

export async function myFollows(user) {
  const rows = await IncidentFollow.find({ student: user._id }).populate("incident", "reference title status risk").sort({ createdAt: -1 }).lean();
  return { follows: rows.filter((r) => r.incident).map((r) => ({ incidentId: String(r.incident._id), reference: r.incident.reference, title: r.incident.title, status: r.incident.status, since: r.createdAt })), kind: "ACTUAL DATA" };
}
