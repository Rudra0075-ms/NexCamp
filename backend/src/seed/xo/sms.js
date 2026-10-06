import { StaffPhone } from "../../models/xo/StaffPhone.js";
import { SmsOutbox } from "../../models/xo/SmsOutbox.js";
import { record } from "../../services/auditChainService.js";

/** Demo staff numbers for the SMS work loop (placeholder range, never a real handset). */
export const STAFF_PHONES = [
  { key: "facility", phone: "+919000009001", label: "Plumber", departments: ["MAINTENANCE · PLUMBING"] },
  { key: "warden", phone: "+919000009002", label: "Hostel B Warden", departments: [] }
];

export async function seedStaffPhones({ facility, warden, admin }) {
  const who = { facility, warden };
  await StaffPhone.deleteMany({});
  await SmsOutbox.deleteMany({});
  let n = 0;
  for (const p of STAFF_PHONES) {
    if (!who[p.key]) continue;
    const row = await StaffPhone.create({ staff: who[p.key]._id, phone: p.phone, label: p.label, departments: p.departments });
    await record({ entityType: "StaffPhone", entityId: row._id, entityRef: p.label, action: "STAFF_PHONE_REGISTERED", actor: admin, note: `${p.label} · ${p.departments.join(", ") || "all departments"}` });
    n += 1;
  }
  return n;
}
