import { ROLES } from "../config/constants.js";
import { Notification } from "../models/Notification.js";
import { User } from "../models/User.js";
import { classifyNotification } from "./notificationPriority.js";
import { sendSms } from "./smsService.js";

/**
 * Records one in-app alert. Deduplicated per pass + kind + recipient.
 *
 * The only change the AI layer makes here is the priority stamp — the
 * deduplication, the delivery and the existing `tone` all behave exactly as
 * before, so nothing that already reads these rows is affected.
 */
export async function notify({ kind, audience, user, gatePass, title, body, tone = "mid", priority }) {
  if (!user) return null;
  const existing = await Notification.findOne({ kind, audience, user, gatePass });
  if (existing) return existing;

  const graded = classifyNotification({ kind, title, body, explicitPriority: priority });

  return Notification.create({
    kind,
    audience,
    user,
    gatePass,
    title,
    body,
    tone,
    channel: "IN_APP",
    ...graded
  });
}

/** Sends one SMS to a guardian and records that it happened. */
export async function notifyParent({ kind, gatePass, phone, title, body }) {
  const delivery = await sendSms(phone, body);
  const graded = classifyNotification({ kind, title, body });
  return Notification.create({
    ...graded,
    kind,
    audience: "PARENT",
    gatePass: gatePass?._id,
    channel: "SMS",
    title,
    body,
    tone: "high",
    deliveredAt: delivery.delivered ? new Date() : undefined,
    deliveryMode: delivery.mode,
    deliveryError: delivery.error
  });
}

/**
 * The staff who need to know about a hostel's gate passes: the warden of that
 * building, plus every campus administrator.
 */
export async function hostelStaff(hostelId) {
  const query = hostelId
    ? { $or: [{ role: ROLES.WARDEN, hostel: hostelId }, { role: ROLES.ADMIN }] }
    : { role: { $in: [ROLES.WARDEN, ROLES.ADMIN] } };
  const staff = await User.find(query).select("_id role");
  // A hostel with no warden of its own still has to reach somebody.
  if (staff.some((row) => row.role === ROLES.WARDEN)) return staff;
  const wardens = await User.find({ role: ROLES.WARDEN }).select("_id role");
  return [...staff, ...wardens];
}

/** Fans one alert out to every warden and admin responsible for a hostel. */
export async function notifyStaff({ kind, gatePass, hostelId, title, body, tone = "high", priority }) {
  const staff = await hostelStaff(hostelId);
  await Promise.all(
    staff.map((member) =>
      notify({
        kind,
        audience: member.role === ROLES.ADMIN ? "ADMIN" : "WARDEN",
        user: member._id,
        gatePass: gatePass?._id,
        title,
        body,
        tone,
        priority
      })
    )
  );
}
