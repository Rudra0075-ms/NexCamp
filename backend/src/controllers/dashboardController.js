import { Anomaly } from "../models/Anomaly.js";
import { Building } from "../models/Building.js";
import { Complaint } from "../models/Complaint.js";
import { Incident } from "../models/Incident.js";
import { summariseStudent } from "../services/attendanceService.js";
import { demandCurve } from "../services/messService.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ok } from "../utils/respond.js";
import { round } from "../utils/text.js";

/**
 * GET /api/students/me/dashboard
 * One read for the student surface: attendance, eligibility, the incidents that
 * touch this student's own block, their open reports and today's mess load.
 */
export const studentDashboard = asyncHandler(async (req, res) => {
  const user = req.user;

  const [attendance, complaints, hostel, mess] = await Promise.all([
    summariseStudent(user._id),
    Complaint.find({ student: user._id })
      .populate("building", "code name")
      .populate("relatedIncident", "reference title risk status")
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
    user.hostel ? Building.findById(user.hostel).lean() : null,
    demandCurve(new Date())
  ]);

  const hostelIncidents = hostel
    ? await Incident.find({ building: hostel._id, status: { $ne: "RESOLVED" } }).sort({ risk: -1 }).limit(3).lean()
    : [];

  const hostelAnomalies = hostel
    ? await Anomaly.find({ building: hostel._id, status: { $in: ["OPEN", "ACKNOWLEDGED"] } })
        .sort({ predictedRisk: -1 })
        .limit(2)
        .lean()
    : [];

  const nowSlot =
    mess.slots.find((slot) => slot.time >= new Date().toISOString().slice(11, 16)) || mess.peak || mess.slots[0] || null;

  // Each alert is labelled with its provenance, which is what the UI chips show.
  const alerts = [];

  if (hostelIncidents[0]) {
    const lead = hostelIncidents[0];
    alerts.push({
      kind: "ACTUAL DATA",
      tone: lead.risk >= 70 ? "high" : "mid",
      title: `${lead.title} in your hostel`,
      body: `${hostel.name} · ${lead.complaints?.length || 0} complaints · risk ${lead.risk}%.`,
      cta: "TRACE INCIDENT",
      target: "investigation",
      incidentId: String(lead._id)
    });
  }

  if (!attendance.eligible) {
    alerts.push({
      kind: "AI PREDICTION",
      tone: "mid",
      title: "Attendance below the eligibility bar",
      body:
        `You are at ${attendance.overall}% against a ${attendance.threshold}% requirement. ` +
        (attendance.simulation.classesToThreshold
          ? `${attendance.simulation.classesToThreshold} consecutively attended classes clears it.`
          : "Attend the remaining classes to recover."),
      cta: "OPEN SIMULATOR",
      target: "attendance"
    });
  }

  if (mess.peak) {
    alerts.push({
      kind: "AI RECOMMENDATION",
      tone: "low",
      title: `Mess will peak at ${mess.peak.time} today`,
      body: `Predicted ${mess.peak.crowd} against ${mess.capacity} capacity. Arriving earlier avoids the queue.`,
      cta: "SEE DEMAND CURVE",
      target: "mess"
    });
  }

  if (hostelAnomalies[0]) {
    alerts.push({
      kind: "AI PREDICTION",
      tone: "mid",
      title: "Silent signal in your block",
      body: `${hostelAnomalies[0].signal} · ${hostelAnomalies[0].predictedRisk}% predicted risk, ${hostelAnomalies[0].complaintsSoFar} complaints so far.`,
      cta: "OPEN RISK CENTER",
      target: "risk"
    });
  }

  const openReports = complaints.filter((c) => c.status !== "RESOLVED");
  const progressFor = (status) =>
    ({ PENDING: 20, CLASSIFIED: 40, ASSIGNED: 60, INVESTIGATING: 80, RESOLVED: 100 })[status] ?? 0;

  return ok(res, {
    student: {
      ...user.toPublic(),
      hostelName: hostel?.name || user.hostelName,
      room: user.room
    },
    attendance: {
      overall: attendance.overall,
      threshold: attendance.threshold,
      eligible: attendance.eligible,
      attendedClasses: attendance.attendedClasses,
      totalClasses: attendance.totalClasses,
      classesToThreshold: attendance.simulation.classesToThreshold,
      classesCanMiss: attendance.simulation.classesCanMiss,
      subjects: attendance.subjects
    },
    alerts,
    reports: complaints.map((complaint) => ({
      id: String(complaint._id),
      reference: complaint.reference,
      title: complaint.title,
      building: complaint.building?.name || complaint.location,
      status: complaint.status,
      progress: progressFor(complaint.status),
      ageDays: round((Date.now() - new Date(complaint.createdAt)) / 864e5),
      incident: complaint.relatedIncident
        ? { reference: complaint.relatedIncident.reference, risk: complaint.relatedIncident.risk }
        : null,
      createdAt: complaint.createdAt
    })),
    tiles: [
      {
        key: "MESS NOW",
        value: nowSlot ? String(nowSlot.crowd) : "—",
        sub: nowSlot ? `of ${mess.capacity} capacity · queue ${nowSlot.queueMinutes} min` : "no mess data today"
      },
      {
        key: hostel ? hostel.code : "CAMPUS",
        value: hostel ? hostel.riskLevel : "—",
        sub: hostel ? `risk ${hostel.currentRisk}% · ${hostel.activeProblems} active problems` : ""
      },
      {
        key: "OPEN REPORTS",
        value: String(openReports.length),
        sub: openReports.length
          ? openReports.map((c) => c.status.toLowerCase()).join(" · ")
          : "nothing open"
      },
      {
        key: "CLASSES LEFT",
        value: String(Math.max(0, attendance.simulation.classesCanMiss)),
        sub: `you can miss this many and stay above ${attendance.threshold}%`
      }
    ],
    hostel: hostel
      ? {
          id: String(hostel._id),
          code: hostel.code,
          name: hostel.name,
          currentRisk: hostel.currentRisk,
          riskLevel: hostel.riskLevel,
          activeProblems: hostel.activeProblems
        }
      : null,
    mess: { peak: mess.peak, capacity: mess.capacity, now: nowSlot }
  });
});
