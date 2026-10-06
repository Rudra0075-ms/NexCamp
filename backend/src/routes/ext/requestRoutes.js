import { Router } from "express";
import { authenticate, authorizeStaff } from "../../middleware/auth.js";
import { lite, noStore } from "../../middleware/bandwidth.js";
import { validate } from "../../middleware/validate.js";
import * as c from "../../controllers/ext/requestController.js";
import { pendingQuerySchema } from "./validators.js";

const router = Router();
router.use(authenticate, noStore);
router.get("/mine", lite, c.mine);
router.get("/pending", authorizeStaff, lite, validate(pendingQuerySchema, "query"), c.pending);
export default router;
