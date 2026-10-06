import { Building } from "../../models/Building.js";
import { CampusMemory } from "../../models/CampusMemory.js";
import { Complaint } from "../../models/Complaint.js";
import { Asset } from "../../models/xo/Asset.js";
import { round } from "../../utils/text.js";

/**
 * Asset repair history and repair-vs-replace (Phase 4, pages 06 and 09).
 *
 * Failures are counted from records that name the asset: resolved complaints
 * in its building and category, and campus-memory entries. Several complaints
 * on the same day are one failure. The recommendation is arithmetic on stated
 * ASSUMPTION costs, labelled RECOMMENDED ACTION, never a model's opinion.
 */

export const DEFAULT_ASSETS = [
  { code: "HSTB-PUMP-2", name: "Booster pump 2", buildingCode: "HST-B", category: "WATER", keywords: ["booster pump 2", "pump 2"], monthsOld: 41, replacementCost: 85000, typicalRepairCost: 14000 },
  { code: "HSTB-PUMP-1", name: "Booster pump 1", buildingCode: "HST-B", category: "WATER", keywords: ["booster pump 1", "pump 1"], monthsOld: 3, replacementCost: 85000, typicalRepairCost: 14000 },
  { code: "LIB-AP-C4", name: "Wi-Fi AP cluster C4", buildingCode: "LIB", category: "WI-FI", keywords: ["ap cluster c4", "access point c4", "c4-2", "reading hall"], monthsOld: 30, replacementCost: 60000, typicalRepairCost: 4000 },
  { code: "MESS-COOLER-1", name: "Dining hall water cooler", buildingCode: "MESS-C", category: "MESS", keywords: ["water cooler", "cooler"], monthsOld: 52, replacementCost: 38000, typicalRepairCost: 6500 }
];

export const REPLACE_RULE = { minFailures12m: 3, repairShareOfReplacement: 0.5 };

/** Pure: the recommendation from failures and costs. */
export function repairOrReplace({ failures12m, typicalRepairCost, replacementCost, ageMonths }) {
  const spent = failures12m * (typicalRepairCost || 0);
  const share = replacementCost ? spent / replacementCost : null;
  const replace = failures12m >= REPLACE_RULE.minFailures12m && share !== null && share >= REPLACE_RULE.repairShareOfReplacement;
  return {
    action: replace ? "REPLACE" : "KEEP REPAIRING",
    kind: "RECOMMENDED ACTION",
    arithmetic: `${failures12m} failures in 12 months × ₹${(typicalRepairCost || 0).toLocaleString("en-IN")} typical repair = ₹${spent.toLocaleString("en-IN")}${replacementCost ? ` — ${round((share || 0) * 100)}% of the ₹${replacementCost.toLocaleString("en-IN")} replacement cost` : ""}.`,
    rule: `Replace when there are at least ${REPLACE_RULE.minFailures12m} failures in 12 months and repairs have cost at least ${REPLACE_RULE.repairShareOfReplacement * 100}% of a replacement${ageMonths ? ` (asset age ${ageMonths} months)` : ""}.`,
    costKind: "ASSUMPTION"
  };
}

export async function ensureAssets() {
  if (await Asset.countDocuments()) return;
  await Asset.insertMany(DEFAULT_ASSETS.map(({ monthsOld, ...a }) => ({ ...a, installedOn: new Date(Date.now() - monthsOld * 30.4 * 864e5) })));
}

const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

export async function assetHistory({ buildingCode, now = new Date() } = {}) {
  await ensureAssets();
  const assets = await Asset.find(buildingCode ? { buildingCode: String(buildingCode).toUpperCase() } : {}).lean();
  const buildings = new Map((await Building.find().select("code name").lean()).map((b) => [b.code, b]));
  const out = [];
  for (const asset of assets) {
    const building = buildings.get(asset.buildingCode);
    const re = new RegExp(asset.keywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");
    const [complaints, memories] = await Promise.all([
      Complaint.find({ building: building?._id, category: asset.category, $or: [{ title: re }, { description: re }, { "resolution.resolutionDescription": re }] }).select("reference createdAt status resolution").lean(),
      CampusMemory.find({ building: building?._id, category: asset.category, $or: [{ cause: re }, { incidentType: re }, { resolution: re }] }).select("occurredOn incidentType cause resolution resolutionTimeHours").lean()
    ]);
    const events = [
      ...complaints.map((c) => ({ at: c.createdAt, source: "COMPLAINT", reference: c.reference, fix: c.resolution?.resolutionDescription || (c.status === "RESOLVED" ? "Resolved" : `Open (${c.status})`), hours: c.resolution?.resolutionTimeHours ?? null })),
      ...memories.map((m) => ({ at: m.occurredOn, source: "CAMPUS_MEMORY", reference: m.incidentType, fix: m.resolution || "—", hours: m.resolutionTimeHours ?? null }))
    ].sort((a, b) => new Date(b.at) - new Date(a.at));
    // One failure per day, whatever the number of reports that day.
    const failures = [];
    for (const e of events) if (!failures.some((f) => dayKey(f.at) === dayKey(e.at))) failures.push(e);
    const inWindow = (months) => failures.filter((f) => now - new Date(f.at) <= months * 30.4 * 864e5).length;
    const ageMonths = asset.installedOn ? Math.round((now - new Date(asset.installedOn)) / (30.4 * 864e5)) : null;
    const months = failures.length ? Math.max(1, Math.ceil((now - new Date(failures[failures.length - 1].at)) / (30.4 * 864e5))) : null;
    out.push({
      code: asset.code,
      name: asset.name,
      building: building?.name || asset.buildingCode,
      category: asset.category,
      ageMonths,
      failures: failures.slice(0, 12),
      failures12m: inWindow(12),
      failures9m: inWindow(9),
      headline: failures.length ? `${asset.name}: ${failures.length} failure${failures.length === 1 ? "" : "s"} in ${months} month${months === 1 ? "" : "s"}` : `${asset.name}: no recorded failures`,
      recommendation: failures.length ? repairOrReplace({ failures12m: inWindow(12), typicalRepairCost: asset.typicalRepairCost, replacementCost: asset.replacementCost, ageMonths }) : null,
      costs: { replacement: asset.replacementCost, typicalRepair: asset.typicalRepairCost, source: asset.costSource, kind: "ASSUMPTION" },
      kind: failures.length ? "ACTUAL DATA" : "INSUFFICIENT DATA"
    });
  }
  return { assets: out.sort((a, b) => b.failures12m - a.failures12m), method: "RECORDS_NAMING_THE_ASSET", kind: "ACTUAL DATA" };
}
