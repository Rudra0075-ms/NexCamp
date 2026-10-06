import { GatePass } from "../../models/GatePass.js";
import { DocumentRequest } from "../../models/ext/DocumentRequest.js";
import { PolicyRule } from "../../models/xo/PolicyRule.js";
import { ServiceRequest } from "../../models/xo/ServiceRequest.js";
import { issueDocument, requestDocument, reviewDocument } from "../../services/ext/certificateService.js";
import { applyDocumentPolicy, applyGatePassPolicy, ensureDefaultRules, requestReceiptCopy, undoPolicyDecision } from "../../services/xo/touchlessService.js";
import { istDateKey, istInstant } from "../../services/ext/istTime.js";
import { backdate } from "../ext/phase1.js";

/**
 * Touchless Lane history (Phase 2). Every record here goes through the real
 * services — requestDocument + the policy engine, the gate-pass policy after a
 * verified guardian, the fee-receipt request — and is then backdated so the
 * Touchless Rate, the exceptions inbox and the FYI list have something to show.
 *
 * The demo student (students[0]) is deliberately left without an open request,
 * so the Tuesday Test and the smoke suites start from a clean slate. Passes
 * are given to other students, and their references use the prefix GP-YYYY-P.
 */

const hoursAgo = (h) => new Date(Date.now() - h * 3600000);
const P_REF = /^GP-\d{4}-P\d{4}$/;

// Purposes of the certificates this seed files, so a re-run clears exactly those.
const OFFICE_PURPOSE = "Scholarship verification (issued by the office)";
export const SEEDED_PURPOSES = [
  OFFICE_PURPOSE,
  "Education loan application — Bank of India", "Railway concession form", "Scholarship renewal (post-matric)", "Bank account opening",
  "Internship joining letter", "Hostel fee concession", "Sports quota verification", "Education loan application", "Student visa application — German embassy"
];

export async function clearPolicyHistory() {
  await Promise.all([
    PolicyRule.deleteMany({}),
    ServiceRequest.deleteMany({}),
    GatePass.deleteMany({ reference: P_REF }),
    DocumentRequest.deleteMany({ type: "BONAFIDE", purpose: { $in: SEEDED_PURPOSES }, $or: [{ purpose: OFFICE_PURPOSE }, { "history.action": { $in: ["POLICY_AUTO_APPROVED", "POLICY_ROUTED_TO_HUMAN"] } }] })
  ]);
}

async function certificate(student, purpose, hours) {
  const at = hoursAgo(hours);
  const doc = await requestDocument(student, { type: "BONAFIDE", purpose });
  await backdate(DocumentRequest, doc._id, { createdAt: at });
  const fresh = await DocumentRequest.findById(doc._id);
  const { policy } = await applyDocumentPolicy(fresh, student, { now: new Date(at.getTime() + 4000) });
  const history = (await DocumentRequest.findById(doc._id).lean()).history.map((h, i) => ({ ...h, at: new Date(at.getTime() + i * 1000) }));
  await DocumentRequest.collection.updateOne({ _id: doc._id }, { $set: { history, updatedAt: new Date(at.getTime() + 5000) } });
  return { doc: await DocumentRequest.findById(doc._id), policy };
}

async function outing(student, index, { daysAgo, leaveHour = "10:00", hours = 4, leadHours = 20, returned = true, leaveInMinutes }) {
  const year = new Date().getFullYear();
  const leaveAt = leaveInMinutes ? new Date(Date.now() + leaveInMinutes * 60000) : istInstant(istDateKey(new Date(), -daysAgo), leaveHour);
  const expectedReturnAt = new Date(leaveAt.getTime() + hours * 3600000);
  // Never in the future: an upcoming outing was applied for a little while ago.
  const appliedAt = new Date(Math.min(leaveAt.getTime() - leadHours * 3600000, Date.now() - 30 * 60000));
  const verifiedAt = new Date(appliedAt.getTime() + 6 * 60000);
  const gp = await GatePass.create({
    reference: `GP-${year}-P${String(index).padStart(4, "0")}`,
    student: student._id,
    hostel: student.hostel,
    hostelName: student.hostelName,
    room: student.room,
    date: leaveAt,
    reason: ["Visit to the bank for the scholarship account", "Doctor's appointment in the city", "Buying lab equipment at Udit Nagar", "Family function in Rourkela town", "Passport photo and document printing"][index % 5],
    destination: "Rourkela",
    channel: "APP",
    leaveAt,
    expectedReturnAt,
    status: "PENDING_WARDEN_APPROVAL",
    parent: { name: student.parentName, phoneMasked: "+91XXXXXX0000", verified: true, verifiedAt },
    events: [
      { at: appliedAt, actor: student.name, message: "Gate pass requested", status: "PENDING_PARENT_VERIFICATION" },
      { at: verifiedAt, actor: "otpService", message: "Guardian verified the outing by one-time code", status: "PARENT_VERIFIED" },
      { at: verifiedAt, actor: "gatePassService", message: "Forwarded to the hostel warden for approval", status: "PENDING_WARDEN_APPROVAL" }
    ]
  });
  await backdate(GatePass, gp._id, { createdAt: appliedAt });
  const fresh = await GatePass.findById(gp._id);
  const lane = await applyGatePassPolicy(fresh, { now: verifiedAt });
  const after = await GatePass.findById(gp._id).select("+pass.tokenHash");
  if (lane.approved) after.approval.decidedAt = verifiedAt;
  if (lane.approved && returned) {
    after.status = "RETURNED";
    after.exitAt = new Date(leaveAt.getTime() + 5 * 60000);
    after.returnAt = new Date(expectedReturnAt.getTime() - 25 * 60000);
    after.actualDurationMinutes = Math.round((after.returnAt - after.exitAt) / 60000);
    after.overdueMinutes = 0;
    after.pass.exitScanAt = after.exitAt;
    after.pass.returnScanAt = after.returnAt;
    after.pass.scanCount = 2;
    after.pass.tokenHash = undefined;
    after.events.push({ at: after.exitAt, actor: "gate", message: "Exit scan accepted at the gate", status: "ACTIVE" }, { at: after.returnAt, actor: "gate", message: "Return scan accepted · returned on time", status: "RETURNED" });
  }
  await after.save();
  // The policy decision happened when the guardian confirmed, not when the seed ran.
  const events = (await GatePass.findById(gp._id).lean()).events.map((e) => (/^Policy engine/.test(e.actor || "") ? { ...e, at: verifiedAt } : e));
  await backdate(GatePass, gp._id, { createdAt: appliedAt, updatedAt: after.returnAt || verifiedAt, events });
  return { gatePass: after, lane };
}

