import { Router } from "express";
import { authenticate, authorize } from "../../middleware/auth.js";
import { lite, noStore } from "../../middleware/bandwidth.js";
import * as c from "../../controllers/ext/feeController.js";

const router = Router();
router.use(authenticate, noStore);
router.get("/me", lite, c.mine);
router.get("/summary", authorize("ADMIN"), lite, c.summary);
router.post("/reminders", authorize("ADMIN"), c.reminders);
export default router;
