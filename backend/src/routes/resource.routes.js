import { Router } from "express";
import { authenticate,requirePermission,} from "../middlewares/authMiddleware.js";
import {uploadResourceFile, handleUploadError,} from "../middlewares/uploadMiddleware.js";
import * as ctrl from "../controllers/resource.controller.js";

const router = Router();

// ===========================================================================
// All resource management routes strictly require authentication(ሁሉም የሪሶርስ ስራዎች ሎጊን መደረግ አለባቸው) 
// ===========================================================================
router.use(authenticate);

// T20: List resources (with search, tag filter, visibility, pagination)
router.get("/", ctrl.listResources);

// T21: Add a resource (File or link; auto-creates tags)
router.post(
  "/",
  requirePermission("resource:create"),
  uploadResourceFile.single("file"),
  handleUploadError, // Intercepts 10MB file limit errors cleanly
  ctrl.createResource,
);

// T22: Update a resource (Fields, tags, file, and is_public toggle)
router.patch(
  "/:id",
  requirePermission(["resource:update", "resource:toggle_visibility"], falseእ),
  uploadResourceFile.single("file"),
  handleUploadError, // Intercepts 10MB file limit errors cleanly
  ctrl.updateResource,
);

// T23: Delete a resource (Removes physical file and DB record; tags cascade)
router.delete(
  "/:id",
  requirePermission("resource:delete"),
  ctrl.deleteResource,
);

// T24: Download a resource (Increments download_count, redirects 302 to signed URL)
router.get("/:id/download", ctrl.downloadResource);

export default router;
