import { Router } from "express";
import {
  authenticate,
  requirePermission,
} from "../middlewares/authMiddleware.js";
import { uploadResourceFile } from "../middlewares/uploadMiddleware.js";
import * as ctrl from "../controllers/resource.controller.js";

const router = Router();

// Protect all resource routes with JWT auth
router.use(authenticate);

// T20: List resources
router.get("/", ctrl.listResources);

// T21: Add a resource
router.post(
  "/",
  requirePermission("resource:create"),
  uploadResourceFile.single("file"),
  ctrl.createResource,
);

// T22: Update a resource
router.patch(
  "/:id",
  requirePermission("resource:update"),
  uploadResourceFile.single("file"),
  ctrl.updateResource,
);

// T23: Delete a resource
router.delete(
  "/:id",
  requirePermission("resource:delete"),
  ctrl.deleteResource,
);

// T24: Download a resource (Active now!)
router.get("/:id/download", ctrl.downloadResource);

export default router;
