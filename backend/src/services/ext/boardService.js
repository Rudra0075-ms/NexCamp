import { Building } from "../../models/Building.js";
import { CampusMemory } from "../../models/CampusMemory.js";
import { Incident } from "../../models/Incident.js";
import { round } from "../../utils/text.js";

/**
 * "You Said, We Did" (PS07 extension 2E). Read-only over campus memory and
 * resolved incidents. Only building, category, counts, the fix and how long
 * it took are shown — never a student's name, ID or room.
 */

const reportsFromSignatures = (signatures = []) => {
  for (const s of signatures) {
    const hit = /(\d+)[- ]complaint/i.exec(s);
    if (hit) return Number(hit[1]);
  }
  return null;
};

/** Pure: one card per resolved occurrence. */
export function cardFromMemory(m) {
  const reports = reportsFromSignatures(m.signatures);
  return {
    source: "CAMPUS_MEMORY",
    building: m.buildingName || "Campus",
    category: m.category,
    date: m.occurredOn,
    said: reports !== null ? `${reports} reports — ${m.incidentType}` : m.incidentType,
    did: m.resolution || "Resolved",
    hours: m.resolutionTimeHours ?? null,
    reports,
    reportsBasis: reports !== null ? "count stated in the campus-memory record" : null,
    headline: `${m.buildingName || "Campus"} ${m.category} — ${reports !== null ? `${reports} reports` : m.incidentType} → ${m.resolution || "resolved"}${m.resolutionTimeHours != null ? ` in ${m.resolutionTimeHours}h` : ""}`,
    outcome: m.outcome || null,
    recurrence: m.recurrence || null,
    kind: "ACTUAL DATA"
  };
}

export function cardFromIncident(i, buildingName) {
  const reports = i.complaints?.length || 0;
  const hours = i.resolution?.resolutionTimeHours ?? null;
  return {
    source: "RESOLVED_INCIDENT",
    building: buildingName || "Campus",
    category: i.category,
    date: i.resolution?.resolvedAt || i.updatedAt,
    said: `${reports} reports — ${i.title}`,
    did: i.resolution?.resolutionDescription || "Resolved",
    hours,
    reports,
    reportsBasis: "complaints linked to the incident",
    headline: `${buildingName || "Campus"} ${i.category} — ${reports} reports → ${i.resolution?.resolutionDescription || "resolved"}${hours != null ? ` in ${hours}h` : ""}`,
    kind: "ACTUAL DATA"
  };
}

export async function board({ hostel } = {}) {
  const buildings = await Building.find().select("code name type").lean();
  const byId = new Map(buildings.map((b) => [String(b._id), b]));
  const target = hostel ? buildings.find((b) => b.code === String(hostel).toUpperCase() || b.name === String(hostel).toUpperCase()) : null;
  const filter = target ? { building: target._id } : {};
  const [memories, incidents] = await Promise.all([
    CampusMemory.find(filter).sort({ occurredOn: -1 }).lean(),
    Incident.find({ ...filter, status: "RESOLVED" }).sort({ updatedAt: -1 }).lean()
  ]);
  const cards = [
    ...memories.map(cardFromMemory),
    ...incidents.map((i) => cardFromIncident(i, byId.get(String(i.building))?.name))
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  // Recurring issues: the same building and category more than once.
  const groups = new Map();
  for (const c of cards) {
    const key = `${c.building}·${c.category}`;
    if (!groups.has(key)) groups.set(key, { building: c.building, category: c.category, occurrences: 0, hours: [] });
    const g = groups.get(key);
    g.occurrences += 1;
    if (c.hours != null) g.hours.push(c.hours);
  }
  const recurring = [...groups.values()]
    .filter((g) => g.occurrences > 1)
    .map((g) => ({ building: g.building, category: g.category, occurrences: g.occurrences, fastestHours: g.hours.length ? Math.min(...g.hours) : null, averageHours: g.hours.length ? round(g.hours.reduce((t, h) => t + h, 0) / g.hours.length, 1) : null }))
    .sort((a, b) => b.occurrences - a.occurrences);

  const hostels = buildings.filter((b) => b.type === "HOSTEL").map((b) => ({ code: b.code, name: b.name }));
  return {
    filter: target ? { code: target.code, name: target.name } : null,
    hostels,
    cards,
    recurring,
    note: cards.length ? null : "Insufficient data — no resolved issues are recorded for this selection yet.",
    privacy: "No names, student IDs or rooms are shown on this board.",
    method: "READ_ONLY_CAMPUS_MEMORY_AND_RESOLVED_INCIDENTS",
    kind: "ACTUAL DATA"
  };
}
