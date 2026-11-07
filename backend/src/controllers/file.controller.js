import fs from "node:fs";
import path from "node:path";
import { verifySignedToken, resolveUploadPath } from "../utils/storage.js";
import AppError from "../utils/appError.js";

// Express error handler wrapper (eliminates manual try/catch)
const wrap = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

/**
 * T19/T24: Serves the physical file using the HMAC signed token.
 * Unauthenticated: access is granted only by verifying the cryptographic signature.
 */
export const serveSignedFile = wrap(async (req, res) => {
  const { token } = req.params;

  // 1. Verify the cryptographic HMAC signature and check TTL expiry
  const fileData = verifySignedToken(token);
  if (!fileData) {
    throw new AppError(
      "Download link is invalid or has expired",
      403,
      "FORBIDDEN",
    );
  }

  // 2. Path Traversal Protection: verify the file is strictly inside UPLOAD_ROOT
  const fullPath = resolveUploadPath(fileData.path);
  if (!fullPath || !fs.existsSync(fullPath)) {
    throw new AppError("Requested file no longer exists", 404, "NOT_FOUND");
  }

  // 3. Security Hardening Headers:
  // - nosniff: prevents browsers from executing arbitrary scripts inside uploaded HTML/SVG files
  // - no-store: prevents intermediate proxies from caching sensitive binary files
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store, private");

  // 4. Send the file securely as an attachment
  const downloadName = fileData.name || path.basename(fullPath);
  res.download(fullPath, downloadName);
});
