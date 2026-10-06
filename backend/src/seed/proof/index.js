import { Building } from "../../models/Building.js";
import { CampusMemory } from "../../models/CampusMemory.js";
import { Complaint } from "../../models/Complaint.js";
import { GatePass } from "../../models/GatePass.js";
import { Incident } from "../../models/Incident.js";
import { Intervention } from "../../models/Intervention.js";
import { Notice } from "../../models/ext/Notice.js";
import { NoticeReceipt } from "../../models/ext/NoticeReceipt.js";
import { StudentProfile } from "../../models/ext/StudentProfile.js";
import { SlotNudge } from "../../models/proof/SlotNudge.js";
import { classify } from "../../services/classificationService.js";
import { istDateKey, istInstant } from "../../services/ext/istTime.js";
import { backfillEvents } from "../../services/xo/backfillService.js";
import { flushEvents } from "../../services/xo/eventService.js";
import { clearProcessMiningCache } from "../../services/proof/processMining.js";
import { loadActors } from "../ext/phase1.js";

/**
 * Round 3 demo data (see CHANGES-ROUND3.md). Everything the Round 3 features
 * read already exists in the database; this adds records where the earlier
 * seeds were too thin for a statistic to say anything:
 *
 *   A. complaint histories with real hand-offs (reassignments, investigation
 *      starts) in the last month — process mining (F1), equity (F8)
 *   B. one completed Hostel B water intervention with the complaint series
 *      around it and comparable blocks — impact proof (F2); plus one with no
 *      comparable block and one whose window is still open
 *   C. past weekend day outings and tomorrow's approved ones — presence (F5)
 *   D. eight weeks of notices to CSE year 3 — attention budget, reach (F4)
 *
 * Every record carries a reserved reference (CMP-16xx, INC-09xx, INT-09xx,
 * GP-YYYY-R…, NTC-R3-…) and is cleared before it is written again. The demo
 * student (students[0]) is never given any of it, so the Tuesday Test and the
 * smoke suites start from the same place as before. This is DEMO DATA; the
 * features compute from the database whatever is in it.
 */

const HOUR = 36e5;
const DAY = 864e5;
const ago = (days, hour = 10) => new Date(Date.now() - days * DAY + (hour - 10) * HOUR);
export const R3_COMPLAINT = /^CMP-16\d\d$/;
export const R3_NOTICE = /^NTC-R3-/;
export const R3_PASS = /^GP-\d{4}-R\d{4}$/;
export const R3_INCIDENTS = ["INC-0901", "INC-0902", "INC-0903"];
export const R3_INTERVENTIONS = ["INT-0901", "INT-0902", "INT-0903"];

export async function clearProof() {
  const complaints = await Complaint.find({ reference: R3_COMPLAINT }).select("_id").lean();
  const incidents = await Incident.find({ reference: { $in: R3_INCIDENTS } }).select("_id").lean();
  const notices = await Notice.find({ reference: R3_NOTICE }).select("_id").lean();
  await Promise.all([
    Complaint.deleteMany({ _id: { $in: complaints.map((c) => c._id) } }),
    Intervention.deleteMany({ reference: { $in: R3_INTERVENTIONS } }),
    CampusMemory.deleteMany({ incident: { $in: incidents.map((i) => i._id) } }),
    Incident.deleteMany({ _id: { $in: incidents.map((i) => i._id) } }),
    GatePass.deleteMany({ reference: R3_PASS }),
    NoticeReceipt.deleteMany({ notice: { $in: notices.map((n) => n._id) } }),
    Notice.deleteMany({ _id: { $in: notices.map((n) => n._id) } }),
    SlotNudge.deleteMany({})
  ]);
}

// ---- A + B: complaints ----------------------------------------------------------------------

let refNo = 0;
const nextRef = () => `CMP-${1601 + refNo++}`;

/**
 * One resolved complaint with a full audit trail.
 * steps: { assignAfterH, reassign: [{ afterH, to, by }], investigateAfterH, resolveAfterH }
 */
