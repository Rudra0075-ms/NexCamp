import { MessRecord } from "../models/MessRecord.js";
import { clamp, round } from "../utils/text.js";

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** The demand curve for one day, slot by slot. */
export async function demandCurve(date = new Date()) {
  const from = startOfDay(date);
  const to = new Date(from.getTime() + 864e5);

  const records = await MessRecord.find({ date: { $gte: from, $lt: to } })
    .sort({ time: 1 })
    .lean();

  const slots = records.map((record) => ({
    id: String(record._id),
    time: record.time,
    meal: record.meal,
    crowd: record.crowd,
    capacity: record.capacity,
    demand: record.demand || record.crowd,
    utilisation: round((record.crowd / record.capacity) * 100, 1),
    queueMinutes: record.queueMinutes,
    waste: record.waste,
    status: record.crowd > record.capacity * 0.82 ? "OVERLOAD PREDICTED" : record.crowd > record.capacity * 0.52 ? "BUSY" : "COMFORTABLE",
    menu: record.menu || []
  }));

  const peak = slots.reduce((best, slot) => (!best || slot.crowd > best.crowd ? slot : best), null);

  return {
    date: from.toISOString().slice(0, 10),
    capacity: slots[0]?.capacity ?? 850,
    slots,
    peak: peak ? { time: peak.time, crowd: peak.crowd, utilisation: peak.utilisation } : null,
    expectedWaste: slots.length ? round(slots.reduce((t, s) => t + s.waste, 0) / slots.length, 1) : 0
  };
}

/**
 * A staggering recommendation: moving part of the peak slot's crowd into the
 * neighbouring slot, and what that does to the peak and to expected waste.
 */
export function staggerProjection(curve, { shiftShare = 0.18 } = {}) {
  if (!curve.peak || !curve.slots.length) return null;
  const peakIndex = curve.slots.findIndex((slot) => slot.time === curve.peak.time);
  const peak = curve.slots[peakIndex];
  const moved = Math.round(peak.crowd * shiftShare);
  const newPeak = peak.crowd - moved;
  // Waste tracks over-provisioning against the peak, so flattening it helps.
  const wasteAfter = round(clamp(curve.expectedWaste * (newPeak / peak.crowd), 0, 100), 1);

  return {
    action: `Stagger ${moved} covers out of the ${peak.time} slot by 20 minutes`,
    peakBefore: peak.crowd,
    peakAfter: newPeak,
    wasteBefore: curve.expectedWaste,
    wasteAfter,
    studentsMoved: moved,
    method: "ARITHMETIC_PROJECTION"
  };
}

export async function analytics({ days = 7 } = {}) {
  const from = startOfDay(new Date(Date.now() - days * 864e5));
  const records = await MessRecord.find({ date: { $gte: from } }).sort({ date: 1, time: 1 }).lean();

  const byTime = new Map();
  for (const record of records) {
    const entry = byTime.get(record.time) || { time: record.time, samples: 0, crowd: 0, waste: 0 };
    entry.samples += 1;
    entry.crowd += record.crowd;
    entry.waste += record.waste;
    byTime.set(record.time, entry);
  }

  const averages = [...byTime.values()]
    .map((entry) => ({
      time: entry.time,
      averageCrowd: round(entry.crowd / entry.samples),
      averageWaste: round(entry.waste / entry.samples, 1)
    }))
    .sort((a, b) => a.time.localeCompare(b.time));

  const totalCrowd = records.reduce((t, r) => t + r.crowd, 0);
  const totalWaste = records.length ? records.reduce((t, r) => t + r.waste, 0) / records.length : 0;

  return {
    windowDays: days,
    sampleCount: records.length,
    averageByTime: averages,
    busiestSlot: averages.reduce((best, slot) => (!best || slot.averageCrowd > best.averageCrowd ? slot : best), null),
    averageWaste: round(totalWaste, 1),
    totalCovers: totalCrowd
  };
}
