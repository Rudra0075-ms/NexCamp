import { ROLES } from "../../config/constants.js";
import { Attendance } from "../../models/Attendance.js";
import { User } from "../../models/User.js";
import { ClassSchedule } from "../../models/ext/ClassSchedule.js";
import { DocumentRequest } from "../../models/ext/DocumentRequest.js";
import { FeeAccount } from "../../models/ext/FeeAccount.js";
import { Notice } from "../../models/ext/Notice.js";
import { NoticeReceipt } from "../../models/ext/NoticeReceipt.js";
import { StudentProfile } from "../../models/ext/StudentProfile.js";
import { issueDocument, requestDocument, reviewDocument, revokeDocument } from "../../services/ext/certificateService.js";
import { istDateKey, istInstant, weekdayOf } from "../../services/ext/istTime.js";
import { createMenuChange } from "../../services/ext/messChangeService.js";
import { createNotice } from "../../services/ext/noticeService.js";
import { createChange } from "../../services/ext/timetableService.js";
import { subjects, subjectSchedule } from "../data.js";

/**
 * Demo data for Phase 1 of the extension pack. Writes only to the new
 * collections; every existing seed record is left exactly as it was.
 */

const hoursAgo = (h, from = new Date()) => new Date(from.getTime() - h * 3600000);

/** Rewrites timestamps directly in the collection, bypassing Mongoose's own. */
export async function backdate(Model, id, fields) {
  await Model.collection.updateOne({ _id: id }, { $set: fields });
}

async function spreadHistory(Model, id, from, to) {
  const doc = await Model.findById(id).lean();
  const n = doc.history?.length || 0;
  if (!n) return;
  const step = n > 1 ? (to - from) / (n - 1) : 0;
  const history = doc.history.map((h, i) => ({ ...h, at: new Date(from.getTime() + step * i) }));
  await Model.collection.updateOne({ _id: id }, { $set: { history } });
}

export async function seedProfiles(students) {
  // Two sections of CSE year 3 (batch 2022). The registered phones are
  // placeholders in an unallocated range; the SMS simulator uses them.
  const rows = students.map((student, index) => ({
    student: student._id,
    branch: "CSE",
    year: 3,
    batch: "2022",
    section: index % 2 === 0 ? "A" : "B",
    registeredPhone: `+9190000${String(index + 1).padStart(5, "0")}`,
    source: "RECORDED"
  }));
  await StudentProfile.insertMany(rows);
  return rows;
}

const ROOMS = { A: ["LH-101", "LH-102", "LAB-1"], B: ["LH-201", "LH-202", "LAB-2"] };
const FACULTY = {
  "DATA STRUCTURES": "Dr. S. Mohapatra",
  DBMS: "Dr. P. Nanda",
  "OPERATING SYSTEMS": "Prof. R. Sahu",
  "DISCRETE MATHS": "Dr. K. Behera",
  "DIGITAL ELECTRONICS": "Prof. M. Rath",
  "COMMUNICATION SKILLS": "Ms. L. Dash"
};

export async function seedSchedules() {
  const docs = [];
  for (const section of ["A", "B"]) {
    for (const [subject, code] of subjects) {
      for (const [weekday, slot] of subjectSchedule[subject] || []) {
        const [h, m] = slot.split(":").map(Number);
        const end = `${String(h).padStart(2, "0")}:${String(m + 55).padStart(2, "0")}`;
        docs.push({
          branch: "CSE",
          year: 3,
          section,
          subject,
          subjectCode: code,
          weekday,
          startTime: slot,
          endTime: end,
          room: ROOMS[section][(code.charCodeAt(4) + weekday) % 3],
          faculty: FACULTY[subject]
        });
      }
    }
  }
  return ClassSchedule.insertMany(docs);
}

/** Next IST date (from tomorrow) on which section A has a class. */
function nextClassDay(schedules, now) {
  for (let i = 1; i <= 7; i += 1) {
    const key = istDateKey(now, i);
    const day = schedules.filter((s) => s.section === "A" && s.weekday === weekdayOf(key)).sort((a, b) => a.startTime.localeCompare(b.startTime));
    if (day.length) return { key, day };
  }
  return null;
}

