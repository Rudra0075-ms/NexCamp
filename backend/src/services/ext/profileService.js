import { ROLES } from "../../config/constants.js";
import { User } from "../../models/User.js";
import { StudentProfile } from "../../models/ext/StudentProfile.js";

/**
 * Academic grouping for students. Reads StudentProfile when a row exists;
 * otherwise derives the same fields from the User record without writing it,
 * and labels the result DERIVED so it is never mistaken for a registry value.
 */

const BRANCH_ABBREVIATIONS = [
  [/COMPUTER SCIENCE/i, "CSE"],
  [/ELECTRONICS/i, "ECE"],
  [/ELECTRICAL/i, "EE"],
  [/MECHANICAL/i, "ME"],
  [/CIVIL/i, "CE"],
  [/INFORMATION TECH/i, "IT"]
];

export function deriveProfile(user = {}) {
  let branch = null;
  for (const [pattern, code] of BRANCH_ABBREVIATIONS) if (pattern.test(user.department || "")) branch = code;
  const idBranch = /^[A-Z]+\/([A-Z]+)\/(\d{2})\//.exec(user.studentId || "");
  if (!branch && idBranch) branch = idBranch[1];
  return {
    branch,
    year: user.semester ? Math.ceil(user.semester / 2) : null,
    batch: idBranch ? `20${idBranch[2]}` : null,
    section: null,
    registeredPhone: user.phone || null,
    source: "DERIVED"
  };
}

/** Merged view: a recorded profile wins field by field; gaps are derived. */
export function mergeProfile(user, recorded) {
  const derived = deriveProfile(user);
  if (!recorded) return { ...derived, hostel: user.hostelName || null, role: user.role };
  return {
    branch: recorded.branch || derived.branch,
    year: recorded.year || derived.year,
    batch: recorded.batch || derived.batch,
    section: recorded.section || derived.section,
    registeredPhone: recorded.registeredPhone || derived.registeredPhone,
    source: "RECORDED",
    hostel: user.hostelName || null,
    role: user.role
  };
}

export async function profileFor(user) {
  const recorded = await StudentProfile.findOne({ student: user._id }).lean();
  return mergeProfile(user, recorded);
}

/** Every user with their merged profile, for audience resolution. */
export async function everyoneWithProfiles({ roles } = {}) {
  const filter = roles?.length ? { role: { $in: roles } } : {};
  const [users, profiles] = await Promise.all([
    User.find(filter).select("name role studentId department semester hostelName room phone managedDepartment").lean(),
    StudentProfile.find().lean()
  ]);
  const byStudent = new Map(profiles.map((p) => [String(p.student), p]));
  return users.map((user) => ({ user, profile: mergeProfile(user, byStudent.get(String(user._id))) }));
}

export async function studentByPhone(phone) {
  const digits = String(phone || "").replace(/[^\d]/g, "").slice(-10);
  if (digits.length < 10) return null;
  const profile = await StudentProfile.findOne({ registeredPhone: new RegExp(`${digits}$`) }).lean();
  if (profile) {
    const user = await User.findOne({ _id: profile.student, role: ROLES.STUDENT });
    if (user) return user;
  }
  return User.findOne({ role: ROLES.STUDENT, phone: new RegExp(`${digits}$`) });
}
