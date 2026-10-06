import { User } from "../../models/User.js";
import { StudentProfile } from "../../models/ext/StudentProfile.js";
import { sendFeeReminders } from "./feeService.js";
import { expireConfirmations } from "./fixService.js";
import { escalateUnread, releaseDigest, releaseScheduled } from "./noticeService.js";
import { reachSweep } from "../xo/reachService.js"; // EXCEPTION-ONLY HOOK
import { followUpSweep } from "../support/supportService.js"; // SUPPORT HOOK

/**
 * One timer for the extension's time-based rules, in the same spirit as the
 * existing gate-pass monitor: scheduled notices, the 07:30 quiet-hours digest,
 * SMS escalation of unread CRITICAL / action-required notices, fee reminders,
 * and the 48-hour NO RESPONSE rule for fix confirmations.
 */

export async function phoneFor(userId) {
  const profile = await StudentProfile.findOne({ student: userId }).select("registeredPhone").lean();
  if (profile?.registeredPhone) return profile.registeredPhone;
  const user = await User.findById(userId).select("phone").lean();
  return user?.phone || null;
}

export async function runSweep({ now = new Date(), actor } = {}) {
  const out = { at: now };
  out.scheduledReleased = await releaseScheduled(now);
  out.digestReleased = await releaseDigest(now);
  out.smsEscalations = await escalateUnread(now, { phoneFor });
  out.feeReminders = await sendFeeReminders({ now, actor });
  out.noResponse = await expireConfirmations(now);
  // EXCEPTION-ONLY HOOK (see CHANGES-EXCEPTION-ONLY.md): the guaranteed-reach ladder rides the same timer.
  out.reachLadder = await reachSweep({ now, phoneFor });
  // SUPPORT HOOK (see CHANGES-SILENT-SUPPORT.md): "check on me later" follow-ups ride the same timer.
  out.supportFollowUps = await followUpSweep(now).catch((error) => { console.error("extMonitor: support follow-up sweep failed —", error.message); return 0; });
  return out;
}

let timer = null;
let running = false;

export function startExtensionMonitor({ seconds = Number(process.env.EXT_MONITOR_SECONDS || 60) } = {}) {
  if (timer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runSweep();
    } catch (error) {
      console.error("extMonitor: sweep failed —", error.message);
    } finally {
      running = false;
    }
  };
  timer = setInterval(tick, Math.max(10, seconds) * 1000);
  timer.unref?.();
  setTimeout(tick, 3000).unref?.();
}

export function stopExtensionMonitor() {
  if (timer) clearInterval(timer);
  timer = null;
}