export async function seedClassChanges(schedules, admin, demoStudent) {
  const now = new Date();
  const out = [];
  const next = nextClassDay(schedules, now);
  if (next) {
    // The first class of the next teaching day is cancelled, the second changes room.
    out.push(await createChange(admin, { scheduleId: String(next.day[0]._id), sessionDate: next.key, type: "CANCEL", reason: "Faculty on university exam duty" }, { now: istInstant(istDateKey(now, -1), "15:00") }));
    if (next.day[1]) {
      out.push(await createChange(admin, { scheduleId: String(next.day[1]._id), sessionDate: next.key, type: "ROOM", newRoom: "SEMINAR HALL 2", reason: "Projector repair in the usual room" }, { now: istInstant(istDateKey(now, -1), "15:10") }));
    }
  }
  // A cancelled class in the last fortnight that the register still holds for
  // the demo student as an absence — the adjusted-attendance view shows it as
  // "cancelled — not counted" without touching the register.
  const records = await Attendance.find({ student: demoStudent._id }).lean();
  const cutoff = Date.now() - 14 * 864e5;
  for (const record of records) {
    const miss = [...record.sessions].reverse().find((s) => !s.present && new Date(s.date).getTime() > cutoff);
    if (!miss) continue;
    const key = istDateKey(miss.date);
    const schedule = schedules.find((s) => s.section === "A" && s.subject === record.subject && s.weekday === weekdayOf(key) && s.startTime === miss.slot);
    if (!schedule) continue;
    out.push(
      await createChange(admin, { scheduleId: String(schedule._id), sessionDate: key, type: "CANCEL", reason: "Department seminar — class called off" }, { now: new Date(istInstant(key, "10:00").getTime() - 2 * 864e5) })
    );
    break;
  }
  return out;
}

export async function seedMenuChange(messManagerLike) {
  const tomorrow = istDateKey(new Date(), 1);
  return createMenuChange(
    messManagerLike,
    { date: tomorrow, meal: "LUNCH", items: ["RICE · RAJMA", "ROTI · MIX VEG", "CURD"], reason: "Supplier delivery delayed" },
    { now: istInstant(istDateKey(new Date(), -1), "18:00") }
  );
}

/** Deterministic read / act pattern for seeded receipts. */
async function simulateEngagement(notice, { readShare, ackShare, doneShare, keepUnread = [] }) {
  const receipts = await NoticeReceipt.find({ notice: notice._id }).sort({ _id: 1 });
  const base = new Date(notice.publishedAt).getTime();
  for (const [i, r] of receipts.entries()) {
    if (keepUnread.some((id) => String(id) === String(r.student))) continue;
    const roll = ((i * 37) % 100) / 100;
    const set = {};
    if (roll < 0.9) set.deliveredAt = new Date(base + (5 + i) * 60000);
    if (roll < readShare) set.readAt = new Date(base + (20 + i * 7) * 60000);
    if (roll < ackShare) set.acknowledgedAt = new Date(base + (30 + i * 7) * 60000);
    if (notice.actionRequired?.label && roll < doneShare) set.actionDoneAt = new Date(base + (90 + i * 11) * 60000);
    if (Object.keys(set).length) await NoticeReceipt.updateOne({ _id: r._id }, { $set: set });
  }
}

