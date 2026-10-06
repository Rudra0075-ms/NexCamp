import mongoose from "mongoose";
import { connectDB, disconnectDB } from "../config/db.js";
import { assertEnv, env } from "../config/env.js";
import { ROLES } from "../config/constants.js";
import {
  AlertState,
  Anomaly,
  Attendance,
  Building,
  CampusMemory,
  Complaint,
  Incident,
  Intervention,
  MessRecord,
  MessFeedback,
  GatePass,
  Notification,
  OtpVerification,
  Relationship,
  Risk,
  User
} from "../models/index.js";
import { Resource } from "../models/Resource.js";
import { seedResources } from "./resourceSeed.js";
import { classify } from "../services/classificationService.js";
import { sweep } from "../services/anomalyDetectionService.js";
import { investigate } from "../services/investigationService.js";
import { recommendAction, simulateScenario } from "../services/interventionService.js";
import { levelFor, scoreIncident } from "../services/riskService.js";
import { classifyFeedback } from "../services/messIntelligenceService.js";
import { round, tokenize } from "../utils/text.js";
import {
  anomalyReadings,
  buildings as buildingSeed,
  memories,
  messExtraSlots,
  messFeedbackTemplates,
  messMenu,
  messRotation,
  messSlots,
  SEMESTER_WEEKS,
  subjectSchedule,
  otherComplaints,
  relationships as relationshipSeed,
  studentNames,
  subjects,
  waterComplaints
} from "./data.js";
// EXTENSION HOOK (see HOOKS.md): demo data for the PS07 extension pack.
import { seedExtensions } from "./ext/index.js";
// EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md): history, policy rules, events. Skip with --no-xo.
import { seedExceptionOnly } from "./xo/index.js";
// ROUND-3 HOOK (see CHANGES-ROUND3.md): demo data for Prove / Optimise / Audit / Prevent.
import { seedProof } from "./proof/index.js";
import { seedSupport, COUNSELLOR_EMAIL, COUNSELLOR_PASSWORD } from "./support/index.js"; // SUPPORT HOOK (see CHANGES-SILENT-SUPPORT.md)
import { flushEvents } from "../services/xo/eventService.js";

const daysAgo = (days) => new Date(Date.now() - days * 864e5);
const emailFor = (name) => `${name.toLowerCase().split(" ")[0]}.${name.toLowerCase().split(" ").slice(-1)[0]}@bput.ac.in`;

async function wipe() {
  await Promise.all(
    [AlertState, Anomaly, Attendance, Building, CampusMemory, Complaint, GatePass, Incident, Intervention, MessFeedback, MessRecord, Notification, OtpVerification, Relationship, Resource, Risk, User].map(
      (model) => model.deleteMany({})
    )
  );
}

async function seedBuildings() {
  const docs = await Building.insertMany(
    buildingSeed.map((building) => ({ ...building, currentRisk: 0, riskLevel: "LOW" }))
  );
  return new Map(docs.map((doc) => [doc.code, doc]));
}

async function seedUsers(byCode) {
  const admin = await User.create({
    name: "Campus Mission Control",
    email: env.demo.adminEmail,
    password: env.demo.adminPassword,
    role: ROLES.ADMIN,
    department: "GENERAL ADMINISTRATION",
    managedDepartment: "GENERAL ADMINISTRATION"
  });

  const warden = await User.create({
    name: "Hostel B Warden",
    email: "warden.hostelb@bput.ac.in",
    password: env.demo.adminPassword,
    role: ROLES.WARDEN,
    hostel: byCode.get("HST-B")._id,
    hostelName: "HOSTEL B",
    managedDepartment: "MAINTENANCE · PLUMBING"
  });

  const facility = await User.create({
    name: "Facility Manager",
    email: "facility@bput.ac.in",
    password: env.demo.adminPassword,
    role: ROLES.FACILITY_MANAGER,
    managedDepartment: "MAINTENANCE · PLUMBING"
  });

  const students = [];
  for (const [index, [name, hostelCode, room]] of studentNames.entries()) {
    const hostel = byCode.get(hostelCode);
    // The first student is the demo account the frontend signs in as.
    const isDemo = index === 0;
    students.push(
      await User.create({
        name: name.toUpperCase(),
        email: isDemo ? env.demo.studentEmail : emailFor(name),
        password: isDemo ? env.demo.studentPassword : "Campus@2026",
        role: ROLES.STUDENT,
        studentId: `BPUT/CSE/22/${String(400 + index + 17).padStart(4, "0")}`,
        department: "COMPUTER SCIENCE & ENGINEERING",
        course: "B.TECH CSE",
        semester: 5,
        hostel: hostel._id,
        hostelName: hostel.name,
        room,
        // Guardian contact for the gate-pass parent OTP. The placeholder in
        // .env.example delivers nothing; set DEMO_PARENT_PHONE to a real
        // number only if a live SMS provider is configured.
        parentName: `GUARDIAN OF ${name.toUpperCase()}`,
        parentPhone: env.demo.parentPhone
      })
    );
  }

  return { admin, warden, facility, students };
}