async function complaint({ building, student, category, title, description, room, at, channel = "APP", assignTo, steps, resolver, investigator, fix, incident }) {
  const c = new Complaint({
    reference: nextRef(),
    student: student._id,
    title,
    description,
    category,
    location: room ? `${building.name} · ${room}` : building.name,
    building: building._id,
    channel,
    audit: [{ at, actor: student.name, message: `Report submitted by student · ${building.name}${room ? ` · ${room}` : ""}`, kind: "ACTUAL DATA" }]
  });
  const { classification } = await classify(c, { building });
  const t = (h) => new Date(at.getTime() + h * HOUR);
  const resolvedAt = t(steps.resolveAfterH);
  Object.assign(c, {
    aiClassification: classification,
    category: classification.category,
    priority: classification.priority,
    severity: classification.severity,
    department: assignTo || classification.routedTo,
    status: "RESOLVED",
    relatedIncident: incident?._id,
    resolution: { resolutionTimeHours: steps.resolveAfterH, resolvedBy: resolver._id, resolutionDescription: fix, resolvedAt }
  });
  c.audit.push(
    { at: t(0.02), actor: "classificationService", message: `rule-based (AI not configured) classification: ${classification.category} / ${classification.priority}`, kind: "AI PREDICTION" },
    { at: t(steps.assignAfterH), actor: "system", message: `Assigned to ${c.department}`, kind: "ACTUAL DATA" }
  );
  for (const r of steps.reassign || []) c.audit.push({ at: t(r.afterH), actor: r.by.name, message: `Reassigned to ${r.to} — wrong trade on first assignment`, kind: "ACTUAL DATA" });
  if (steps.investigateAfterH !== undefined) c.audit.push({ at: t(steps.investigateAfterH), actor: investigator.name, message: "Investigation started on site", kind: "ACTUAL DATA" });
  c.audit.push({ at: resolvedAt, actor: resolver.name, message: `Resolved in ${steps.resolveAfterH}h — ${fix}`, kind: "ACTUAL DATA" });
  await c.save();
  await Complaint.collection.updateOne({ _id: c._id }, { $set: { createdAt: at, updatedAt: resolvedAt } });
  return c;
}

/** k-th of n evenly spread offsets across `span` days (deterministic). */
const spread = (k, n, span) => ((k + 0.5) * span) / n;

