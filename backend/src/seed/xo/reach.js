import { Notice } from "../../models/ext/Notice.js";
import { NoticeReceipt } from "../../models/ext/NoticeReceipt.js";
import { StudentProfile } from "../../models/ext/StudentProfile.js";
import { CohortContact } from "../../models/xo/CohortContact.js";
import { phoneFor } from "../../services/ext/extMonitor.js";
import { createReachNotice, reachSweep } from "../../services/xo/reachService.js";

/**
 * Guaranteed-reach demo data (Phase 5), through the real services: one class
 * representative per section, a CRITICAL Hostel B notice with a 100% reach
 * target that is three-quarters of the way to its deadline (so every rung of
 * the ladder has something on it), and a notice superseded by a correction.
 */

const hoursAgo = (h) => new Date(Date.now() - h * 3600000);

export async function seedReach({ admin, warden, students }) {
  await CohortContact.deleteMany({});
  const old = await Notice.find({ title: { $in: SEEDED_TITLES } }).select("_id").lean();
  await NoticeReceipt.deleteMany({ notice: { $in: old.map((n) => n._id) } });
  await Notice.deleteMany({ _id: { $in: old.map((n) => n._id) } });
  const profiles = await StudentProfile.find().lean();
  const sections = new Map();
  for (const p of profiles) {
    const key = `${p.branch}|${p.year}|${p.section}`;
    // The second student of each section is its representative (not the demo student).
    if (!sections.has(key)) sections.set(key, []);
    sections.get(key).push(p);
  }
  for (const [key, list] of sections) {
    const [branch, year, section] = key.split("|");
    const rep = list.find((p) => String(p.student) !== String(students[0]._id)) || list[0];
    await CohortContact.create({ student: rep.student, branch, year: Number(year), section, role: "CLASS_REP" });
  }

  // A CRITICAL notice with a reach target, published 3 hours ago, due in 1 hour.
  const published = hoursAgo(3);
  const water = await createReachNotice(
    {
      title: SEEDED_TITLES[0],
      body: "Water supply in Hostel B is off tomorrow 10:00–13:00 for the booster pump replacement. Store water tonight. Drinking water at the mess counter.",
      priority: "CRITICAL",
      audience: { hostels: ["HOSTEL B"], roles: ["STUDENT"] },
      actionRequired: { label: "Store water before 10:00" },
      escalateAfterHours: 24,
      reachTarget: { pct: 100, deadline: new Date(Date.now() + 3600000) },
      confirmDuplicate: true
    },
    warden || admin,
    { now: published }
  );
  const receipts = await NoticeReceipt.find({ notice: water._id }).sort({ _id: 1 });
  // About half of Hostel B has read it in the app; the rest are on the ladder.
  for (const [i, r] of receipts.entries()) {
    if (String(r.student) === String(students[0]._id)) continue;
    if (i % 2 === 0) {
      r.deliveredAt = new Date(published.getTime() + (10 + i) * 60000);
      r.readAt = new Date(published.getTime() + (25 + i * 3) * 60000);
      await r.save();
    } else if (i % 3 === 0) {
      r.deliveredAt = new Date(published.getTime() + 40 * 60000);
      await r.save();
    }
  }
  const swept = await reachSweep({ now: new Date(), phoneFor });

  // A correction that supersedes an earlier notice.
  const first = await createReachNotice(
    { title: SEEDED_TITLES[1], body: "The Operating Systems lab exam for CSE year 3 is on Friday at 10:00 in Lab 3.", priority: "HIGH", audience: { branches: ["CSE"], years: [3], roles: ["STUDENT"] }, overrideQuietHours: true, confirmDuplicate: true },
    admin,
    { now: hoursAgo(30) }
  );
  await createReachNotice(
    { title: SEEDED_TITLES[2], body: "Correction: the Operating Systems lab exam for CSE year 3 is rescheduled to Friday at 14:00 in Lab 3 (not 10:00).", priority: "HIGH", audience: { branches: ["CSE"], years: [3], roles: ["STUDENT"] }, supersedes: String(first._id), overrideQuietHours: true, confirmDuplicate: true },
    admin,
    { now: hoursAgo(6) }
  );
  return { classReps: sections.size, reachNotice: water.reference, ladder: swept };
}

export const SEEDED_TITLES = ["Hostel B water shutdown tomorrow 10:00–13:00", "OS lab exam on Friday", "OS lab exam rescheduled to Friday 14:00"];
