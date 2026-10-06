/**
 * Silent Support System — institution-configured contacts and switches.
 *
 * No phone number is invented or hard-coded. Contacts come from the
 * environment (see backend/.env.example); when none are configured the
 * interface says so and gives generic guidance instead of a made-up number.
 *
 *   SUPPORT_EMERGENCY_CONTACTS  crisis / immediate-danger contacts
 *   SUPPORT_HELP_RESOURCES      everyday help (counselling centre, helpdesk hours)
 *
 * Format: entries separated by ";", each "Label|contact|note" (note optional), e.g.
 *   SUPPORT_EMERGENCY_CONTACTS="Campus Security (24x7)|+91-XXXXXXXXXX;Medical Centre|Ext. 2211|Ground floor"
 * A JSON array of { label, contact, note } is accepted too.
 */

function parse(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];
  if (text.startsWith("[")) {
    try {
      return JSON.parse(text)
        .filter((row) => row && row.label && row.contact)
        .slice(0, 8)
        .map((row) => ({ label: String(row.label).slice(0, 80), contact: String(row.contact).slice(0, 80), note: row.note ? String(row.note).slice(0, 120) : null }));
    } catch {
      return [];
    }
  }
  return text
    .split(";")
    .map((entry) => entry.split("|").map((part) => part.trim()))
    .filter(([label, contact]) => label && contact)
    .slice(0, 8)
    .map(([label, contact, note]) => ({ label: label.slice(0, 80), contact: contact.slice(0, 80), note: note ? note.slice(0, 120) : null }));
}

export function supportResources() {
  const emergency = parse(process.env.SUPPORT_EMERGENCY_CONTACTS);
  const help = parse(process.env.SUPPORT_HELP_RESOURCES);
  return {
    emergency,
    help,
    configured: emergency.length > 0,
    guidance: emergency.length
      ? "If you are in immediate danger, contact one of these now, or your local emergency services."
      : "Your institution has not added its emergency contacts here yet. If you are in immediate danger, call your local emergency services or go to the nearest hospital, and tell your warden or any staff member you trust right now.",
    note: "These contacts are set by your institution."
  };
}

/** Whether an explicit "I don't feel safe" automatically alerts the support team. Default on. */
export function autoEscalateImmediate() {
  return String(process.env.SUPPORT_AUTO_ESCALATE_IMMEDIATE ?? "true").toLowerCase() !== "false";
}

/** Below this many, the admin overview shows "fewer than N" instead of a count. */
export function minCellSize() {
  const n = Math.trunc(Number(process.env.SUPPORT_MIN_CELL_SIZE || 3));
  return n >= 1 && n <= 20 ? n : 3;
}