async function seedComplaintHistories({ byCode, students, staff }) {
  const { warden, facility, admin } = staff;
  const pick = (hostel, i) => {
    const pool = students.slice(1).filter((s) => s.hostelName === hostel);
    return pool.length ? pool[i % pool.length] : students[1 + (i % (students.length - 1))];
  };
  const out = { mining: 0, did: 0 };

  // A. The last month's work: plumbing waits long between ASSIGNED and INVESTIGATING;
  //    electrical and network move quickly; three tickets bounce between trades.
  const recent = [
    ["HST-A", "WATER", "Tap leaking in washroom", "The tap in the washroom near A-2{n} leaks all day and night.", "A-2{n}", "APP"],
    ["HST-C", "WATER", "Flush tank not filling", "The flush tank in the C-1{n} washroom does not fill after use.", "C-1{n}", "APP"],
    ["HST-A", "WATER", "Washbasin drain blocked", "Washbasin drain outside A-1{n} is blocked and water stands in it.", "A-1{n}", "KIOSK"],
    ["HST-C", "WATER", "Shower has no water pressure", "The shower in C-3{n} has almost no water pressure.", "C-3{n}", "SMS"],
    ["HST-A", "ELECTRICITY", "Ceiling fan not working", "The ceiling fan in A-3{n} does not start.", "A-3{n}", "APP"],
    ["HST-C", "ELECTRICITY", "Tube light flickering", "Tube light in C-2{n} keeps flickering at night.", "C-2{n}", "APP"],
    ["ACAD-A", "ELECTRICITY", "Classroom socket dead", "The power socket near the front desk of room 20{n} has no power.", "Room 20{n}", "KIOSK"],
    ["LIB", "WI-FI", "Wi-Fi not connecting on first floor", "Wi-Fi does not connect on the library first floor near rack {n}.", "First floor", "APP"],
    ["HST-A", "WI-FI", "Wi-Fi keeps dropping", "Wi-Fi keeps dropping every few minutes in A-1{n}.", "A-1{n}", "SMS"],
    ["HST-C", "CLEANLINESS", "Corridor not cleaned", "The corridor near C-2{n} has not been cleaned for two days.", "C-2{n}", "APP"],
    ["MESS-C", "MESS", "Plates not washed properly", "Plates at counter {n} are not washed properly.", "Counter {n}", "KIOSK"]
  ];
  const kioskVague = (desc) => desc.replace(/ (in|near|outside|of) (the )?[^.]*\./, ".");
  let i = 0;
  for (let round = 0; round < 2; round += 1) {
    for (const [code, category, title, desc, room, channel] of recent) {
      const n = (i * 3 + 1) % 9 + 1;
      const days = 3 + spread(i, recent.length * 2, 22);
      const plumbing = category === "WATER";
      const bounce = i === 2 || i === 9 || i === 16;
      const vague = channel === "KIOSK" || channel === "SMS";
      const investigate = plumbing ? 14 + ((i * 7) % 17) : 1.5 + (i % 4);
      const steps = {
        assignAfterH: 0.3,
        reassign: bounce ? [{ afterH: 2, to: plumbing ? "MAINTENANCE · ELECTRICAL" : "MAINTENANCE · PLUMBING", by: admin }, { afterH: 5, to: plumbing ? "MAINTENANCE · PLUMBING" : "MAINTENANCE · ELECTRICAL", by: admin }] : [],
        investigateAfterH: investigate + (vague ? 6 : 0),
        resolveAfterH: investigate + (vague ? 6 : 0) + (plumbing ? 5 : 2.5) + (i % 3)
      };
      await complaint({
        building: byCode.get(code),
        student: pick(byCode.get(code).name, i),
        category,
        title,
        description: vague ? kioskVague(desc.replace(/\{n\}/g, n)) : desc.replace(/\{n\}/g, n),
        room: vague ? null : room.replace(/\{n\}/g, n),
        at: ago(days, 9 + (i % 8)),
        channel,
        steps,
        resolver: plumbing ? warden : i % 4 === 0 ? admin : facility,
        investigator: plumbing ? warden : facility,
        fix: plumbing ? "Washer / valve replaced" : category === "WI-FI" ? "Access point reset" : category === "CLEANLINESS" ? "Cleaned; roster corrected" : "Repaired on site"
      });
      i += 1;
      out.mining += 1;
    }
  }

  // B. The Hostel B booster-pump intervention 40 days ago, and the complaints around it.
  const fixDaysAgo = 40;
  const hostelB = byCode.get("HST-B");
  const incident = await Incident.create({
    reference: "INC-0901",
    title: "HOSTEL B · WATER SUPPLY FAILURE (EARLIER)",
    description: "Repeated loss of pressure on every floor; the duty pump kept tripping.",
    category: "WATER",
    building: hostelB._id,
    status: "RESOLVED",
    risk: 71,
    riskLevel: "HIGH",
    severity: "MAJOR",
    confidence: 78,
    affectedStudents: 131,
    detectedAt: ago(fixDaysAgo + 14),
    firstComplaintAt: ago(fixDaysAgo + 14),
    clusteredAt: ago(fixDaysAgo + 13),
    resolution: { resolvedAt: ago(fixDaysAgo), resolutionTimeHours: 31, action: "Standby pump put on duty; duty pump rewound" }
  });
  const series = [
    ["HST-B", 17, 4],
    ["HST-A", 7, 6],
    ["HST-C", 6, 7]
  ];
  const rooms = { "HST-B": "B", "HST-A": "A", "HST-C": "C" };
  for (const [code, pre, post] of series) {
    const b = byCode.get(code);
    for (const [phase, count] of [["pre", pre], ["post", post]]) {
      for (let k = 0; k < count; k += 1) {
        const offset = spread(k, count, 14);
        const days = phase === "pre" ? fixDaysAgo + 14 - offset : fixDaysAgo - offset;
        const floor = 1 + (k % 3);
        const room = `${rooms[code]}-${floor}${String(10 + ((k * 7 + (phase === "pre" ? 0 : 3)) % 27)).padStart(2, "0")}`;
        const wait = code === "HST-B" && phase === "pre" ? 10 + (k % 5) * 3 : 4 + (k % 4);
        await complaint({
          building: b,
          student: pick(b.name, k + (phase === "pre" ? 0 : 5)),
          category: "WATER",
          title: phase === "pre" && code === "HST-B" ? ["No water on my floor", "Water pressure very low", "Taps dry since morning", "No water in washroom"][k % 4] : ["Tap dripping in washroom", "Low water pressure", "No water in washroom for an hour"][k % 3],
          description: phase === "pre" && code === "HST-B" ? `No water or very low pressure on floor ${floor} of ${b.name} since morning (${room}).` : `Water problem in the ${room} washroom: ${["the tap drips", "pressure is low", "no water for an hour"][k % 3]}.`,
          room,
          at: ago(days, 7 + (k % 10)),
          channel: k % 6 === 5 ? "KIOSK" : "APP",
          steps: { assignAfterH: 0.4, investigateAfterH: wait, resolveAfterH: wait + 3 + (k % 3) },
          resolver: code === "HST-B" ? warden : facility,
          investigator: code === "HST-B" ? warden : facility,
          fix: phase === "pre" && code === "HST-B" ? "Supply restored after the duty pump was reset" : "Valve / washer fixed",
          incident: phase === "pre" && code === "HST-B" ? incident : null
        });
        out.did += 1;
      }
    }
  }
  const members = await Complaint.find({ relatedIncident: incident._id }).select("_id").lean();
  await Incident.updateOne({ _id: incident._id }, { $set: { complaints: members.map((m) => m._id) } });
  await CampusMemory.create({
    incident: incident._id,
    incidentReference: "INC-0901",
    occurredOn: ago(fixDaysAgo + 1),
    incidentType: "Hostel B water supply failure",
    category: "WATER",
    building: hostelB._id,
    buildingName: hostelB.name,
    cause: "Duty pump tripping repeatedly under morning load",
    resolution: "Standby pump put on duty; duty pump rewound",
    resolutionTimeHours: 31,
    outcome: "STABLE",
    riskBefore: 71,
    riskAfter: 24,
    recurrence: "Recurred after 26 days",
    recurrenceCount: 1,
    signatures: ["Morning pressure collapse", "17-complaint fortnight", "Standby pump on duty"],
    keywords: ["water", "pressure", "standby", "morning", "hostel"]
  });
  await Intervention.create({
    reference: "INT-0901",
    incident: incident._id,
    building: hostelB._id,
    recommendedAction: "Put the standby pump on duty and rewind the duty pump",
    priority: "HIGH",
    expectedImpact: "Restore pressure on every floor",
    estimatedResolutionHours: 6,
    confidence: 74,
    owner: "MAINTENANCE · PLUMBING",
    affectedStudents: 131,
    status: "COMPLETED",
    decision: { value: "ACCEPT", by: warden._id, byName: warden.name, at: ago(fixDaysAgo + 1.5), reason: "Pressure log confirms the duty pump trips" },
    outcome: { resolutionTimeHours: 31, riskBefore: 71, riskAfter: 24, completedAt: ago(fixDaysAgo), recurrence: "Recurred after 26 days" }
  });

  // One with no comparable block (the library is the only one of its type) …
  const lib = byCode.get("LIB");
  const libIncident = await Incident.create({ reference: "INC-0902", title: "WI-FI ZONE C · EARLIER SESSION DROPS", category: "WI-FI", building: lib._id, status: "RESOLVED", risk: 58, riskLevel: "ELEVATED", severity: "MODERATE", affectedStudents: 180, detectedAt: ago(34), firstComplaintAt: ago(34) });
  await Intervention.create({ reference: "INT-0902", incident: libIncident._id, building: lib._id, recommendedAction: "Add a second access point in the reading hall", priority: "MEDIUM", owner: "IT · NETWORK", affectedStudents: 180, status: "COMPLETED", decision: { value: "ACCEPT", by: admin._id, byName: admin.name, at: ago(22) }, outcome: { completedAt: ago(20), resolutionTimeHours: 48 } });
  // … and one whose "after" window has not elapsed yet.
  const hostelC = byCode.get("HST-C");
  const cIncident = await Incident.create({ reference: "INC-0903", title: "HOSTEL C · CORRIDOR LIGHTING", category: "ELECTRICITY", building: hostelC._id, status: "RESOLVED", risk: 44, riskLevel: "EMERGING", severity: "MODERATE", affectedStudents: 60, detectedAt: ago(12), firstComplaintAt: ago(12) });
  await Intervention.create({ reference: "INT-0903", incident: cIncident._id, building: hostelC._id, recommendedAction: "Replace corridor light fittings on floor 2", priority: "MEDIUM", owner: "MAINTENANCE · ELECTRICAL", affectedStudents: 60, status: "COMPLETED", decision: { value: "ACCEPT", by: facility._id, byName: facility.name, at: ago(6) }, outcome: { completedAt: ago(5), resolutionTimeHours: 20 } });
  return out;
}

