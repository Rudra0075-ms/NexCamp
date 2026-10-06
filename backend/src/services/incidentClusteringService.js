import { Building } from "../models/Building.js";
import { Complaint } from "../models/Complaint.js";
import { Incident } from "../models/Incident.js";
import { clamp, round, sharedTerms, similarity } from "../utils/text.js";
import { scoreIncident } from "./riskService.js";

/**
 * Groups complaints that describe the same underlying problem.
 *
 * This is deterministic matching on building + category + time window +
 * keyword overlap. It is NOT semantic embedding, and every response says so via
 * `method: "DETERMINISTIC_KEYWORD_AND_LOCATION_MATCH"`. Swapping in a real
 * similarity model means replacing `pairScore()` only.
 */

const DEFAULTS = { windowDays: 21, threshold: 0.28, minClusterSize: 2 };

function pairScore(a, b) {
  const text = similarity(`${a.title} ${a.description}`, `${b.title} ${b.description}`);
  const sameBuilding = String(a.building || "") === String(b.building || "") ? 0.22 : 0;
  const sameCategory = a.category === b.category ? 0.16 : 0;
  const hours = Math.abs(new Date(a.createdAt) - new Date(b.createdAt)) / 36e5;
  // Complaints close in time are more likely to be one event.
  const timeBonus = hours <= 72 ? 0.1 : hours <= 24 * 14 ? 0.05 : 0;
  return clamp(text * 0.6 + sameBuilding + sameCategory + timeBonus, 0, 1);
}

function buildClusters(complaints, threshold) {
  // Single-link agglomeration: a complaint joins a cluster if it passes the
  // threshold against any member. Cheap, and it matches how the UI explains it.
  const clusters = [];
  for (const complaint of complaints) {
    let target = null;
    let best = 0;
    for (const cluster of clusters) {
      const score = Math.max(...cluster.members.map((member) => pairScore(complaint, member)));
      if (score >= threshold && score > best) {
        best = score;
        target = cluster;
      }
    }
    if (target) {
      target.members.push(complaint);
      target.scores.push(round(best * 100));
    } else {
      clusters.push({ members: [complaint], scores: [100] });
    }
  }
  return clusters;
}

function describeCluster(cluster) {
  const members = cluster.members;
  const anchor = members[0];
  const overlapScores = cluster.scores.slice(1);
  const averageOverlap = overlapScores.length
    ? round(overlapScores.reduce((total, value) => total + value, 0) / overlapScores.length)
    : 0;
  const phrasings = new Set(members.map((member) => member.description.trim().toLowerCase()));
  const dates = members.map((member) => new Date(member.createdAt)).sort((a, b) => a - b);
  const ageDays = (Date.now() - dates[0]) / 864e5;

  return {
    anchor,
    complaints: members,
    complaintCount: members.length,
    buildingId: anchor.building ? String(anchor.building) : null,
    category: anchor.category,
    averageOverlap,
    distinctPhrasings: phrasings.size,
    firstComplaintAt: dates[0],
    lastComplaintAt: dates[dates.length - 1],
    ageDays: round(ageDays, 1),
    // Terms shared with the anchor — the frontend shows these as the "one
    // meaning, many phrasings" evidence.
    sharedTerms: members
      .slice(1)
      .flatMap((member) =>
        sharedTerms(`${anchor.title} ${anchor.description}`, `${member.title} ${member.description}`, 3)
      )
      .filter((term, index, all) => all.indexOf(term) === index)
      .slice(0, 8),
    method: "DETERMINISTIC_KEYWORD_AND_LOCATION_MATCH"
  };
}

/**
 * Runs clustering over a window of complaints and returns cluster descriptions
 * in the shape the frontend animates (input count -> one incident).
 */
