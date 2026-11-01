import path from "path";
import fs from "fs";
import { verifySignedToken } from "../utils/storage.js";
import AppError from "../utils/appError.js";

export const serveSignedFile = (req, res, next) => {
  try {
    const { token } = req.params;
    const fileData = verifySignedToken(token);

    if (!fileData) {
      throw new AppError(
        "Download link is invalid or has expired",
        403,
        "FORBIDDEN",
      );
    }

    const fullPath = path.isAbsolute(fileData.path)
      ? fileData.path
      : path.join(process.cwd(), fileData.path);

    if (!fs.existsSync(fullPath)) {
      throw new AppError("Requested file no longer exists", 404, "NOT_FOUND");
    }

    // Security: nosniff prevents execution of scripts inside HTML/SVG files
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.download(fullPath, fileData.name || path.basename(fullPath));
  } catch (err) {
    next(err);
  }
};
