import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const targetFolder = path.join(
      process.env.UPLOAD_DIR || "uploads",
      "resources",
      `${year}`,
      `${month}`,
    );

    if (!fs.existsSync(targetFolder)) {
      fs.mkdirSync(targetFolder, { recursive: true });
    }
    cb(null, targetFolder);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueId = crypto.randomUUID();
    cb(null, `${uniqueId}${ext}`);
  },
});

export const uploadResourceFile = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    cb(null, true); // Accepts all file types as per Dev 4 spec
  },
});
