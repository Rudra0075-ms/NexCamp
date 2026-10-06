import mongoose from "mongoose";
import { ROLES } from "../../config/constants.js";
import { env } from "../../config/env.js";
import { User } from "../../models/User.js";
import { SupportCase } from "../../models/support/SupportCase.js";
import { WellbeingCheckIn } from "../../models/support/WellbeingCheckIn.js";

/**
 * Silent Support System demo data (see CHANGES-SILENT-SUPPORT.md).
 *
 * Adds one support-team account and a few weeks of history so the overview
 * has something to draw. The demo student (the account the interface signs in
 * as) is deliberately left with no check-ins or requests, so the live demo
 * starts from a clean slate. Seeded cases use other seeded students only.
 */
const DAY = 86400000;

export const COUNSELLOR_EMAIL = process.env.DEMO_COUNSELLOR_EMAIL || "care@bput.ac.in";
export const COUNSELLOR_PASSWORD = process.env.DEMO_COUNSELLOR_PASSWORD || "Care@2026";

const PLAN = [
  // [days ago, preference, final status, anonymous, band, outcome, contact hours]
  [33, "COUNSELLOR", "RESOLVED", false, "SUPPORT_RECOMMENDED", "SUPPORT_COMPLETED", 5],
  [27, "MENTOR", "RESOLVED", false, "COULD_BENEFIT", "SUPPORT_COMPLETED", 20],
  [22, "PRIVATE_CONVERSATION", "RESOLVED", false, null, "REFERRED_TO_PROFESSIONAL", 3],
  [18, "ANONYMOUS", "RESOLVED", true, "COULD_BENEFIT", "SUPPORT_COMPLETED", 9],
  [12, "MENTOR", "FOLLOW_UP", false, "SUPPORT_RECOMMENDED", null, 6],
  [8, "COUNSELLOR", "CONTACTED", false, null, null, 4],
  [5, "CHECK_LATER", "FOLLOW_UP", false, null, null, null],
  [2, "MENTOR", "ASSIGNED", false, "COULD_BENEFIT", null, null],
  [1, "ANONYMOUS", "REQUESTED", true, null, null, null]
];

export async function seedSupport({ now = new Date() } = {}) {
  await Promise.all([SupportCase.deleteMany({}), WellbeingCheckIn.deleteMany({})]);
  await User.deleteMany({ role: ROLES.COUNSELLOR });

  const counsellor = await User.create({
    name: "Student Support Team",
    email: COUNSELLOR_EMAIL,
    password: COUNSELLOR_PASSWORD,
    role: ROLES.COUNSELLOR,
    department: "STUDENT WELLBEING"
  });

  const students = await User.find({ role: ROLES.STUDENT, email: { $ne: env.demo.studentEmail } }).select("_id").limit(PLAN.length + 12).lean();
  if (!students.length) return { counsellor: 1, cases: 0, checkIns: 0 };

  const order = ["REQUESTED", "ASSIGNED", "CONTACTED", "FOLLOW_UP", "RESOLVED"];
  const cases = PLAN.map(([ago, preference, status, anonymous, band, outcome, contactHours], i) => {
    const _id = new mongoose.Types.ObjectId();
    const createdAt = new Date(now.getTime() - ago * DAY);
    const checkLater = preference === "CHECK_LATER";
    const history = [];
    if (checkLater) history.push({ status: "FOLLOW_UP", at: createdAt, byRole: "STUDENT" });
    else {
      const last = order.indexOf(status);
      for (let s = 0; s <= last; s += 1) {
        const key = order[s];
        const hours = key === "REQUESTED" ? 0 : key === "ASSIGNED" ? 1 : key === "CONTACTED" ? contactHours || 4 : key === "FOLLOW_UP" ? (contactHours || 4) + 24 : (contactHours || 4) + 72;
        history.push({ status: key, at: new Date(createdAt.getTime() + hours * 3600000), byRole: key === "REQUESTED" ? "STUDENT" : ROLES.COUNSELLOR });
      }
    }
    const closed = status === "RESOLVED";
    return {
      _id,
      reference: `SUP-${String(_id).slice(-6).toUpperCase()}`,
      student: students[i % students.length]._id,
      origin: checkLater ? "CHECK_ON_ME_LATER" : "STUDENT_REQUEST",
      preference,
      anonymous,
      preferredTime: ["ANY", "EVENING", "AFTERNOON"][i % 3],
      urgent: false,
      band: band || undefined,
      repeatedDifficulty: band === "SUPPORT_RECOMMENDED",
      status,
      assignedTo: status === "REQUESTED" || checkLater ? undefined : counsellor._id,
      followUpAt: status === "FOLLOW_UP" ? new Date(now.getTime() + (checkLater ? -1 : 2) * DAY) : undefined,
      outcome: outcome || undefined,
      history,
      closedAt: closed ? history[history.length - 1].at : undefined,
      createdAt,
      updatedAt: history[history.length - 1].at
    };
  });
  // Raw insert so the historical timestamps are kept as written.
  await SupportCase.collection.insertMany(cases.map((row) => Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined))));

  // Anonymous aggregate check-in history (bands only) across other students.
  const bands = ["STABLE", "STABLE", "STABLE", "COULD_BENEFIT", "STABLE", "COULD_BENEFIT", "SUPPORT_RECOMMENDED", "STABLE", "STABLE", "COULD_BENEFIT", "STABLE", "STABLE"];
  const scores = { STABLE: 1, COULD_BENEFIT: 5, SUPPORT_RECOMMENDED: 9 };
  const checkIns = bands.map((band, i) => ({
    student: students[(i + 3) % students.length]._id,
    answers: {},
    unsafe: false,
    band,
    score: scores[band],
    createdAt: new Date(now.getTime() - (i * 2 + 1) * DAY),
    updatedAt: new Date(now.getTime() - (i * 2 + 1) * DAY)
  }));
  await WellbeingCheckIn.collection.insertMany(checkIns);

  return { counsellor: 1, cases: cases.length, checkIns: checkIns.length };
}