/**
 * The last `count` class dates for a subject on its weekly timetable, oldest
 * first, walking back from yesterday. Weekends never hold a class.
 */
function classDates(schedule, count) {
  const out = [];
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  for (let back = 1; out.length < count && back < 400; back += 1) {
    const day = new Date(cursor.getTime() - back * 864e5);
    for (const [weekday, slot] of schedule) {
      if (day.getDay() === weekday && out.length < count) {
        const [h, m] = slot.split(":").map(Number);
        const at = new Date(day);
        at.setHours(h, m, 0, 0);
        out.push({ date: at, slot });
      }
    }
  }
  return out.reverse();
}

/**
 * Which sessions a student missed. The demo student's absences cluster in the
 * last fortnight and in the 08:00 slot — the same window as the Hostel B water
 * incident — so the attendance intelligence has a genuine pattern to find.
 * Everyone else misses a scattered, deterministic handful.
 */
function chooseAbsences(sessions, misses, { demo, seed }) {
  if (misses <= 0) return new Set();
  const recentCut = Date.now() - 14 * 864e5;
  const order = sessions.map((session, index) => ({ index, session }));
  if (demo) {
    order.sort((a, b) => {
      const score = (row) =>
        (row.session.date.getTime() >= recentCut ? 2 : 0) + (row.session.slot === "08:00" ? 1 : 0) + row.index / 1000;
      return score(b) - score(a);
    });
    const picked = order.slice(0, misses).map((row) => row.index);
    // One older absence where there are several, so the history is not a cliff.
    if (misses >= 3) {
      const older = order.filter((row) => row.session.date.getTime() < recentCut).map((row) => row.index);
      if (older.length) picked[picked.length - 1] = older[Math.floor(older.length / 2)];
    }
    return new Set(picked);
  }
  order.sort((a, b) => ((a.index * 7 + seed * 5) % 11) - ((b.index * 7 + seed * 5) % 11));
  return new Set(order.slice(0, misses).map((row) => row.index));
}

async function seedAttendance(students) {
  // The demo student sits just below the 75% bar, which is what the eligibility
  // simulator on surface 03 is there to solve. Class counts per subject come
  // from `subjects` and are unchanged; the timetable places them on real days.
  for (const [index, student] of students.entries()) {
    const demo = index === 0;
    for (const [subject, code, total, attended] of subjects) {
      const attendedCount = demo ? attended : Math.min(total, attended + 1);
      const schedule = subjectSchedule[subject] || [[1, "11:00"]];
      const dates = classDates(schedule, total);
      const absent = chooseAbsences(dates, total - attendedCount, { demo, seed: index + code.length });
      const sessions = dates.map((row, i) => {
        const present = !absent.has(i);
        // A few register marks finer than present/absent: arriving late to an
        // 08:00 class, and one approved leave, which still counts as missed.
        let status = present ? "PRESENT" : "ABSENT";
        if (present && row.slot === "08:00" && (i + index) % 4 === 1) status = "LATE";
        if (!present && demo && subject === "DIGITAL ELECTRONICS" && row.date.getTime() < Date.now() - 14 * 864e5) status = "LEAVE";
        return { date: row.date, slot: row.slot, present, status };
      });
      await Attendance.create({
        student: student._id,
        subject,
        subjectCode: code,
        semester: 5,
        totalClasses: total,
        attendedClasses: attendedCount,
        semesterPlanned: schedule.length * SEMESTER_WEEKS,
        sessions
      });
    }

    const rows = await Attendance.find({ student: student._id }).select("attendedClasses totalClasses").lean();
    const totals = rows.reduce(
      (acc, row) => ({ attended: acc.attended + row.attendedClasses, total: acc.total + row.totalClasses }),
      { attended: 0, total: 0 }
    );
    await User.findByIdAndUpdate(student._id, {
      attendancePercentage: round((totals.attended / totals.total) * 100, 1)
    });
  }
}

