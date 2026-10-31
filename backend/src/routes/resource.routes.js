import { Router } from "express";
import {
  authenticate,
  requirePermission,
} from "../middlewares/authMiddleware.js";
import { uploadResourceFile } from "../middlewares/uploadMiddleware.js";
import * as ctrl from "../controllers/resource.controller.js";

const router = Router();

// Protect all resource routes with Developer 2's JWT authentication
router.use(authenticate);

// T20: List resources (Any authenticated user)
router.get("/", ctrl.listResources);

// T21: Add a resource (Requires 'resource:create' permission)
router.post(
  "/",
  requirePermission("resource:create"),
  uploadResourceFile.single("file"),
  ctrl.createResource,
);

// T22: Update a resource (Requires 'resource:update' permission)
router.patch(
  "/:id",
  requirePermission("resource:update"),
  uploadResourceFile.single("file"),
  ctrl.updateResource,
);

// T23: Delete a resource (Requires 'resource:delete' permission)
router.delete(
  "/:id",
  requirePermission("resource:delete"),
  ctrl.deleteResource,
);

// T24: Download a resource (Any authenticated user)
router.get("/:id/download", ctrl.downloadResource);

export default router;