export async function clusterComplaints(options = {}) {
  // An option passed as undefined (the controller forwards whatever the body
  // held) must not blank out its default — `score >= undefined` is never true.
  const given = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
  const { windowDays, threshold, minClusterSize } = { ...DEFAULTS, ...given };
  const since = new Date(Date.now() - windowDays * 864e5);

  const filter = { createdAt: { $gte: since } };
  if (options.buildingId) filter.building = options.buildingId;
  if (options.category) filter.category = options.category;

  const complaints = await Complaint.find(filter)
    .select("reference title description category building createdAt relatedIncident status severity")
    .sort({ createdAt: 1 })
    .lean();

  const clusters = buildClusters(complaints, threshold)
    .map(describeCluster)
    .filter((cluster) => cluster.complaintCount >= minClusterSize)
    .sort((a, b) => b.complaintCount - a.complaintCount);

  const buildingIds = [...new Set(clusters.map((c) => c.buildingId).filter(Boolean))];
  const buildings = await Building.find({ _id: { $in: buildingIds } })
    .select("code name affectedStudents occupancy historicalProblems")
    .lean();
  const byId = new Map(buildings.map((b) => [String(b._id), b]));

  return {
    inputComplaints: complaints.length,
    windowDays,
    threshold,
    method: "DETERMINISTIC_KEYWORD_AND_LOCATION_MATCH",
    note:
      "Clusters are formed from building, category, time proximity and keyword overlap. " +
      "No semantic embedding model is involved.",
    clusters: clusters.map((cluster) => {
      const building = cluster.buildingId ? byId.get(cluster.buildingId) : null;
      const affected = building?.affectedStudents || Math.round((building?.occupancy || 0) * 0.42);
      const risk = scoreIncident({
        complaintCount: cluster.complaintCount,
        ageDays: cluster.ageDays,
        affectedStudents: affected,
        severity: cluster.anchor.severity || "MODERATE",
        historicalCount: building?.historicalProblems || 0
      });
      return {
        ...cluster,
        anchor: undefined,
        anchorReference: cluster.anchor.reference,
        title: cluster.anchor.title,
        building: building ? { id: String(building._id), code: building.code, name: building.name } : null,
        affectedStudents: affected,
        ...risk,
        complaints: cluster.complaints.map((c) => ({
          id: String(c._id),
          reference: c.reference,
          title: c.title,
          description: c.description,
          createdAt: c.createdAt,
          status: c.status,
          incidentId: c.relatedIncident ? String(c.relatedIncident) : null
        }))
      };
    })
  };
}

/**
 * Attaches one complaint to an existing open incident when it belongs to the
 * same building, category and window. Returns the incident, or null.
 */
export async function attachToIncident(complaint, { threshold = 0.3 } = {}) {
  if (!complaint.building) return null;

  const open = await Incident.find({
    building: complaint.building,
    category: complaint.aiClassification?.category || complaint.category,
    status: { $ne: "RESOLVED" }
  })
    .sort({ updatedAt: -1 })
    .limit(5);

  if (!open.length) return null;

  const candidates = await Promise.all(
    open.map(async (incident) => {
      const members = await Complaint.find({ _id: { $in: incident.complaints.slice(-10) } })
        .select("title description building category createdAt")
        .lean();
      const score = members.length
        ? Math.max(...members.map((member) => pairScore(complaint, member)))
        : 0.35; // an empty incident in the same building/category still matches
      return { incident, score };
    })
  );

  const best = candidates.sort((a, b) => b.score - a.score)[0];
  if (!best || best.score < threshold) return null;

  const incident = best.incident;
  if (!incident.complaints.some((id) => String(id) === String(complaint._id))) {
    incident.complaints.push(complaint._id);
  }
  incident.affectedStudents = Math.max(incident.affectedStudents, incident.complaints.length * 8);
  if (incident.status === "DETECTED" && incident.complaints.length >= 3) {
    incident.status = "CLUSTERED";
    incident.clusteredAt = new Date();
  }
  await incident.save();

  return { incident, matchScore: round(best.score * 100) };
}

// EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md): the same scoring, reused by the
// pre-submission "known issue" check on page 05 so it can never disagree with clustering.
export { pairScore };
