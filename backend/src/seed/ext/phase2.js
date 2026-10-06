import zlib from "node:zlib";
import { Building } from "../../models/Building.js";
import { Complaint } from "../../models/Complaint.js";
import { GatePass } from "../../models/GatePass.js";
import { FixConfirmation } from "../../models/ext/FixConfirmation.js";
import { PolicySection } from "../../models/ext/PolicySection.js";
import { SmsMessage } from "../../models/ext/SmsMessage.js";
import { StudentProfile } from "../../models/ext/StudentProfile.js";
import { classify } from "../../services/classificationService.js";
import { ask } from "../../services/ext/faqService.js";
import { attachProof, confirmFix, ensureConfirmation } from "../../services/ext/fixService.js";
import { ensureBaselines } from "../../services/ext/frictionService.js";
import { handleInbound } from "../../services/ext/smsKeywordService.js";
import { backdate } from "./phase1.js";

/**
 * Demo data for Phase 2 of the extension pack.
 *
 * Proof-of-fix and the Friction Ledger need finished work to show. The base
 * seed has no resolved complaint and no gate pass, so this adds a small,
 * clearly identified history: six RESOLVED complaints with the reserved
 * references CMP-1901…CMP-1906 and three closed gate passes GP-YYYY-H000n.
 * They are inserted directly — never clustered into an incident, never
 * counted on a building — and avoid the Hostel B water incident entirely.
 * Pass --no-history to skip them.
 */

export const HISTORY_REFS = ["CMP-1901", "CMP-1902", "CMP-1903", "CMP-1904", "CMP-1905", "CMP-1906"];
const HISTORY_GP = /^GP-\d{4}-H\d{4}$/;

export async function clearHistory() {
  await Complaint.deleteMany({ reference: { $in: HISTORY_REFS } });
  await GatePass.deleteMany({ reference: HISTORY_GP });
}

const hoursAgo = (h) => new Date(Date.now() - h * 3600000);

// ---- a tiny PNG, so the seeded proof-of-fix has a real (compressed) image ----