async function seedMemory(byCode) {
  const docs = [];
  for (const memory of memories) {
    const building = byCode.get(memory.buildingCode);
    docs.push(
      await CampusMemory.create({
        ...memory,
        occurredOn: new Date(memory.occurredOn),
        building: building._id,
        buildingName: building.name,
        keywords: [...new Set(tokenize(`${memory.incidentType} ${memory.cause} ${memory.resolution}`))].slice(0, 24)
      })
    );
  }
  return docs;
}

async function seedComplaints(byCode, students) {
  const created = [];

  // Every complaint goes through the real classification service, so the seeded
  // data is produced the same way a live submission would be.
  const submit = async ({ student, buildingCode, category, title, description, at }) => {
    const building = byCode.get(buildingCode);
    const complaint = new Complaint({
      student: student._id,
      title,
      description,
      category,
      location: `${building.name} · ${student.room || "common area"}`,
      building: building._id,
      createdAt: at,
      updatedAt: at,
      audit: [{ at, actor: student.name, message: `Report submitted by student · ${building.name}`, kind: "ACTUAL DATA" }]
    });

    const { classification, duplicates } = await classify(complaint, { building });
    complaint.aiClassification = classification;
    complaint.category = classification.category;
    complaint.priority = classification.priority;
    complaint.severity = classification.severity;
    complaint.department = classification.routedTo;
    complaint.duplicateProbability = classification.duplicateProbability;
    complaint.duplicateOf = duplicates[0]?.complaint?._id;
    complaint.status = "CLASSIFIED";
    complaint.audit.push({
      at,
      actor: "classificationService",
      message:
        `AI classification: ${classification.category} / ${classification.priority} / ${classification.severity}` +
        (duplicates.length ? ` — ${classification.duplicateProbability}% overlap with ${duplicates[0].complaint.reference}` : ""),
      kind: "AI PREDICTION"
    });

    await complaint.save();
    // createdAt is managed by timestamps, so backdate it explicitly.
    await Complaint.updateOne({ _id: complaint._id }, { $set: { createdAt: at, updatedAt: at } });
    created.push(complaint);
    return complaint;
  };

  const hostelB = students.filter((student) => student.hostelName === "HOSTEL B");

  for (const [index, [title, description, ageOffset]] of waterComplaints.entries()) {
    await submit({
      student: hostelB[index % hostelB.length],
      buildingCode: "HST-B",
      category: "WATER",
      title,
      description,
      at: daysAgo(14 - ageOffset)
    });
  }

  for (const [index, [buildingCode, category, title, description, age]] of otherComplaints.entries()) {
    await submit({
      student: students[(index + 3) % students.length],
      buildingCode,
      category,
      title,
      description,
      at: daysAgo(age)
    });
  }

  return created;
}

