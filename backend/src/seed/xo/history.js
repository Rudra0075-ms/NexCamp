import { Building } from "../../models/Building.js";
import { Complaint } from "../../models/Complaint.js";
import { FixConfirmation } from "../../models/ext/FixConfirmation.js";
import { ReopenRequest } from "../../models/ext/ReopenRequest.js";
import { nextReference } from "../../models/ext/common.js";
import { classify } from "../../services/classificationService.js";
import { backdate } from "../ext/phase1.js";

/**
 * Resolved history for the Exception-Only Campus (Phase 0).
 *
 * The base seed resolves nothing and the extension seed resolves six
 * complaints, which is too thin for a median, a P50/P80 ETA, a reopen rate or
 * an asset's repair history. This adds 40 resolved complaints spread over the
 * last nine months with realistic resolution times, a few that came back
 * (a new complaint on the same room within 7 days — a false closure), and
 * answers to "Is it fixed?" (YES, NOT FIXED with a reopen request, no answer).
 *
 * Every record uses a reserved reference (CMP-1801 … CMP-1840) so it can be
 * cleared and re-seeded without touching any other record. Records are
 * inserted directly: not clustered into an incident and not counted on a
 * building, and none is younger than 20 days in the Hostel B water category,
 * so the seeded Hostel B incident story is unchanged.
 */

export const XO_HISTORY_PREFIX = "CMP-18";
const refOf = (i) => `CMP-${1801 + i}`;
const daysAgo = (d) => new Date(Date.now() - d * 864e5);

