import { Router } from "express";
import { uploadResourceFile } from "../middlewares/uploadMiddleware.js";
import { getFileType } from "../utils/storage.js";
import path from "path";

const router = Router();

router.post("/test-upload", uploadResourceFile.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file sent" });
  res.json({
    message: "Storage service works!",
    saved_path: req.file.path,
    detected_type: getFileType(path.extname(req.file.originalname)),
    size_bytes: req.file.size,
  });
});

export default router;