async function seedIncidents(byCode, complaints) {
  const groups = [
    { code: "HST-B", category: "WATER", title: "HOSTEL B · WATER SUPPLY FAILURE", status: "INTERVENTION",
      cause: "Booster pump 2 failure — sustained pressure drop since 04:10" },
    { code: "LIB", category: "WI-FI", title: "WI-FI ZONE C · NETWORK ANOMALY", status: "INVESTIGATING",
      cause: "AP cluster C4 dropping sessions above 180 concurrent devices" },
    { code: "MESS-C", category: "MESS", title: "CENTRAL MESS · LUNCH OVERLOAD", status: "PREDICTED",
      cause: "Two blocks share the 13:00 slot after the lab reschedule" },
    { code: "ACAD-A", category: "ATTENDANCE", title: "ACADEMIC BLOCK A · ATTENDANCE DECLINE", status: "INVESTIGATING",
      cause: "Post-night-disruption absence concentrated in 08:00 slots" },
    { code: "MED", category: "HEALTH", title: "MEDICAL CENTRE · ELEVATED WALK-INS", status: "CLUSTERED",
      cause: "Walk-ins up 19% in the week after the mess dissatisfaction spike" }
  ];

  const incidents = [];

  for (const group of groups) {
    const building = byCode.get(group.code);
    const members = complaints.filter(
      (complaint) =>
        String(complaint.building) === String(building._id) && complaint.aiClassification?.category === group.category
    );
    if (!members.length) continue;

    const dates = members.map((complaint) => new Date(complaint.createdAt)).sort((a, b) => a - b);
    const ageDays = (Date.now() - dates[0]) / 864e5;
    const affected = Math.round(building.occupancy * (group.code === "HST-B" ? 0.42 : 0.3));

    const memoryMatches = await CampusMemory.find({ building: building._id, category: group.category })
      .sort({ occurredOn: -1 })
      .limit(4)
      .lean();

    const risk = scoreIncident({
      complaintCount: members.length,
      ageDays,
      affectedStudents: affected,
      severity: members[0].severity,
      historicalCount: memoryMatches.length
    });

    const incident = await Incident.create({
      title: group.title,
      description: `${members.length} complaints in ${round(ageDays, 1)} days, all within ${building.name}.`,
      category: group.category,
      building: building._id,
      complaints: members.map((complaint) => complaint._id),
      status: group.status,
      risk: risk.riskScore,
      riskLevel: risk.riskLevel,
      severity: members[0].severity,
      confidence: 0,
      possibleCauses: [
        { cause: group.cause, confidence: 84, basis: "Historical match plus complaint concentration" }
      ],
      historicalMatches: memoryMatches.map((memory) => memory._id),
      affectedStudents: affected,
      predictedImpact: `${affected} students affected if unresolved`,
      detectedAt: dates[0],
      firstComplaintAt: dates[0],
      clusteredAt: dates[Math.min(2, dates.length - 1)]
    });

    await Complaint.updateMany(
      { _id: { $in: members.map((complaint) => complaint._id) } },
      { relatedIncident: incident._id, status: "INVESTIGATING" }
    );

    // Real confidence, from the real investigation service.
    const investigation = await investigate(incident._id);
    incident.confidence = investigation?.confidence ?? 0;
    incident.evidence = (investigation?.evidence || []).map((item) => ({
      label: item.label,
      value: item.value,
      weight: item.weight,
      kind: item.kind
    }));
    await incident.save();

    building.currentRisk = Math.max(building.currentRisk, incident.risk);
    building.riskLevel = levelFor(building.currentRisk);
    building.activeProblems = members.length;
    building.historicalProblems = memoryMatches.length;
    building.affectedStudents = affected;
    await building.save();

    await Risk.create({
      building: building._id,
      scope: "BUILDING",
      domainLabel: building.domain,
      category: group.category,
      riskScore: incident.risk,
      riskLevel: incident.riskLevel,
      prediction: group.cause,
      confidence: incident.confidence,
      affectedStudents: affected,
      incident: incident._id
    });

    incidents.push(incident);
  }

  return incidents;
}

async function seedInterventions(incidents) {
  const created = [];
  for (const incident of incidents.filter((row) => row.risk >= 60)) {
    const building = await Building.findById(incident.building).lean();
    const investigation = await investigate(incident._id);
    const suggested = recommendAction({ incident, building, investigation });
    const repairNow = simulateScenario({
      scenario: "REPAIR_NOW",
      currentRisk: incident.risk,
      affectedStudents: incident.affectedStudents,
      confidence: suggested.confidence,
      repairHours: suggested.estimatedResolutionHours
    });

    created.push(
      await Intervention.create({
        incident: incident._id,
        building: incident.building,
        recommendedAction: suggested.recommendedAction,
        priority: suggested.priority,
        expectedImpact: suggested.expectedImpact,
        estimatedResolutionHours: suggested.estimatedResolutionHours,
        confidence: suggested.confidence,
        owner: building?.departments?.[0] || "GENERAL ADMINISTRATION",
        affectedStudents: incident.affectedStudents,
        // Left at RECOMMENDED on purpose: the demo's whole point is that a human
        // decides. Nothing is pre-accepted.
        status: "RECOMMENDED",
        projection: {
          riskBefore: repairNow.riskBefore,
          riskAfter: repairNow.riskAfter,
          predictedComplaints: repairNow.predictedComplaints,
          affectedStudents: repairNow.affectedStudents
        }
      })
    );
  }
  return created;
}

