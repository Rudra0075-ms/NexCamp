import { ClassChange } from "../../models/ext/ClassChange.js";
import { MenuChange } from "../../models/ext/MenuChange.js";
import { ChangeEvent } from "../../models/xo/ChangeEvent.js";
import { planShutdown, propagateClassChange, propagateMenuChange } from "../../services/xo/changeService.js";

/**
 * Change propagation (Phase 6). Re-propagates every class and menu change on
 * record (so the effects are always consistent with the data), and plans two
 * shutdowns: Hostel C electricity now (complaints in that window link to it)
 * and Hostel A water in two days. Idempotent: it clears ChangeEvent first.
 */
export async function seedChanges({ admin, facility }) {
  await ChangeEvent.deleteMany({});
  const classes = await ClassChange.find().sort({ createdAt: 1 }).lean();
  for (const c of classes) await propagateClassChange(c._id, admin);
  const menus = await MenuChange.find().sort({ createdAt: 1 }).lean();
  for (const m of menus) await propagateMenuChange(m._id, admin);
  const now = Date.now();
  await planShutdown(facility || admin, { buildingCode: "HST-C", utility: "ELECTRICITY", from: new Date(now - 3600000), to: new Date(now + 3 * 3600000), reason: "Transformer maintenance by the electricity board" });
  await planShutdown(facility || admin, { buildingCode: "HST-A", utility: "WATER", from: new Date(now + 2 * 864e5), to: new Date(now + 2 * 864e5 + 3 * 3600000), reason: "Overhead tank cleaning" });
  return { classChanges: classes.length, menuChanges: menus.length, shutdowns: 2 };
}