export async function seedNotices(admin, warden, demoStudent) {
  const now = new Date();
  const at = (h) => hoursAgo(h, now);
  // Anchored to IST clock times on earlier days, so the same notices are held
  // (or not) for quiet hours whatever time the seed is run.
  const ist = (daysBack, hhmm) => istInstant(istDateKey(now, -daysBack), hhmm);
  const n1 = await createNotice(
    { title: "Hostel B water supply shutdown for pump replacement", body: "Water supply in Hostel B will be off on Sunday from 10:00 to 13:00 while booster pump 2 is replaced. Store water the night before.", priority: "HIGH", audience: { hostels: ["HOSTEL B"] } },
    warden,
    { now: ist(1, "11:15") }
  );
  await simulateEngagement(n1, { readShare: 0.7, ackShare: 0.5, doneShare: 0 });

  const n2 = await createNotice(
    {
      title: "Submit the mid-semester examination form",
      body: "CSE year 3: submit the mid-semester examination form on the university portal. Late forms are not accepted.",
      priority: "HIGH",
      audience: { branches: ["CSE"], years: [3] },
      actionRequired: { label: "Submit exam form", deadline: new Date(now.getTime() + 3 * 864e5) }
    },
    admin,
    { now: ist(1, "16:30") }
  );
  await simulateEngagement(n2, { readShare: 0.62, ackShare: 0.45, doneShare: 0.3, keepUnread: [demoStudent._id] });

  const n3 = await createNotice(
    { title: "Gas cylinder safety inspection — Hostel C kitchens closed", body: "Pantry kitchens in Hostel C are closed until the LPG line inspection is complete. Do not use induction plates in rooms.", priority: "CRITICAL", audience: { hostels: ["HOSTEL C"] }, escalateAfterHours: 2 },
    admin,
    { now: at(5) }
  );
  await simulateEngagement(n3, { readShare: 0.4, ackShare: 0.2, doneShare: 0 });

  const n4 = await createNotice(
    { title: "Library open until 23:00 during exam fortnight", body: "The central library and Wi-Fi Zone C stay open until 23:00 from Monday for two weeks.", priority: "INFO", audience: { roles: ["STUDENT"] } },
    admin,
    { now: ist(2, "12:00") }
  );
  await simulateEngagement(n4, { readShare: 0.55, ackShare: 0.1, doneShare: 0 });

  // Written at 22:40 last night, so it was held for quiet hours; the monitor
  // releases it in the 07:30 digest.
  const lastNight = istInstant(istDateKey(now, -1), "22:40");
  const n5 = await createNotice(
    { title: "Section A lab records due on Monday", body: "CSE 3A: bring the completed Data Structures lab record to the Monday lab.", priority: "NORMAL", audience: { branches: ["CSE"], years: [3], sections: ["A"] } },
    admin,
    { now: lastNight }
  );

  // Scheduled for tomorrow morning.
  const tomorrowMorning = istInstant(istDateKey(now, 1), "08:15");
  await createNotice(
    { title: "Blood donation camp at the Medical Centre", body: "The NSS blood donation camp runs 09:00–16:00 at the Medical Centre. Walk in with your ID card.", priority: "INFO", audience: { roles: ["STUDENT"] }, scheduledFor: tomorrowMorning },
    admin,
    { now: at(1) }
  );
  return [n1, n2, n3, n4, n5];
}

export async function seedDocuments(students, admin, operator) {
  const [demo, s1, s2, s3, s4] = students;
  const now = new Date();

  // Demo student: a bonafide issued three days ago in 20 hours.
  const a = await requestDocument(demo, { type: "BONAFIDE", purpose: "Education loan application — State Bank of India" });
  const aCreated = hoursAgo(74, now);
  await reviewDocument(a._id, admin, { decision: "START_REVIEW" });
  await reviewDocument(a._id, admin, { decision: "APPROVE" });
  const aIssued = hoursAgo(54, now);
  await issueDocument(a._id, admin, { now: aIssued });
  await backdate(DocumentRequest, a._id, { createdAt: aCreated, dueAt: new Date(aCreated.getTime() + 24 * 3600000), reviewedAt: hoursAgo(60, now) });
  await spreadHistory(DocumentRequest, a._id, aCreated, aIssued);

  // Demo student: hostel residence under review.
  const b = await requestDocument(demo, { type: "HOSTEL_RESIDENCE", purpose: "Scholarship verification (post-matric)" });
  await reviewDocument(b._id, admin, { decision: "START_REVIEW" });
  const bCreated = hoursAgo(20, now);
  await backdate(DocumentRequest, b._id, { createdAt: bCreated, dueAt: new Date(bCreated.getTime() + 48 * 3600000) });
  await spreadHistory(DocumentRequest, b._id, bCreated, hoursAgo(6, now));

  // Another student: no-dues waiting (they have outstanding fees — evidence).
  const c = await requestDocument(s1, { type: "NO_DUES", purpose: "Internship joining formalities" });
  const cCreated = hoursAgo(80, now);
  await backdate(DocumentRequest, c._id, { createdAt: cCreated, dueAt: new Date(cCreated.getTime() + 72 * 3600000) });
  await spreadHistory(DocumentRequest, c._id, cCreated, cCreated);

  // Rejected with a reason.
  const d = await requestDocument(s2, { type: "CHARACTER", purpose: "Passport application" });
  await reviewDocument(d._id, admin, { decision: "REJECT", reason: "Passport offices accept the bonafide certificate; please request that instead." });
  const dCreated = hoursAgo(40, now);
  await backdate(DocumentRequest, d._id, { createdAt: dCreated, reviewedAt: hoursAgo(30, now), dueAt: new Date(dCreated.getTime() + 72 * 3600000) });
  await spreadHistory(DocumentRequest, d._id, dCreated, hoursAgo(30, now));

  // Issued, then revoked.
  const e = await requestDocument(s3, { type: "BONAFIDE", purpose: "Railway concession" });
  await reviewDocument(e._id, admin, { decision: "APPROVE" });
  const eCreated = hoursAgo(130, now);
  const eIssued = hoursAgo(118, now);
  await issueDocument(e._id, admin, { now: eIssued });
  await revokeDocument(e._id, admin, "Issued against the wrong semester; replaced by a corrected certificate.");
  await backdate(DocumentRequest, e._id, { createdAt: eCreated, dueAt: new Date(eCreated.getTime() + 24 * 3600000) });
  await spreadHistory(DocumentRequest, e._id, eCreated, hoursAgo(100, now));

  // Filed at the kiosk, approved and waiting to be issued.
  const f = await requestDocument(s4, { type: "BONAFIDE", purpose: "Bank account opening" }, { channel: "KIOSK", operator });
  await reviewDocument(f._id, admin, { decision: "APPROVE" });
  const fCreated = hoursAgo(9, now);
  await backdate(DocumentRequest, f._id, { createdAt: fCreated, dueAt: new Date(fCreated.getTime() + 24 * 3600000) });
  await spreadHistory(DocumentRequest, f._id, fCreated, hoursAgo(4, now));

  return DocumentRequest.find().lean();
}