async function seedMess(byCode) {
  const mess = byCode.get("MESS-C");
  // Four weeks of every meal, so same-weekday predictions have history to
  // stand on. The lunch and snacks rows keep their original shape; breakfast
  // and dinner come from messExtraSlots.
  const allSlots = [...messSlots, ...messExtraSlots];
  for (let day = 0; day < 28; day += 1) {
    const date = daysAgo(day);
    date.setHours(0, 0, 0, 0);
    const weekday = date.getDay();
    const weekend = weekday === 0 || weekday === 6;
    for (const [time, meal, baseCrowd, queue, waste] of allSlots) {
      // A little day-to-day variation, deterministic so the demo repeats.
      // Today's lunch and snacks use the original formula, so the figures other
      // surfaces quote for today are unchanged.
      const keepOriginal = day === 0 && (meal === "LUNCH" || meal === "SNACKS");
      const wobble = keepOriginal
        ? ((day * 7 + time.charCodeAt(1)) % 11) - 5
        : ((day * 7 + time.charCodeAt(1) + time.charCodeAt(4)) % 11) - 5;
      let factor = 1;
      if (weekend && meal === "LUNCH") factor = 0.84;
      if (weekend && meal === "BREAKFAST") factor = 0.72;
      if (weekday === 0 && meal === "DINNER") factor = 1.08;
      // Dinner has been drawing more students over the last fortnight.
      if (meal === "DINNER" && day < 14) factor *= 1 + (14 - day) * 0.009;
      const crowd = Math.max(0, Math.round(keepOriginal ? baseCrowd + wobble * 4 : baseCrowd * factor + wobble * 4));
      const rotation = messRotation[meal]?.[weekday] || [];
      const menu = meal === "LUNCH" && day === 0
        ? messMenu
        : rotation.map(([item, servings, taken, soldOutAt]) => ({
            item,
            servings,
            takenPercentage: Math.min(100, Math.max(0, taken + (((day * 3 + item.length) % 5) - 2))),
            ...(soldOutAt && (day + item.length) % 3 !== 0 ? { soldOutAt } : {})
          }));
      await MessRecord.create({
        date,
        time,
        meal,
        crowd,
        capacity: 850,
        demand: crowd,
        waste: waste + (day % 3) + (weekend && meal === "BREAKFAST" ? 3 : 0),
        queueMinutes: queue,
        menu,
        building: mess._id
      });
    }
  }
}

/**
 * Demo meal ratings: a handful of students rate each meal each day. The theme
 * and sentiment on every row are computed by the same classifier the API uses
 * for a live submission. Dinner portions draw noticeably more complaints in
 * the last week, which is the pattern the feedback intelligence should find.
 */
async function seedMessFeedback(students) {
  const docs = [];
  const pick = (list, n) => list[n % list.length];
  for (let day = 0; day < 28; day += 1) {
    const date = daysAgo(day);
    date.setHours(12, 0, 0, 0);
    ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"].forEach((meal, m) => {
      const raters = meal === "SNACKS" ? 2 : 4 + ((day + m) % 3);
      for (let r = 0; r < raters; r += 1) {
        const n = day * 13 + m * 7 + r * 3;
        let pool = "good";
        if (meal === "DINNER" && day < 7 && r % 2 === 0) pool = "quantity";
        else if (meal === "LUNCH" && r === 1 && n % 3 === 0) pool = "queue";
        else if (meal === "LUNCH" && r === 2 && n % 5 === 0) pool = "availability";
        else if (meal === "BREAKFAST" && r === 1 && n % 2 === 0) pool = "temperature";
        else if (r === 3 && n % 4 === 0) pool = "taste";
        else if (r === 2 && n % 9 === 0) pool = "variety";
        else if (n % 23 === 0) pool = "hygiene";
        else if (meal === "DINNER" && day >= 7 && n % 6 === 0) pool = "quantity";
        const [comment, rating] = pick(messFeedbackTemplates[pool], n);
        const { themes, sentiment, method } = classifyFeedback({ comment, rating });
        docs.push({
          student: students[(day * 5 + m * 3 + r) % students.length]._id,
          date,
          meal,
          rating,
          comment: comment || undefined,
          themes,
          sentiment,
          method
        });
      }
    });
  }
  await MessFeedback.insertMany(docs);
}

async function seedRelationships(byCode) {
  for (const { chain, steps } of relationshipSeed) {
    for (const [index, [fromLabel, toLabel, confidence, basis]] of steps.entries()) {
      await Relationship.create({
        chain,
        fromLabel,
        toLabel,
        order: index,
        confidence,
        basis,
        relation: "LEADS_TO",
        kind: "AI PREDICTION",
        entityType: chain === "HOSTEL_WATER" ? "Building" : undefined,
        entityId: chain === "HOSTEL_WATER" ? byCode.get("HST-B")._id : undefined
      });
    }
  }
}

