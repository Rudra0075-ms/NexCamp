import * as ext from "../../models/ext/index.js";
import { runSweep } from "../../services/ext/extMonitor.js";
import { loadActors, seedClassChanges, seedDocuments, seedFees, seedMenuChange, seedNotices, seedProfiles, seedSchedules } from "./phase1.js";
import { clearHistory, seedPhase2 } from "./phase2.js";

/**
 * Seeds every panel added by the extension pack. Safe to re-run: it clears
 * only the extension's own collections (and the handful of historical records
 * it adds, identified by their reserved references) before writing.
 */

const COLLECTIONS = [
  "ExtCounter", "StudentProfile", "Notice", "NoticeReceipt", "DocumentRequest", "ClassSchedule", "ClassChange",
  "MenuChange", "FeeAccount", "FrictionBaseline", "SmsMessage", "FixProof", "FixConfirmation", "ReopenRequest",
  "PolicySection", "FaqQuery"
];

export async function wipeExtensions() {
  await Promise.all(COLLECTIONS.map((name) => ext[name].deleteMany({})));
  await clearHistory();
}

export async function seedExtensions({ log = console.log } = {}) {
  await wipeExtensions();
  const { admin, warden, facility, students } = await loadActors();
  if (!admin || !students.length) throw new Error("Run the base seed first (npm run seed -- --fresh).");

  log("Extension: student profiles, timetable, class changes…");
  await seedProfiles(students);
  const schedules = await seedSchedules();
  await seedClassChanges(schedules, admin, students[0]);
  await seedMenuChange(admin);

  log("Extension: notices, documents, fees…");
  await seedNotices(admin, warden, students[0]);
  await seedDocuments(students, admin, warden);
  await seedFees(students);

  log("Extension: friction baselines, history, proof of fix, SMS log, policy corpus…");
  await seedPhase2({ admin, warden, facility, students });

  // Run the time-based rules once so the quiet-hours digest, SMS escalation
  // and fee reminders are visible straight after seeding.
  const sweep = await runSweep({ actor: admin });
  log(`Extension: first sweep — ${JSON.stringify({ digest: sweep.digestReleased, sms: sweep.smsEscalations, fees: sweep.feeReminders, noResponse: sweep.noResponse })}`);

  const counts = {};
  for (const name of COLLECTIONS.filter((n) => n !== "ExtCounter")) counts[name] = await ext[name].countDocuments();
  return counts;
}