// ---- C: gate passes -------------------------------------------------------------------------

async function seedPasses({ students, warden }) {
  const year = new Date().getFullYear();
  let n = 0;
  const pass = async (student, leaveAt, hours, status) => {
    const expectedReturnAt = new Date(leaveAt.getTime() + hours * HOUR);
    const appliedAt = new Date(leaveAt.getTime() - 20 * HOUR);
    const decided = new Date(appliedAt.getTime() + 2 * HOUR);
    const returned = status === "RETURNED";
    const events = [
      { at: appliedAt, actor: student.name, message: "Gate pass requested", status: "PENDING_PARENT_VERIFICATION" },
      { at: new Date(appliedAt.getTime() + 6 * 60000), actor: "otpService", message: "Guardian verified the outing by one-time code", status: "PARENT_VERIFIED" },
      { at: decided, actor: warden.name, message: "Approved by the warden", status: "APPROVED" }
    ];
    if (returned) events.push({ at: new Date(leaveAt.getTime() + 5 * 60000), actor: "gate", message: "Exit scan accepted at the gate", status: "ACTIVE" }, { at: new Date(expectedReturnAt.getTime() - 20 * 60000), actor: "gate", message: "Return scan accepted · returned on time", status: "RETURNED" });
    const gp = await GatePass.create({
      reference: `GP-${year}-R${String(++n).padStart(4, "0")}`,
      student: student._id,
      hostel: student.hostel,
      hostelName: student.hostelName,
      room: student.room,
      date: leaveAt,
      reason: ["Weekend visit home", "Family function in town", "Shopping for lab supplies", "Bank and post office"][n % 4],
      destination: "Rourkela",
      channel: "APP",
      leaveAt,
      expectedReturnAt,
      status,
      parent: { name: student.parentName, phoneMasked: "+91XXXXXX0000", verified: true, verifiedAt: events[1].at },
      approval: { decision: "APPROVED", decidedBy: warden._id, decidedByName: warden.name, decidedAt: decided },
      ...(returned ? { exitAt: events[3].at, returnAt: events[4].at, overdueMinutes: 0 } : {}),
      events
    });
    await GatePass.collection.updateOne({ _id: gp._id }, { $set: { createdAt: appliedAt, updatedAt: returned ? events[4].at : decided } });
  };
  const pool = students.slice(1);
  let count = 0;
  // Past four weeks: weekend day outings that span lunch (10:00–18:00 IST).
  for (let d = 1; d <= 28; d += 1) {
    const key = istDateKey(new Date(), -d);
    const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();
    const k = weekday === 6 ? 5 : weekday === 0 ? 4 : d % 5 === 0 ? 1 : 0;
    for (let j = 0; j < k; j += 1) {
      await pass(pool[(d * 3 + j) % pool.length], istInstant(key, "10:00"), 8, "RETURNED");
      count += 1;
    }
  }
  // Tomorrow: approved outings over lunch, for the presence-adjusted forecast.
  const tomorrow = istDateKey(new Date(), 1);
  for (let j = 0; j < 6; j += 1) {
    await pass(pool[(j * 5 + 2) % pool.length], istInstant(tomorrow, "10:30"), 7, "APPROVED");
    count += 1;
  }
  return count;
}

