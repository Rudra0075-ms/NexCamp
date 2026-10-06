import { ROLES } from "../config/constants.js";
import { Notification } from "../models/Notification.js";
import { User } from "../models/User.js";
import { classifyNotification } from "./notificationPriority.js";

/**
 * Routes an escalated complaint into the notification system that already
 * exists.
 *
 * No new delivery mechanism, no second inbox: these are ordinary Notification
 * rows, so the gate-pass notification endpoints and the bell in the interface
 * pick them up unchanged. The only difference is the priority stamp, which
 * comes from the deterministic escalation decision rather than from a model.
 */
export async function notifyStaffOfEscalation({ complaint, escalation, building }) {
  try {
    const recipients = await User.find({
      $or: [
        { role: ROLES.ADMIN },
        { role: ROLES.WARDEN, ...(building?._id ? { hostel: building._id } : {}) },
        { role: ROLES.FACILITY_MANAGER }
      ]
    })
      .select("_id role")
      .lean();

    if (!recipients.length) return [];

    const title =
      escalation.priority === "CRITICAL"
        ? `CRITICAL · ${complaint.reference} — ${complaint.title}`
        : `${escalation.priority} · ${complaint.reference} — ${complaint.title}`;

    const body =
      `${complaint.location || building?.name || "Location not stated"}. ` +
      `${escalation.reasons[0]} ${escalation.action}.`;

    // Deduplicated on (kind, complaint, recipient) so a re-classification does
    // not alert the same person twice for the same complaint.
    const rows = await Promise.all(
      recipients.map(async (member) => {
        const existing = await Notification.findOne({
          kind: "COMPLAINT_ESCALATED",
          user: member._id,
          "meta.complaint": String(complaint._id)
        });
        if (existing) return existing;

        return Notification.create({
          kind: "COMPLAINT_ESCALATED",
          audience: member.role === ROLES.ADMIN ? "ADMIN" : "WARDEN",
          channel: "IN_APP",
          user: member._id,
          title,
          body,
          tone: "high",
          priority: escalation.priority,
          // A safety rule is not an AI decision and is labelled as such.
          prioritySource: escalation.rule === "SAFETY_RULE" ? "SAFETY_RULE" : "RULE_BASED",
          priorityReason: escalation.reasons.join(" "),
          meta: { complaint: String(complaint._id), reference: complaint.reference }
        });
      })
    );

    return rows;
  } catch (error) {
    // An alert that cannot be written must never fail the complaint that
    // triggered it. The complaint is stored either way and remains visible on
    // every staff dashboard.
    console.error("escalationNotifier: could not raise escalation alerts —", error.message);
    return [];
  }
}

/**
 * Tells a complaint's author it was resolved, through the same notification
 * rows everything else uses. One per complaint; never fails the resolution.
 */
export async function notifyStudentOfResolution({ complaint, note }) {
  try {
    const existing = await Notification.findOne({
      kind: "COMPLAINT_RESOLVED",
      user: complaint.student,
      "meta.complaint": String(complaint._id)
    });
    if (existing) return existing;

    const title = `Resolved · ${complaint.reference} — ${complaint.title}`;
    const body = `${note ? `${note} ` : ""}Rate how it was handled from your dashboard.`.slice(0, 600);
    // Graded on its kind alone. The complaint's own wording ("sparks", "fire")
    // described the hazard that has now been closed; scanning it again would
    // mark a routine "resolved" notice CRITICAL.
    const graded = classifyNotification({ kind: "COMPLAINT_RESOLVED" });

    return await Notification.create({
      kind: "COMPLAINT_RESOLVED",
      audience: "STUDENT",
      channel: "IN_APP",
      user: complaint.student,
      title: title.slice(0, 160),
      body,
      tone: "low",
      priority: graded.priority,
      prioritySource: graded.prioritySource,
      priorityReason: graded.priorityReason,
      meta: { complaint: String(complaint._id), reference: complaint.reference }
    });
  } catch (error) {
    console.error("escalationNotifier: could not notify the student of a resolution —", error.message);
    return null;
  }
}