// [buildingCode, room, category, title, description, daysAgo, resolveHours, fix, channel, answer]
// answer: YES | NOT_FIXED | NONE (asked, never answered) | null (not asked)
export const HISTORY = [
  // Hostel B booster pump 2 — four failures in nine months (asset history, page 06/09).
  ["HST-B", "Pump room", "WATER", "No water on any floor of Hostel B", "Booster pump 2 tripped again and no floor of Hostel B has water since the morning.", 262, 9, "Booster pump 2 impeller cleared and motor restarted", "APP", "YES"],
  ["HST-B", "Pump room", "WATER", "Hostel B taps dry since 5 am", "Taps on the second and third floor dry since 5 am, booster pump 2 not running.", 181, 14, "Booster pump 2 capacitor replaced", "KIOSK", "YES"],
  ["HST-B", "Pump room", "WATER", "Very low water pressure Hostel B", "Water pressure very low in the whole of Hostel B, booster pump 2 making noise.", 97, 22, "Booster pump 2 bearing replaced", "APP", "NOT_FIXED"],
  ["HST-B", "Pump room", "WATER", "Water supply stopped in Hostel B", "Water supply stopped in Hostel B again, pump room says booster pump 2 failed.", 41, 31, "Booster pump 2 rewound; standby pump put on duty", "SMS", "NONE"],
  // plumbing
  ["HST-A", "A-118", "WATER", "Tap leaking in A-118 washroom", "The tap in the A-118 washroom leaks all night.", 64, 7, "Tap washer replaced", "APP", "YES"],
  ["HST-A", "A-118", "WATER", "Tap in A-118 washroom leaking again", "The same tap in A-118 is leaking again three days after it was fixed.", 60, 5, "Tap spindle and body replaced", "APP", "YES"],
  ["HST-C", "C-219", "WATER", "Flush not working in C-219", "The flush tank in C-219 does not fill.", 150, 26, "Float valve replaced", "APP", "YES"],
  ["HST-A", "A-212", "WATER", "Washbasin blocked near A-212", "The washbasin outside A-212 is blocked and water stands in it.", 120, 11, "Drain line cleared", "KIOSK", null],
  ["HST-C", "C-104", "WATER", "Geyser not heating in C-104 washroom", "The geyser in the C-104 washroom gives cold water.", 88, 48, "Heating element replaced", "APP", "YES"],
  ["HST-A", "A-107", "WATER", "Shower head broken A-107", "Shower head in A-107 washroom is broken.", 33, 19, "Shower head replaced", "APP", "NONE"],
  // electrical
  ["HST-C", "C-310", "ELECTRICITY", "Ceiling fan not working in C-310", "The ceiling fan in C-310 does not start.", 210, 6, "Fan capacitor replaced", "APP", "YES"],
  ["HST-A", "A-118", "ELECTRICITY", "Tube light not working in A-118", "Tube light in A-118 is not working.", 140, 4, "Tube and starter replaced", "APP", "YES"],
  ["HST-B", "B-302", "ELECTRICITY", "Power socket dead in B-302", "The study table socket in B-302 has no power.", 112, 9, "Socket rewired", "SMS", "YES"],
  ["ACAD-A", "Room 204", "ELECTRICITY", "Projector room lights off", "Lights in room 204 of the academic block do not switch on.", 75, 3, "MCB reset and switch replaced", "APP", null],
  ["HST-C", "C-121", "ELECTRICITY", "Fan regulator broken C-121", "The fan regulator in C-121 is broken, fan runs only at full speed.", 52, 12, "Regulator replaced", "APP", "NOT_FIXED"],
  ["HST-C", "C-121", "ELECTRICITY", "Fan in C-121 still not regulating", "Fan regulator in C-121 still not working after the repair.", 49, 8, "Regulator and wiring replaced", "APP", "YES"],
  ["LIB", "Reading hall", "ELECTRICITY", "Reading hall lights flicker", "Several lights in the library reading hall flicker in the evening.", 27, 20, "Chokes replaced on six fittings", "APP", "YES"],
  ["HST-A", "A-212", "ELECTRICITY", "Corridor light off near A-212", "The corridor light near A-212 is off.", 22, 5, "Bulb replaced", "KIOSK", "NONE"],
  // network
  ["LIB", "First floor", "WI-FI", "Wi-Fi slow on library first floor", "Wi-Fi on the library first floor is too slow to open the portal.", 230, 30, "Access point channel changed", "APP", "YES"],
  ["HST-B", "B-118", "WI-FI", "No Wi-Fi in B-118", "Wi-Fi signal does not reach B-118.", 170, 52, "Repeater added on first floor", "APP", "YES"],
  ["HST-C", "C-219", "WI-FI", "Wi-Fi keeps disconnecting in Hostel C", "Wi-Fi disconnects every few minutes on the second floor of Hostel C.", 130, 40, "Access point firmware updated", "SMS", "NOT_FIXED"],
  ["ACAD-A", "Lab 3", "WI-FI", "Lab 3 cannot reach the exam portal", "Computers in lab 3 cannot open the exam portal.", 95, 6, "Proxy rule corrected", "APP", null],
  ["LIB", "Reading hall", "WI-FI", "Wi-Fi drops in the reading hall", "Wi-Fi drops in the reading hall when many students are connected.", 60, 72, "Second access point installed", "APP", "YES"],
  ["HST-A", "A-107", "WI-FI", "Wi-Fi login page not loading A block", "The Wi-Fi login page does not load in Hostel A.", 30, 18, "Captive portal certificate renewed", "APP", "YES"],
  ["HST-C", "C-310", "WI-FI", "Weak Wi-Fi in C-310", "Very weak Wi-Fi signal in C-310.", 24, 28, "Access point realigned", "KIOSK", "NONE"],
  // housekeeping
  ["HST-C", "C-104", "CLEANLINESS", "Washroom not cleaned C block ground floor", "The ground floor washroom in Hostel C has not been cleaned for two days.", 190, 10, "Cleaning roster corrected", "APP", "YES"],
  ["HST-A", "A-212", "CLEANLINESS", "Garbage near A-212 not cleared", "Garbage bags near A-212 have not been cleared.", 145, 16, "Bins cleared, pickup time moved", "APP", "YES"],
  ["HST-B", "B-221", "CLEANLINESS", "Corridor dirty outside B-221", "The corridor outside B-221 is dirty and smells.", 100, 7, "Corridor washed", "SMS", null],
  ["ACAD-A", "Ground floor", "CLEANLINESS", "Academic block washroom dirty", "The ground floor washroom in the academic block is very dirty.", 70, 5, "Washroom cleaned; checklist posted", "APP", "YES"],
  ["HST-C", "C-104", "CLEANLINESS", "Washroom near C-104 dirty again", "The washroom near C-104 is dirty again.", 66, 9, "Extra cleaning shift added", "APP", "NOT_FIXED"],
  ["HST-A", "A-107", "CLEANLINESS", "Dustbin missing near A-107", "There is no dustbin near A-107.", 26, 30, "Dustbin placed", "APP", "YES"],
  // mess
  ["MESS-C", "Counter 2", "MESS", "Plates not clean at counter 2", "Plates at mess counter 2 are not washed properly.", 175, 12, "Dishwashing checked; hot rinse added", "APP", "YES"],
  ["MESS-C", "Dining hall", "MESS", "Drinking water cooler warm", "The water cooler in the dining hall gives warm water.", 125, 36, "Cooler serviced", "APP", "YES"],
  ["MESS-C", "Counter 1", "MESS", "Dinner served cold", "Dinner at counter 1 is served cold after 8 pm.", 85, 24, "Hot case repaired", "KIOSK", null],
  ["MESS-C", "Dining hall", "MESS", "Fans not working in mess hall", "Two fans in the mess dining hall do not work.", 45, 20, "Fans repaired", "APP", "YES"],
  ["MESS-C", "Counter 2", "MESS", "Long queue at counter 2 lunch", "Lunch queue at counter 2 is very long because only one server is present.", 23, 26, "Second server added at 13:00", "APP", "NONE"],
  // other offices
  ["ADMN", "Fee counter", "OTHER", "Fee receipt not given", "The fee counter did not give a receipt for my hostel fee.", 160, 30, "Receipt issued and emailed", "APP", "YES"],
  ["ADMN", "Scholarship desk", "OTHER", "Scholarship form not accepted", "The scholarship desk did not accept my form.", 110, 50, "Form accepted after document check", "APP", null],
  ["SPRT", "Court 2", "SAFETY", "Broken net on court 2", "The badminton net on court 2 is torn.", 80, 60, "Net replaced", "APP", "YES"],
  ["ADMN", "Front desk", "OTHER", "ID card correction pending", "My ID card has the wrong branch printed.", 35, 70, "ID card reprinted", "KIOSK", "YES"]
];