// ---- D: notice history ----------------------------------------------------------------------

async function seedNoticeHistory({ students, admin }) {
  const cohort = students.slice(1);
  const profiles = new Map((await StudentProfile.find({ student: { $in: cohort.map((s) => s._id) } }).lean()).map((p) => [String(p.student), p]));
  // Notices per week, oldest first (8 weeks ago → last week). Read rate falls with load (DEMO DATA).
  const perWeek = [2, 3, 8, 4, 9, 3, 6, 10];
  const readChance = (load) => (load <= 3 ? 0.82 : load <= 7 ? 0.63 : 0.41);
  const topics = ["Library timing change", "Scholarship form reminder", "Sports day registration", "Lab record submission", "Guest lecture", "Hostel water tank cleaning", "Fee receipt collection", "Exam hall seating", "Club recruitment", "Mess feedback survey"];
  let n = 0;
  let receipts = 0;
  for (let w = 0; w < perWeek.length; w += 1) {
    const weekStart = Date.now() - (perWeek.length - w) * 7 * DAY - 3 * DAY;
    for (let j = 0; j < perWeek[w]; j += 1) {
      const publishedAt = new Date(weekStart + (j * 7 * DAY) / perWeek[w] + ((9 + ((j * 5) % 11)) - 10) * HOUR);
      const topic = topics[(w * 3 + j) % topics.length];
      const notice = await Notice.create({
        reference: `NTC-R3-${String(++n).padStart(3, "0")}`,
        title: `${topic} — week ${w + 1}`,
        body: `${topic}. Details for CSE year 3 students. Contact the academic office for questions.`,
        priority: j % 4 === 0 ? "INFO" : "NORMAL",
        kind: "GENERAL",
        audience: { branches: ["CSE"], years: [3], roles: ["STUDENT"] },
        author: admin._id,
        authorName: admin.name,
        authorRole: admin.role,
        status: "PUBLISHED",
        publishedAt,
        reach: cohort.length
      });
      await Notice.collection.updateOne({ _id: notice._id }, { $set: { createdAt: publishedAt, updatedAt: publishedAt } });
      const docs = cohort.map((s, idx) => {
        const hash = ((n * 31 + idx * 17) % 100) / 100;
        const read = hash < readChance(perWeek[w]);
        const p = profiles.get(String(s._id));
        const deliveredAt = new Date(publishedAt.getTime() + (5 + (idx % 7) * 11) * 60000);
        return {
          notice: notice._id,
          student: s._id,
          deliveredAt,
          readAt: read ? new Date(deliveredAt.getTime() + (1 + (idx % 9)) * HOUR) : undefined,
          acknowledgedAt: read && hash < 0.25 ? new Date(deliveredAt.getTime() + 12 * HOUR) : undefined,
          channel: "APP",
          snapshot: { hostel: s.hostelName, branch: p?.branch, year: p?.year, section: p?.section, role: "STUDENT" },
          createdAt: publishedAt,
          updatedAt: publishedAt
        };
      });
      await NoticeReceipt.collection.insertMany(docs);
      receipts += docs.length;
    }
  }
  return { notices: n, receipts };
}

export async function seedProof({ log = console.log } = {}) {
  const { admin, warden, facility, students } = await loadActors();
  if (!admin || !warden || !facility || !students.length) throw new Error("Run the base seed first (npm run seed -- --fresh).");
  refNo = 0;
  await clearProof();
  const byCode = new Map((await Building.find().lean()).map((b) => [b.code, b]));
  log("Round 3: complaint histories and a completed intervention with comparable blocks…");
  const complaints = await seedComplaintHistories({ byCode, students, staff: { admin, warden, facility } });
  log("Round 3: weekend outings and tomorrow's approved passes…");
  const passes = await seedPasses({ students, warden });
  log("Round 3: eight weeks of notices to CSE year 3…");
  const notices = await seedNoticeHistory({ students, admin });
  await flushEvents();
  log("Round 3: re-deriving campus events so the new records are in the log…");
  const backfill = await backfillEvents({ actor: admin });
  clearProcessMiningCache();
  return { complaintsForMining: complaints.mining, complaintsAroundIntervention: complaints.did, interventions: R3_INTERVENTIONS.length, passes, notices: notices.notices, receipts: notices.receipts, eventsBackfilled: backfill.written };
}