async function linkAttendanceToIncident(byCode, incidents) {
  // Cross-domain: Hostel B residents' 08:00 absences flagged against the water
  // incident, which is what surface 07's cross-domain nodes read.
  const water = incidents.find((incident) => incident.category === "WATER");
  if (!water) return;

  const residents = await User.find({ hostel: byCode.get("HST-B")._id }).select("_id").lean();
  await Attendance.updateMany(
    { student: { $in: residents.map((row) => row._id) }, subject: { $in: ["DATA STRUCTURES", "DBMS"] } },
    { linkedIncident: water._id }
  );
}

async function run() {
  assertEnv();
  await connectDB();

  const fresh = process.argv.includes("--fresh");
  const existing = await Building.estimatedDocumentCount();
  if (existing && !fresh) {
    console.log("Database already holds data. Re-run with --fresh to wipe and reseed.");
    await disconnectDB();
    return;
  }

  console.log("Wiping collections…");
  await wipe();

  console.log("Seeding buildings…");
  const byCode = await seedBuildings();

  console.log("Seeding users…");
  const { students } = await seedUsers(byCode);

  console.log("Seeding attendance…");
  await seedAttendance(students);

  console.log("Seeding campus memory…");
  await seedMemory(byCode);

  console.log("Seeding complaints (through the real classification service)…");
  const complaints = await seedComplaints(byCode, students);

  console.log("Clustering into incidents…");
  const incidents = await seedIncidents(byCode, complaints);

  console.log("Deriving intervention recommendations…");
  await seedInterventions(incidents);

  console.log("Seeding mess records…");
  await seedMess(byCode);

  console.log("Seeding mess feedback…");
  await seedMessFeedback(students);

  console.log("Seeding cross-domain relationships…");
  await seedRelationships(byCode);

  console.log("Running anomaly detection…");
  await sweep(anomalyReadings);

  await linkAttendanceToIncident(byCode, incidents);

  // EXTENSION HOOK (see HOOKS.md): runs after every original step; skip with --no-ext.
  if (!process.argv.includes("--no-ext")) await seedExtensions();
  // EXCEPTION-ONLY HOOK: runs after the extension seed; --no-xo (or --no-ext) skips it.
  if (!process.argv.includes("--no-ext") && !process.argv.includes("--no-xo")) await seedExceptionOnly();
  // ROUND-3 HOOK: runs after the exception-only seed; --no-proof (or --no-xo / --no-ext) skips it.
  if (!["--no-ext", "--no-xo", "--no-proof"].some((f) => process.argv.includes(f))) await seedProof();
  // SUPPORT HOOK: Silent Support System demo data (support-team account + aggregate history); --no-support skips it.
  if (!process.argv.includes("--no-support")) await seedSupport();
  // CAMPUS RESOURCE SHARING: Student <-> Admin resources
  await seedResources();
  await flushEvents(); // EXCEPTION-ONLY HOOK: pending campus events are written before the connection closes

  const counts = {
    buildings: await Building.countDocuments(),
    users: await User.countDocuments(),
    complaints: await Complaint.countDocuments(),
    incidents: await Incident.countDocuments(),
    resources: await Resource.countDocuments(),
    interventions: await Intervention.countDocuments(),
    memory: await CampusMemory.countDocuments(),
    anomalies: await Anomaly.countDocuments(),
    attendance: await Attendance.countDocuments(),
    mess: await MessRecord.countDocuments(),
    messFeedback: await MessFeedback.countDocuments()
  };

  console.log("\nSeed complete:");
  for (const [key, value] of Object.entries(counts)) console.log(`  ${key.padEnd(14)} ${value}`);
  console.log("\nDemo accounts:");
  console.log(`  student  ${env.demo.studentEmail} / ${env.demo.studentPassword}`);
  console.log(`  admin    ${env.demo.adminEmail} / ${env.demo.adminPassword}`);
  if (!process.argv.includes("--no-support")) console.log(`  support  ${COUNSELLOR_EMAIL} / ${COUNSELLOR_PASSWORD}`); // SUPPORT HOOK

  await disconnectDB();
}

run().catch(async (error) => {
  console.error("Seed failed:", error);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
