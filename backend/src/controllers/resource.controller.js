import * as resourceService from "../services/resourceService.js";
import { generateSignedDownloadUrl } from "../utils/storage.js";
import AppError from "../utils/appError.js";

// ==========================================
// T20: List resources
// ==========================================
export const listResources = async (req, res, next) => {
  try {
    const data = await resourceService.listResources(req.query);
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
};

// ==========================================
// T21: Add a resource
// ==========================================
export const createResource = async (req, res, next) => {
  try {
    const data = await resourceService.createResource({
      ...req.body,
      file: req.file,
      user: req.user,
    });
    res.status(201).json(data);
  } catch (err) {
    next(err);
  }
};

// ==========================================
// T22: Update a resource
// ==========================================
export const updateResource = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check permission if toggling visibility
    if (req.body.is_public !== undefined) {
      const hasPerm =
        req.user?.permissions?.includes("resource:toggle_visibility") ||
        req.user?.permissions?.includes("user:manage");

      if (!hasPerm) {
        throw new AppError(
          "Forbidden: missing resource:toggle_visibility permission",
          403,
          "FORBIDDEN",
        );
      }
    }

    const data = await resourceService.updateResource(id, {
      ...req.body,
      file: req.file,
    });
    res.status(200).json(data);
  } catch (err) {
    next(err);
  }
};

// ==========================================
// T23: Delete a resource
// ==========================================
export const deleteResource = async (req, res, next) => {
  try {
    await resourceService.deleteResource(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

// ==========================================
// T24: Download a resource (302 redirect)
// ==========================================
export const downloadResource = async (req, res, next) => {
  try {
    const resource = await resourceService.getResourceForDownload(
      req.params.id,
    );

    // If it is an external link, redirect directly
    if (resource.file_type === "LINK") {
      return res.redirect(302, resource.file_url);
    }

    // Generate signed HMAC token link expiring in 120s
    const signedUrl = generateSignedDownloadUrl(
      resource.file_url,
      resource.title,
    );
    return res.redirect(302, signedUrl);
  } catch (err) {
    next(err);
  }
};