function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixel(x, y);
      const o = y * (width * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** A stylised "after" photo: a wall, a pipe and a tap, in flat colours. */
const fixPhoto = (tone) =>
  `data:image/png;base64,${png(160, 120, (x, y) => {
    if (y > 96) return [120, 110, 100];
    if (y > 40 && y < 48 && x > 20 && x < 140) return [150, 150, 158];
    if (x > 96 && x < 104 && y >= 48 && y < 70) return [150, 150, 158];
    if (x > 90 && x < 110 && y >= 70 && y < 76) return [200, 200, 205];
    return tone;
  }).toString("base64")}`;

const HISTORY = [
  // [ref, studentIndex, buildingCode, category, title, description, createdHoursAgo, resolveAfterHours, fix]
  ["CMP-1901", 0, "HST-B", "ELECTRICITY", "Tube light flickering in B-214", "The tube light in room B-214 keeps flickering and switches off at night.", 30, 5.5, "Choke and tube replaced in B-214"],
  ["CMP-1902", 0, "LIB", "WI-FI", "Wi-Fi drops on the library first floor", "Wi-Fi keeps disconnecting on the first floor of the library near the reading hall.", 150, 26, "Access point C4-2 reset and firmware updated"],
  ["CMP-1903", 3, "HST-A", "WATER", "Tap leaking in A-block washroom", "The tap in the first-floor washroom of Hostel A has been leaking for two days.", 120, 8, "Tap washer and spindle replaced"],
  ["CMP-1904", 5, "HST-C", "CLEANLINESS", "Garbage not cleared near C-104", "The dustbin near C-104 has not been emptied for three days and smells.", 100, 11, "Bin cleared; daily pickup added to the roster"],
  ["CMP-1905", 8, "MESS-C", "MESS", "Drinking water cooler not cooling", "The water cooler at the central mess counter is giving warm water.", 90, 30, "Cooler compressor gas refilled"],
  ["CMP-1906", 11, "HST-C", "ELECTRICITY", "Corridor light off on C second floor", "The corridor light on the second floor of Hostel C is not working.", 60, 4, "Corridor MCB replaced"]
];

async function seedResolvedHistory(students, resolver) {
  const byCode = new Map((await Building.find().lean()).map((b) => [b.code, b]));
  const out = [];
  for (const [reference, si, code, category, title, description, createdAgo, after, fix] of HISTORY) {
    const student = students[si];
    const building = byCode.get(code);
    const at = hoursAgo(createdAgo);
    const resolvedAt = new Date(at.getTime() + after * 3600000);
    const complaint = new Complaint({
      reference,
      student: student._id,
      title,
      description,
      category,
      location: `${building.name} · ${student.room || "common area"}`,
      building: building._id,
      channel: "APP",
      audit: [{ at, actor: student.name, message: `Report submitted by student · ${building.name}`, kind: "ACTUAL DATA" }]
    });
    const { classification } = await classify(complaint, { building });
    Object.assign(complaint, {
      aiClassification: classification,
      category: classification.category,
      priority: classification.priority,
      severity: classification.severity,
      department: classification.routedTo,
      status: "RESOLVED",
      resolution: { resolutionTimeHours: after, resolvedBy: resolver._id, resolutionDescription: fix, resolvedAt }
    });
    complaint.audit.push(
      { at, actor: "classificationService", message: `rule-based (AI not configured) classification: ${classification.category} / ${classification.priority}`, kind: "AI PREDICTION" },
      { at: new Date(at.getTime() + 20 * 60000), actor: "system", message: `Assigned to ${classification.routedTo}`, kind: "ACTUAL DATA" },
      { at: resolvedAt, actor: resolver.name, message: `Resolved — ${fix}`, kind: "ACTUAL DATA" }
    );
    await complaint.save();
    await backdate(Complaint, complaint._id, { createdAt: at, updatedAt: resolvedAt });
    out.push(await Complaint.findById(complaint._id));
  }
  return out;
}

async function seedFixFlow(complaints, students, staff) {
  const [c1, c2, c3, c4, c5, c6] = complaints;
  // Proof photos and notes on four of the six.
  await attachProof(c1._id, staff, { note: "New choke fitted; tested for 30 minutes.", photo: fixPhoto([222, 214, 196]) });
  await attachProof(c3._id, staff, { note: "Washer and spindle replaced, no drip after 1 hour.", photo: fixPhoto([205, 222, 214]) });
  await attachProof(c4._id, staff, { note: "Bin emptied and area washed." });
  await attachProof(c6._id, staff, { note: "MCB replaced.", photo: fixPhoto([214, 208, 226]) });
  // c1: resolved yesterday, question still open for the demo student (PENDING).
  // c2: the demo student confirmed YES.
  await ensureConfirmation(c2, c2.resolution.resolvedAt);
  await confirmFix(c2._id, students[0], { response: "YES", comment: "Works now." });
  // c3: NOT FIXED → a linked reopen request and a notice to the department.
  await confirmFix(c3._id, students[3], { response: "NOT_FIXED", comment: "Still dripping at night." });
  // c4, c5: asked more than 48 hours ago, never answered → NO_RESPONSE on the sweep.
  await FixConfirmation.updateOne({ complaint: c4._id }, { $set: { askedAt: c4.resolution.resolvedAt } });
  await ensureConfirmation(c5, c5.resolution.resolvedAt);
  // c6: answered YES.
  await confirmFix(c6._id, students[11], { response: "YES" });
}

async function seedClosedGatePasses(students, warden) {
  const rows = [
    [0, 50, 1.5, "Visit to the SBI branch for the education loan", "Rourkela Main Road"],
    [2, 76, 3.2, "Dental appointment", "Ispat General Hospital"],
    [6, 28, 0.8, "Buying lab record books", "Udit Nagar market"]
  ];
  const year = new Date().getFullYear();
  for (const [i, [si, createdAgo, decideAfter, reason, destination]] of rows.entries()) {
    const student = students[si];
    const created = hoursAgo(createdAgo);
    const decided = new Date(created.getTime() + decideAfter * 3600000);
    const leave = new Date(decided.getTime() + 3600000);
    const back = new Date(leave.getTime() + 4 * 3600000);
    const gp = await GatePass.create({
      reference: `GP-${year}-H${String(i + 1).padStart(4, "0")}`,
      student: student._id,
      hostel: student.hostel,
      hostelName: student.hostelName,
      room: student.room,
      date: leave,
      reason,
      destination,
      channel: "APP",
      leaveAt: leave,
      expectedReturnAt: back,
      status: "RETURNED",
      parent: { name: student.parentName, phoneMasked: "+91XXXXXX0000", verified: true, verifiedAt: new Date(created.getTime() + 10 * 60000) },
      approval: { decision: "APPROVED", decidedBy: warden._id, decidedByName: warden.name, decidedAt: decided },
      pass: { issuedAt: decided, exitScanAt: leave, returnScanAt: new Date(back.getTime() - 20 * 60000), scanCount: 2 },
      exitAt: leave,
      returnAt: new Date(back.getTime() - 20 * 60000),
      actualDurationMinutes: 220,
      events: [
        { at: created, actor: student.name, message: "Gate pass requested", status: "PENDING_PARENT_VERIFICATION" },
        { at: new Date(created.getTime() + 10 * 60000), actor: student.parentName, message: "Guardian verified by SMS code", status: "PARENT_VERIFIED" },
        { at: decided, actor: warden.name, message: "Approved by warden", status: "APPROVED" },
        { at: leave, actor: "gate", message: "Exit scanned", status: "ACTIVE" },
        { at: new Date(back.getTime() - 20 * 60000), actor: "gate", message: "Return scanned", status: "RETURNED" }
      ]
    });
    await backdate(GatePass, gp._id, { createdAt: created, updatedAt: back });
  }
}

export const POLICY_SOURCE = "Demo policy corpus written for this prototype — replace with the college's own rules";

export const POLICY = [
  ["HOSTEL-IN-TIME", "HOSTEL", "Hostel in-time and late entry", "Residents must be inside the hostel by 21:30. Entry between 21:30 and 23:00 is allowed only with an approved gate pass or after the warden is informed; the late entry is recorded in the gate register. Repeated late entry without a pass (three times in a month) is reported to the Chief Warden.", ["curfew", "in-time", "late", "night", "entry", "gate", "time", "return"]],
  ["HOSTEL-GUESTS", "HOSTEL", "Guests and visitors", "Parents and guardians may visit between 16:00 and 19:00 in the visitors' room. Visitors are not allowed in residents' rooms. Overnight guests are not permitted.", ["visitor", "guest", "parent", "visit", "meet"]],
  ["HOSTEL-APPLIANCES", "HOSTEL", "Electrical appliances in rooms", "Heaters, induction plates and electric kettles are not allowed in rooms. Laptops, phone chargers and table lamps are allowed. Appliances found in rooms are removed and returned at the end of the semester.", ["appliance", "heater", "kettle", "induction", "electrical", "iron"]],
  ["HOSTEL-MAINTENANCE", "HOSTEL", "Reporting maintenance problems", "Water, electrical, Wi-Fi and cleanliness problems are reported through the app, the help-desk kiosk, or by SMS (for example: WATER B-214 no water). Every report gets a reference number and a target time; the student is asked to confirm the fix once it is resolved.", ["complaint", "repair", "maintenance", "report", "problem", "leak", "broken", "water", "light"]],
  ["LEAVE-GATE-PASS", "LEAVE", "Gate pass for going out", "A gate pass is needed to leave campus. Apply in the app or at the kiosk; your guardian confirms by an SMS code and the warden approves. Show the QR code at the gate when leaving and returning. A pass is valid for up to 12 hours.", ["gate", "pass", "outing", "leave", "out", "permission", "qr"]],
  ["LEAVE-OVERNIGHT", "LEAVE", "Overnight and home leave", "Leave of more than one night needs a written request countersigned by the guardian and approval from the Chief Warden at least two days in advance. Mess rebate applies for leave of four or more consecutive days.", ["home", "overnight", "weekend", "vacation", "leave", "night"]],
  ["LEAVE-LATE-RETURN", "LEAVE", "Late return from a gate pass", "A student who returns after the approved time is marked late. The guardian and the warden are informed automatically. Two late returns in a month suspend gate-pass applications for seven days.", ["late", "return", "overdue", "delay"]],
  ["FEES-DEADLINES", "FEES", "Fee payment deadlines", "Tuition is due by 15 August for the odd semester and 15 January for the even semester. Hostel rent is due by 15 October and mess advance by 1 October. Payments can be made at the accounts office or on the university portal.", ["fee", "fees", "payment", "deadline", "due", "tuition", "pay", "last date"]],
  ["FEES-LATE-FINE", "FEES", "Late fee and fines", "A late fee of 50 rupees per day applies to tuition paid after the due date, up to 1,500 rupees. Library and hostel fines are added to the fee account and must be cleared before a no-dues certificate is issued.", ["late", "fine", "penalty", "fee"]],
  ["FEES-REFUND", "FEES", "Fee refunds", "Mess advance for leave of four or more days is adjusted in the next mess bill. Caution deposit is refunded within 30 days of the no-dues certificate at the end of the course.", ["refund", "deposit", "caution", "rebate", "money", "back"]],
  ["CERT-BONAFIDE", "CERTIFICATE", "Bonafide certificate", "Request a bonafide certificate in the app or at the kiosk and state the purpose (bank loan, scholarship, passport, concession). The academic office reviews it and the certificate is issued within 24 hours as a PDF with a QR code; anyone can check it on the verify page.", ["bonafide", "certificate", "loan", "passport", "scholarship", "document", "proof"]],
  ["CERT-NO-DUES", "CERTIFICATE", "No-dues certificate", "A no-dues certificate is issued only when the fee account, library and hostel show no outstanding amount. The target time is 72 hours because each section must confirm.", ["no dues", "dues", "clearance", "certificate", "noc"]],
  ["MESS-TIMINGS", "MESS", "Mess timings", "Breakfast 07:30–09:30, lunch 11:30–14:30, snacks 14:30–15:30 and dinner 19:30–21:30. Menu changes are announced as notices; you can also send MENU by SMS for the next meal.", ["mess", "timing", "breakfast", "lunch", "dinner", "food", "meal", "menu", "time"]],
  ["ACAD-ATTENDANCE", "ACADEMIC", "Attendance requirement", "A minimum of 75% attendance in each subject is required to sit the end-semester examination. Classes cancelled by the department are announced as notices and are shown as 'cancelled — not counted' in the adjusted attendance view.", ["attendance", "75", "percent", "short", "exam", "eligible", "detained", "class"]]
];

async function seedPolicy() {
  await PolicySection.insertMany(POLICY.map(([key, category, title, body, keywords]) => ({ key, category, title, body, keywords, source: POLICY_SOURCE, version: 1, updatedByName: "seed" })));
}

async function seedFaqQueries(students) {
  const questions = [
    [0, "What time do I have to be back in the hostel?"],
    [1, "hostel in time at night"],
    [2, "What is the last date for mess fee payment?"],
    [3, "How do I get a bonafide certificate for my bank loan?"],
    [4, "Can my parents visit me in the hostel?"],
    [5, "What time is dinner?"],
    [6, "Is there a late fine for tuition fee?"],
    [7, "Can I keep an electric kettle in my room?"],
    [8, "When will the placement drive start?"],
    [9, "Who is the head of the CSE department?"],
    [10, "What time do I have to be back in the hostel?"],
    [11, "How much attendance is needed for the exam?"]
  ];
  for (const [i, q] of questions) await ask(students[i % students.length], { question: q, lang: "EN" });
}

async function seedSmsLog(students) {
  const profiles = await StudentProfile.find().lean();
  const phoneOf = (s) => profiles.find((p) => String(p.student) === String(s._id))?.registeredPhone;
  const demo = phoneOf(students[0]);
  const other = phoneOf(students[4]);
  const refs = await Complaint.find({ student: students[0]._id }).sort({ createdAt: 1 }).select("reference").lean();
  const script = [
    [demo, "HELP"],
    [demo, "ATT"],
    [demo, "MENU"],
    [demo, "GP"],
    [demo, `STATUS ${refs[0]?.reference || "CMP-2101"}`],
    [other, "ATT"],
    [other, "NOTICE"],
    [other, "HELLO"],
    ["+919876500000", "ATT"]
  ];
  for (const [i, [from, text]] of script.entries()) {
    const { message } = await handleInbound({ from, text, simulated: true, via: "SIMULATOR" });
    // Dated earlier in the day, so the log does not use up the per-number
    // rate limit that a live demo (Tuesday Mode) then needs.
    await backdate(SmsMessage, message._id, { createdAt: hoursAgo(6 - i * 0.5), updatedAt: hoursAgo(6 - i * 0.5) });
  }
}

export async function seedPhase2({ admin, warden, facility, students }) {
  await ensureBaselines();
  await seedPolicy();
  if (!process.argv.includes("--no-history")) {
    const history = await seedResolvedHistory(students, facility || admin);
    await seedFixFlow(history, students, facility || admin);
    await seedClosedGatePasses(students, warden || admin);
  }
  await seedFaqQueries(students);
  await seedSmsLog(students);
}
