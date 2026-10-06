import { Router } from "express";
import { authenticate, authorize, authorizeStaff } from "../../middleware/auth.js";
import { lite, noStore } from "../../middleware/bandwidth.js";
import { validate } from "../../middleware/validate.js";
import * as c from "../../controllers/ext/timetableController.js";
import { askSchema, classChangeSchema, dayQuerySchema, menuChangeSchema } from "./validators.js";

export const timetableRouter = Router();
timetableRouter.use(authenticate, noStore);
timetableRouter.get("/week", lite, c.myWeek);
timetableRouter.get("/day", validate(dayQuerySchema, "query"), c.dayAnswer);
timetableRouter.post("/ask", validate(askSchema), c.ask);
timetableRouter.get("/attendance-adjusted", lite, c.myAdjustedAttendance);
timetableRouter.get("/schedules", authorizeStaff, lite, c.schedules);
timetableRouter.get("/changes", authorizeStaff, lite, c.changes);
// There is no faculty role in this system (see HOOKS.md); the academic office
// (ADMIN) records class changes.
timetableRouter.post("/changes", authorize("ADMIN"), validate(classChangeSchema), c.createClassChange);

export const messMenuRouter = Router();
messMenuRouter.use(authenticate, noStore);
messMenuRouter.get("/", lite, c.menus);
messMenuRouter.get("/next", c.next);
messMenuRouter.post("/changes", authorize("ADMIN", "MESS_MANAGER"), validate(menuChangeSchema), c.createMenu);