export async function clearXoHistory() {
  const refs = HISTORY.map((_, i) => refOf(i));
  const ids = (await Complaint.find({ reference: { $in: refs } }).select("_id").lean()).map((c) => c._id);
  await Promise.all([
    FixConfirmation.deleteMany({ complaint: { $in: ids } }),
    ReopenRequest.deleteMany({ complaint: { $in: ids } }),
    Complaint.deleteMany({ _id: { $in: ids } })
  ]);
}

/** Inserts the history. Returns the created complaints in HISTORY order. */
export async function seedXoHistory({ students, resolvers }) {
  await clearXoHistory();
  const byCode = new Map((await Building.find().lean()).map((b) => [b.code, b]));
  const byRoom = (room) => students.find((s) => s.room === room);
  const out = [];
  for (const [i, [code, room, category, title, description, ago, hours, fix, channel, answer]] of HISTORY.entries()) {
    const building = byCode.get(code);
    if (!building) continue;
    const student = byRoom(room) || students[(i * 7) % students.length];
    const at = daysAgo(ago);
    const resolvedAt = new Date(at.getTime() + hours * 3600000);
    const resolver = resolvers[category] || resolvers.default;
    const complaint = new Complaint({
      reference: refOf(i),
      student: student._id,
      title,
      description,
      category,
      location: `${building.name} · ${room}`,
      building: building._id,
      channel,
      audit: [{ at, actor: student.name, message: `Report submitted by student · ${building.name} · ${room}`, kind: "ACTUAL DATA" }]
    });
    const { classification } = await classify(complaint, { building });
    Object.assign(complaint, {
      aiClassification: classification,
      category: classification.category,
      priority: classification.priority,
      severity: classification.severity,
      department: classification.routedTo,
      status: "RESOLVED",
      resolution: { resolutionTimeHours: hours, resolvedBy: resolver._id, resolutionDescription: fix, resolvedAt }
    });
    complaint.audit.push(
      { at: new Date(at.getTime() + 60000), actor: "classificationService", message: `rule-based (AI not configured) classification: ${classification.category} / ${classification.priority}`, kind: "AI PREDICTION" },
      { at: new Date(at.getTime() + 25 * 60000), actor: "system", message: `Assigned to ${classification.routedTo}`, kind: "ACTUAL DATA" },
      { at: resolvedAt, actor: resolver.name, message: `Resolved in ${hours}h — ${fix}`, kind: "ACTUAL DATA" }
    );
    await complaint.save();
    await backdate(Complaint, complaint._id, { createdAt: at, updatedAt: resolvedAt });

    if (answer) {
      const confirmation = await FixConfirmation.create({
        complaint: complaint._id,
        complaintReference: complaint.reference,
        department: complaint.department,
        student: student._id,
        askedAt: resolvedAt,
        response: answer === "NONE" ? "NO_RESPONSE" : answer,
        respondedAt: answer === "NONE" ? new Date(resolvedAt.getTime() + 48 * 3600000) : new Date(resolvedAt.getTime() + (6 + (i % 5) * 7) * 3600000),
        comment: answer === "NOT_FIXED" ? "Still the same problem." : undefined
      });
      if (answer === "NOT_FIXED") {
        const reopen = await ReopenRequest.create({
          reference: await nextReference("RPN"),
          complaint: complaint._id,
          complaintReference: complaint.reference,
          student: student._id,
          department: complaint.department,
          reason: "Student reports the problem is not fixed (seeded history)",
          status: "CLOSED",
          history: [
            { at: confirmation.respondedAt, action: "REOPEN_REQUESTED", actorName: student.name, actorRole: "STUDENT", note: `${complaint.reference} · seeded history` },
            { at: new Date(confirmation.respondedAt.getTime() + 30 * 3600000), action: "REOPEN_CLOSED", actorName: resolver.name, actorRole: resolver.role, note: "Re-inspected and closed" }
          ]
        });
        await backdate(ReopenRequest, reopen._id, { createdAt: confirmation.respondedAt, updatedAt: new Date(confirmation.respondedAt.getTime() + 30 * 3600000) });
        await FixConfirmation.updateOne({ _id: confirmation._id }, { $set: { reopen: reopen._id } });
      }
      await backdate(FixConfirmation, confirmation._id, { createdAt: resolvedAt, updatedAt: confirmation.respondedAt });
    }
    out.push(complaint);
  }
  return out;
}
