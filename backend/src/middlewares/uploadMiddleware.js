import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import AppError from "../utils/appError.js";

// Ensure root upload directory matches storage.js
const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR ?? "uploads");

// Configure Disk Storage with Date-based subdirectories (e.g., uploads/resources/2026/10)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const targetFolder = path.join(
      UPLOAD_ROOT,
      "resources",
      `${year}`,
      `${month}`,
    );

    try {
      // recursive: true handles directory creation if it doesn't exist
      fs.mkdirSync(targetFolder, { recursive: true });
      cb(null, targetFolder);
    } catch (err) {
      cb(err, null);
    }
  },
  filename: (req, file, cb) => {
    // 1. Sanitize file extension (prevent null-bytes, whitespace, and dangerous chars)
    const rawExt = path.extname(file.originalname ?? "").toLowerCase();
    const cleanExt = rawExt.replace(/[^a-z0-9.]/g, "").slice(0, 10);

    // 2. Cryptographically secure random UUID for the stored filename
    const uniqueId = crypto.randomUUID();
    cb(null, `${uniqueId}${cleanExt}`);
  },
});

// 10 Megabytes limit
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;

export const uploadResourceFile = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE_BYTES,
    files: 1, // Only 1 file upload allowed per request
  },
  fileFilter: (req, file, cb) => {
    // Accepts all file types as per Dev 4 specification
    cb(null, true);
  },
});

/**
 * Clean Multer error handler middleware.
 * Translates multer-specific errors (like LIMIT_FILE_SIZE) into standard AppError (413 Payload Too Large).
 */
export const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return next(
        new AppError(
          "Uploaded file is too large. Maximum allowed size is 10MB.",
          413,
          "PAYLOAD_TOO_LARGE",
          [{ field: "file", message: "File exceeds 10MB limit" }],
        ),
      );
    }
    return next(new AppError(err.message, 400, "BAD_REQUEST"));
  }
  next(err);
};