export async function seedFees(students) {
  const now = new Date();
  const day = 864e5;
  const rows = students.map((student, i) => {
    const demo = i === 0;
    const tuitionPaid = i % 7 === 3 ? 30000 : 48500;
    const hostelPaid = i % 5 === 2 ? 0 : 22000;
    const messPaid = demo ? 0 : i % 3 === 0 ? 18000 : i % 3 === 1 ? 9000 : 0;
    const fine = demo ? 200 : i % 6 === 4 ? 500 : 0;
    const heads = [
      { head: "TUITION", label: "Tuition (semester 5)", amount: 48500, paid: tuitionPaid, dueDate: new Date(now.getTime() - 40 * day), payments: tuitionPaid ? [{ amount: tuitionPaid, at: new Date(now.getTime() - 45 * day), receipt: `RCP-T-${1000 + i}`, mode: "ONLINE" }] : [] },
      { head: "HOSTEL", label: "Hostel rent (Jul–Dec)", amount: 22000, paid: hostelPaid, dueDate: new Date(now.getTime() + 12 * day), payments: hostelPaid ? [{ amount: hostelPaid, at: new Date(now.getTime() - 30 * day), receipt: `RCP-H-${1000 + i}`, mode: "BANK" }] : [] },
      { head: "MESS", label: "Mess advance (Oct–Dec)", amount: 18000, paid: messPaid, dueDate: new Date(now.getTime() + 5 * day), payments: messPaid ? [{ amount: messPaid, at: new Date(now.getTime() - 8 * day), receipt: `RCP-M-${1000 + i}`, mode: "ONLINE" }] : [] }
    ];
    if (fine) heads.push({ head: "FINES", label: demo ? "Library late return" : "Hostel curfew fine", amount: fine, paid: 0, dueDate: new Date(now.getTime() - 3 * day), payments: [] });
    return { student: student._id, academicYear: "2026-27", heads };
  });
  return FeeAccount.insertMany(rows);
}

export async function loadActors() {
  const admin = await User.findOne({ role: ROLES.ADMIN });
  const warden = await User.findOne({ role: ROLES.WARDEN });
  const facility = await User.findOne({ role: ROLES.FACILITY_MANAGER });
  const students = await User.find({ role: ROLES.STUDENT }).sort({ studentId: 1 });
  return { admin, warden, facility, students };
}

export { Notice };