export async function seedPolicyHistory({ students, warden, admin }) {
  await clearPolicyHistory();
  await ensureDefaultRules({ force: true });
  const s = students;
  const out = { certificates: 0, instant: 0, routed: 0, passes: 0, passesInstant: 0, receipts: 0 };

  // Certificates: in-policy ones issue instantly; students[3] has ₹18,500 overdue
  // tuition and one purpose mentions a visa — both go to the academic office.
  const certs = [
    [s[5], "Education loan application — Bank of India", 26 * 24],
    [s[6], "Railway concession form", 19 * 24],
    [s[7], "Scholarship renewal (post-matric)", 12 * 24],
    [s[8], "Bank account opening", 8 * 24],
    [s[9], "Internship joining letter", 5 * 24],
    [s[11], "Hostel fee concession", 3 * 24],
    [s[12], "Sports quota verification", 30],
    [s[3], "Education loan application", 50],
    [s[13], "Student visa application — German embassy", 20]
  ];
  for (const [student, purpose, hours] of certs) {
    if (!student) continue;
    const { policy } = await certificate(student, purpose, hours);
    out.certificates += 1;
    if (policy.decision === "AUTO_APPROVE") out.instant += 1;
    else out.routed += 1;
  }

  // Before the Touchless Lane: bonafides the academic office issued by hand,
  // 60–200 days ago — the history the office-path ETA on page 14 is read from.
  // Students with no open bonafide (an open one would refuse a second request).
  const officeHistory = [[s[2], 200, 30], [s[15], 170, 18], [s[6], 140, 44], [s[8], 110, 26], [s[10], 90, 9], [s[16], 75, 52], [s[17], 62, 21]];
  for (const [student, daysAgo, hours] of officeHistory) {
    if (!student) continue;
    const at = hoursAgo(daysAgo * 24);
    const doc = await requestDocument(student, { type: "BONAFIDE", purpose: OFFICE_PURPOSE });
    await reviewDocument(doc._id, admin, { decision: "APPROVE" });
    await issueDocument(doc._id, admin, { now: new Date(at.getTime() + hours * 3600000) });
    const history = (await DocumentRequest.findById(doc._id).lean()).history.map((h, i) => ({ ...h, at: new Date(at.getTime() + (i === 0 ? 0 : hours * 3600000 - 60000 + i * 1000)) }));
    await DocumentRequest.collection.updateOne({ _id: doc._id }, { $set: { createdAt: at, updatedAt: new Date(at.getTime() + hours * 3600000), reviewedAt: new Date(at.getTime() + hours * 3600000 - 60000), dueAt: new Date(at.getTime() + 24 * 3600000), history } });
  }

  // Day outings after guardian confirmation: returned history, one upcoming
  // (FYI with UNDO in the warden console), one short-notice (warden decides)
  // and one approved then undone by the warden.
  const passes = [
    [s[1], { daysAgo: 21 }],
    [s[2], { daysAgo: 14, hours: 5 }],
    [s[4], { daysAgo: 9, hours: 3 }],
    [s[6], { daysAgo: 6 }],
    [s[9], { daysAgo: 2, hours: 6 }],
    [s[10], { daysAgo: -1, returned: false }],
    [s[14], { leaveInMinutes: 70, hours: 2, leadHours: 1, returned: false }],
    [s[15], { daysAgo: -2, returned: false }]
  ];
  let undoTarget = null;
  for (const [i, [student, opts]] of passes.entries()) {
    if (!student) continue;
    const { gatePass, lane } = await outing(student, i + 1, opts);
    out.passes += 1;
    if (lane.approved) out.passesInstant += 1;
    if (student === s[15]) undoTarget = gatePass;
  }
  if (undoTarget && undoTarget.decidedBy === "POLICY" && warden) {
    await undoPolicyDecision("gatepass", undoTarget._id, warden, "Hostel B water shutdown on that day — residents asked to stay in for the tank cleaning");
  }

  // Fee receipt copies: one on the ledger (instant), one mistyped (accounts office).
  const receiptOwner = s[1];
  if (receiptOwner) {
    await requestReceiptCopy(receiptOwner, { receipt: "RCP-T-1001", purpose: "Education loan disbursement" });
    await requestReceiptCopy(s[2], { receipt: "RCP-X-9999", purpose: "Scholarship office asked for it" });
    out.receipts = 2;
  }
  return out;
}
