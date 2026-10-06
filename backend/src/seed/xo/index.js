import { loadActors } from "../ext/phase1.js";
import { seedXoHistory } from "./history.js";
import { seedPolicyHistory } from "./policy.js";
import { seedReach } from "./reach.js";
import { seedChanges } from "./changes.js";
import { seedStaffPhones } from "./sms.js";
import { Incident } from "../../models/Incident.js";
import { Asset } from "../../models/xo/Asset.js";
import { IncidentFollow } from "../../models/xo/IncidentFollow.js";
import { ensureAssets } from "../../services/xo/assetService.js";
import { followIncident } from "../../services/xo/deflectionService.js";
import { CampusEvent } from "../../models/xo/CampusEvent.js";
import { backfillEvents } from "../../services/xo/backfillService.js";
import { flushEvents } from "../../services/xo/eventService.js";

/**
 * Seeds the Exception-Only Campus additions. Safe to re-run: every record it
 * writes is either in a collection of its own or carries a reserved reference,
 * and is cleared before it is written again. Runs after the base seed and the
 * extension seed (npm run seed), or alone with npm run seed:xo.
 */
export async function seedExceptionOnly({ log = console.log } = {}) {
  const { admin, warden, facility, students } = await loadActors();
  if (!admin || !students.length) throw new Error("Run the base seed first (npm run seed -- --fresh).");
  const counts = {};

  log("Exception-only: resolved history, reopenings and fix answers…");
  const history = await seedXoHistory({
    students,
    resolvers: { WATER: warden || facility || admin, ELECTRICITY: facility || admin, default: facility || admin }
  });
  counts.resolvedHistory = history.length;

  log("Exception-only: policy rules and Touchless Lane history…");
  const policy = await seedPolicyHistory({ students, warden, admin });
  counts.policyCertificates = `${policy.instant} instant / ${policy.routed} to the office`;
  counts.policyGatePasses = `${policy.passesInstant} instant / ${policy.passes - policy.passesInstant} to the warden`;

  log("Exception-only: assets and incident followers…");
  await Asset.deleteMany({});
  await ensureAssets();
  await IncidentFollow.deleteMany({});
  const water = await Incident.findOne({ category: "WATER", status: { $ne: "RESOLVED" } }).sort({ risk: -1 });
  // Two Hostel B residents chose "+1 & Follow" instead of filing a duplicate (not the demo student).
  if (water) for (const s of students.slice(1).filter((x) => x.hostelName === "HOSTEL B").slice(0, 2)) await followIncident(s, water._id, { room: s.room });
  counts.assets = await Asset.countDocuments();

  log("Exception-only: class representatives and guaranteed-reach notices…");
  const reach = await seedReach({ admin, warden, students });
  counts.classReps = reach.classReps;
  counts.reachLadder = `${reach.reachNotice}: SMS ${reach.ladder.sms} · class rep ${reach.ladder.classRep} · kiosk ${reach.ladder.kiosk}`;

  log("Exception-only: change propagation and planned shutdowns…");
  const changes = await seedChanges({ admin, facility });
  counts.changes = `${changes.classChanges} class · ${changes.menuChanges} menu · ${changes.shutdowns} shutdowns`;

  log("Exception-only: staff numbers for the SMS work loop…");
  counts.staffPhones = await seedStaffPhones({ facility, warden, admin });

  // Events emitted live while the earlier seed steps ran are written first, so
  // the backfill can tell which records already have them.
  await flushEvents();
  log("Exception-only: deriving campus events for older records…");
  const backfill = await backfillEvents({ actor: admin });
  counts.eventsBackfilled = backfill.written;
  counts.eventsLive = await CampusEvent.countDocuments({ origin: "LIVE" });
  return counts;
}
