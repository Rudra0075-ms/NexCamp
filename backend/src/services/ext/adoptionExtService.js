import { DEPARTMENTS, ROLES } from "../../config/constants.js";
import { Building } from "../../models/Building.js";
import { User } from "../../models/User.js";
import { ClassSchedule } from "../../models/ext/ClassSchedule.js";
import { FeeAccount } from "../../models/ext/FeeAccount.js";
import { PolicySection, POLICY_CATEGORIES } from "../../models/ext/PolicySection.js";
import { StudentProfile } from "../../models/ext/StudentProfile.js";
import { ApiError } from "../../utils/ApiError.js";

/**
 * College adoption — extension (PS07 extension 2H).
 *
 * Lives beside the existing College Adoption & Migration panel and its student
 * CSV check, which are unchanged. Adds the other datasets a college must bring
 * across, a CSV template for each, and a dry-run validator for each. Nothing
 * is ever written: every response says `dryRun: true, written: 0`.
 */

export function parseCsv(text) {
  const rows = [];
  for (const line of String(text || "").replace(/\r/g, "").split("\n")) {
    if (!line.trim()) continue;
    const cells = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"' && quoted && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) {
        cells.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    cells.push(cur.trim());
    rows.push(cells);
  }
  return rows;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WEEKDAYS = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

export const DATASETS = {
  students: {
    label: "Students (academic grouping)",
    columns: ["student id", "branch", "year", "section", "batch", "registered phone"],
    example: [["BPUT/CSE/22/0417", "CSE", "3", "A", "2022", "+919000000001"], ["BPUT/ECE/23/0102", "ECE", "2", "B", "2023", ""]],
    note: "Extends the existing student CSV check (Student ID | Name | Branch | Year | Hostel) with section, batch and the phone the SMS channel accepts."
  },
  rooms: {
    label: "Hostel rooms",
    columns: ["hostel", "room", "floor", "capacity"],
    example: [["HOSTEL B", "B-214", "2", "2"], ["HOSTEL C", "C-104", "1", "3"]]
  },
  timetable: {
    label: "Timetable",
    columns: ["branch", "year", "section", "subject", "subject code", "weekday", "start", "end", "room", "faculty"],
    example: [["CSE", "3", "A", "DBMS", "CS203", "MON", "08:00", "08:55", "LH-101", "Dr. P. Nanda"]]
  },
  fees: {
    label: "Fee heads",
    columns: ["student id", "academic year", "head", "amount", "paid", "due date"],
    example: [["BPUT/CSE/22/0417", "2026-27", "TUITION", "48500", "48500", "2026-08-15"], ["BPUT/CSE/22/0417", "2026-27", "MESS", "18000", "0", "2026-10-01"]]
  },
  staff: {
    label: "Staff accounts",
    columns: ["name", "email", "role", "department", "hostel"],
    example: [["Hostel C Warden", "warden.hostelc@bput.ac.in", "WARDEN", "MAINTENANCE · PLUMBING", "HOSTEL C"]]
  },
  policy: {
    label: "Policy corpus (FAQ)",
    columns: ["key", "category", "title", "body", "keywords", "source"],
    example: [["HOSTEL-IN-TIME", "HOSTEL", "Hostel in-time", "Residents must be back by 21:30 …", "curfew;in-time;late", "Hostel Rules 2026 cl. 4"]]
  }
};

const csvEscape = (v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v);

export function template(dataset) {
  const spec = DATASETS[dataset];
  if (!spec) throw ApiError.notFound("Unknown dataset");
  return [spec.columns, ...spec.example].map((row) => row.map(csvEscape).join(",")).join("\n") + "\n";
}

async function context() {
  const [hostels, users, profiles, policyKeys] = await Promise.all([
    Building.find({ type: "HOSTEL" }).select("name code").lean(),
    User.find().select("email studentId role").lean(),
    StudentProfile.find().select("registeredPhone").lean(),
    PolicySection.find().select("key").lean()
  ]);
  return {
    hostels: new Map(hostels.flatMap((h) => [[h.name.toUpperCase(), h.name], [h.code.toUpperCase(), h.name]])),
    studentIds: new Set(users.filter((u) => u.studentId).map((u) => u.studentId.toUpperCase())),
    emails: new Set(users.map((u) => u.email)),
    phones: new Set(profiles.map((p) => p.registeredPhone).filter(Boolean)),
    policyKeys: new Set(policyKeys.map((p) => p.key))
  };
}

/** Pure per-row checks. `ctx` carries the live lookups. Returns issues[] and the status. */
export function checkRow(dataset, row, ctx, seen) {
  const issues = [];
  const warn = [];
  const r = row;
  if (dataset === "students") {
    const id = (r["student id"] || "").toUpperCase();
    if (!id) issues.push("Student ID is empty");
    else if (!ctx.studentIds.has(id)) issues.push("No student with this ID — import students first (existing CSV check)");
    if (!/^[A-Z]{2,5}$/i.test(r.branch || "")) issues.push("Branch must be a 2–5 letter code");
    if (!/^[1-6]$/.test(r.year || "")) issues.push("Year must be 1–6");
    if (r.section && !/^[A-Z]$/i.test(r.section)) issues.push("Section must be one letter");
    if (r.batch && !/^20\d{2}$/.test(r.batch)) issues.push("Batch must be a year like 2022");
    if (r["registered phone"]) {
      if (!/^\+?\d{10,13}$/.test(r["registered phone"].replace(/\s/g, ""))) issues.push("Phone must be 10–13 digits");
      else if (seen.has(`p:${r["registered phone"]}`)) issues.push("Phone repeated in this file");
      seen.add(`p:${r["registered phone"]}`);
    }
    if (seen.has(`id:${id}`)) issues.push("Duplicate student ID in this file");
    seen.add(`id:${id}`);
  } else if (dataset === "rooms") {
    if (!ctx.hostels.has((r.hostel || "").toUpperCase())) issues.push(`Hostel "${r.hostel}" is not a known hostel`);
    if (!r.room) issues.push("Room is empty");
    if (r.floor && !/^\d{1,2}$/.test(r.floor)) issues.push("Floor must be a number");
    if (!/^[1-8]$/.test(r.capacity || "")) issues.push("Capacity must be 1–8");
    const key = `${(r.hostel || "").toUpperCase()}:${(r.room || "").toUpperCase()}`;
    if (seen.has(key)) issues.push("Room repeated in this file");
    seen.add(key);
  } else if (dataset === "timetable") {
    if (!/^[A-Z]{2,5}$/i.test(r.branch || "")) issues.push("Branch must be a 2–5 letter code");
    if (!/^[1-6]$/.test(r.year || "")) issues.push("Year must be 1–6");
    if (!/^[A-Z]$/i.test(r.section || "")) issues.push("Section must be one letter");
    if (!r.subject) issues.push("Subject is empty");
    if (!WEEKDAYS.includes((r.weekday || "").slice(0, 3).toUpperCase())) issues.push("Weekday must be MON–SUN");
    if (!TIME.test(r.start || "")) issues.push("Start must be HH:MM");
    if (r.end && !TIME.test(r.end)) issues.push("End must be HH:MM");
    if (TIME.test(r.start || "") && TIME.test(r.end || "") && r.end <= r.start) issues.push("End is not after start");
    const slot = `${r.branch}|${r.year}|${r.section}|${(r.weekday || "").slice(0, 3).toUpperCase()}|${r.start}`.toUpperCase();
    if (seen.has(slot)) issues.push("Two classes for this section at the same time");
    seen.add(slot);
    if (!r.room) warn.push("No room given");
  } else if (dataset === "fees") {
    const id = (r["student id"] || "").toUpperCase();
    if (!ctx.studentIds.has(id)) issues.push("No student with this ID");
    if (!/^\d{4}-\d{2}$/.test(r["academic year"] || "")) issues.push("Academic year must look like 2026-27");
    if (!["TUITION", "HOSTEL", "MESS", "FINES"].includes((r.head || "").toUpperCase())) issues.push("Head must be TUITION, HOSTEL, MESS or FINES");
    const amount = Number(r.amount);
    const paid = Number(r.paid || 0);
    if (!Number.isFinite(amount) || amount < 0) issues.push("Amount must be a positive number");
    if (!Number.isFinite(paid) || paid < 0) issues.push("Paid must be a positive number");
    if (Number.isFinite(amount) && Number.isFinite(paid) && paid > amount) issues.push("Paid is more than the amount");
    if (r["due date"] && !DATE.test(r["due date"])) issues.push("Due date must be YYYY-MM-DD");
    const key = `${id}|${r["academic year"]}|${(r.head || "").toUpperCase()}`;
    if (seen.has(key)) issues.push("Same head twice for this student and year");
    seen.add(key);
  } else if (dataset === "staff") {
    if (!r.name) issues.push("Name is empty");
    const email = (r.email || "").toLowerCase();
    if (!EMAIL.test(email)) issues.push("Email is not valid");
    if (ctx.emails.has(email)) issues.push("An account with this email already exists");
    if (seen.has(email)) issues.push("Email repeated in this file");
    seen.add(email);
    const role = (r.role || "").toUpperCase();
    if (!Object.values(ROLES).includes(role) || role === "STUDENT") issues.push("Role must be ADMIN, WARDEN, FACILITY_MANAGER or MESS_MANAGER");
    if (r.department && !DEPARTMENTS.includes(r.department)) issues.push(`Department must be one of the ${DEPARTMENTS.length} known departments`);
    if (role === "WARDEN" && !ctx.hostels.has((r.hostel || "").toUpperCase())) issues.push("A warden needs a known hostel");
  } else if (dataset === "policy") {
    if (!/^[A-Z0-9-]{3,40}$/.test(r.key || "")) issues.push("Key must be 3–40 capital letters, digits or dashes");
    if (!POLICY_CATEGORIES.includes((r.category || "").toUpperCase())) issues.push(`Category must be one of ${POLICY_CATEGORIES.join(", ")}`);
    if (!r.title) issues.push("Title is empty");
    if ((r.body || "").length < 20) issues.push("Body is too short to answer a question");
    if (!r.source) warn.push("No source given — answers will not be citable");
    if (ctx.policyKeys.has(r.key)) warn.push("Key exists — an import would create a new version");
    if (seen.has(r.key)) issues.push("Key repeated in this file");
    seen.add(r.key);
  }
  const status = issues.length ? "ERROR" : warn.length ? "READY · WITH WARNINGS" : "READY";
  return { issues, warnings: warn, status };
}

export async function validateDataset(dataset, csv) {
  const spec = DATASETS[dataset];
  if (!spec) throw ApiError.notFound("Unknown dataset");
  const rows = parseCsv(csv);
  if (!rows.length) throw ApiError.badRequest("The file is empty");
  const header = rows[0].map((h) => h.toLowerCase().trim());
  const missing = spec.columns.filter((c) => !header.includes(c));
  if (missing.length) throw ApiError.badRequest(`Missing column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}. Expected: ${spec.columns.join(" | ")}`);
  const ctx = await context();
  const seen = new Set();
  const body = rows.slice(1, 501);
  const results = body.map((cells, i) => {
    const row = Object.fromEntries(spec.columns.map((c) => [c, (cells[header.indexOf(c)] || "").trim()]));
    return { line: i + 2, ...checkRow(dataset, row, ctx, seen), preview: spec.columns.slice(0, 3).map((c) => row[c]).join(" · ") };
  });
  return {
    dataset,
    label: spec.label,
    dryRun: true,
    written: 0,
    total: results.length,
    ready: results.filter((r) => r.status.startsWith("READY")).length,
    errors: results.filter((r) => r.status === "ERROR").length,
    truncated: rows.length - 1 > body.length,
    results,
    note: "Dry run: every row was checked (against the live records where relevant) and nothing was written."
  };
}

export async function readiness() {
  const [students, profiles, schedules, fees, policy, staff, wardens, hostels] = await Promise.all([
    User.countDocuments({ role: ROLES.STUDENT }),
    StudentProfile.countDocuments(),
    ClassSchedule.countDocuments(),
    FeeAccount.countDocuments(),
    PolicySection.countDocuments(),
    User.countDocuments({ role: { $ne: ROLES.STUDENT } }),
    User.countDocuments({ role: ROLES.WARDEN }),
    Building.countDocuments({ type: "HOSTEL" })
  ]);
  const datasets = [
    { dataset: "students", label: DATASETS.students.label, loaded: profiles, of: students, unit: "students with a section" },
    { dataset: "rooms", label: DATASETS.rooms.label, loaded: null, of: null, unit: "rooms are stored on the student record today; a room register is the first import" },
    { dataset: "timetable", label: DATASETS.timetable.label, loaded: schedules, of: null, unit: "weekly class meetings" },
    { dataset: "fees", label: DATASETS.fees.label, loaded: fees, of: students, unit: "fee accounts" },
    { dataset: "staff", label: DATASETS.staff.label, loaded: staff, of: null, unit: `staff accounts (${wardens} warden${wardens === 1 ? "" : "s"} for ${hostels} hostels)` },
    { dataset: "policy", label: DATASETS.policy.label, loaded: policy, of: null, unit: "policy sections" }
  ];
  const phases = [
    { phase: 1, name: "One hostel pilot", scope: "Hostel B — the hostel with the most complaint history", weeks: "2–3", exit: ["Every Hostel B student has a recorded section and phone", "Gate passes and complaints for Hostel B run only through the system for two weeks", "Notice read rate above 70% without WhatsApp forwarding", "Friction Ledger shows ≥30% reduction on complaints and gate passes"], rollback: "Paper gate-pass slips stay printed for the pilot; the warden can fall back the same day." },
    { phase: 2, name: "One department", scope: "CSE year 3 — timetable, class changes, documents and fees", weeks: "3–4", exit: ["Timetable imported and class changes announced only through notices", "Bonafide and no-dues certificates issued with QR verification", "Office FAQ answers ≥60% of questions from the policy corpus"], rollback: "The academic office keeps the manual register in parallel for the first month." },
    { phase: 3, name: "Whole campus", scope: "All hostels, departments and the help-desk kiosk", weeks: "6–8", exit: ["All six datasets imported with zero ERROR rows", "SMS keyword channel registered for students without smartphones", "Mission Control used for the daily briefing"], rollback: "Per-hostel switch-back: notices can be forwarded to the old WhatsApp groups during transition." }
  ];
  return { readiness: datasets, phases, method: "DATABASE_COUNTS", kind: "ACTUAL DATA" };
}
