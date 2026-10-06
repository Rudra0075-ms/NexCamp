import { Router } from "express";
import {
  listResources,
  getResource,
  createResource,
  updateResource,
  deleteResource,
  trackDownload
} from "../controllers/resourceController.js";
import { authenticate } from "../middleware/auth.js";
import { ApiError } from "../utils/ApiError.js";

const router = Router();

router.use(authenticate);

// Strict Warden access block: Wardens have no access to the Campus Resource Sharing & Help Hub
router.use((req, _res, next) => {
  if (req.user?.role === "WARDEN") {
    return next(
      ApiError.forbidden("Access denied: Hostel Wardens do not have access to Campus Resource Sharing & Help Hub.")
    );
  }
  next();
});

router.get("/", listResources);
router.post("/", createResource);
router.get("/:id", getResource);
router.patch("/:id", updateResource);
router.delete("/:id", deleteResource);
router.post("/:id/download", trackDownload);

export default router;
