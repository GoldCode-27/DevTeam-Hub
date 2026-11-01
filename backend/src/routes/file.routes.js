import { Router } from "express";
import { serveSignedFile } from "../controllers/file.controller.js";

const router = Router();

// Guest route: access is authorized by the HMAC signed token!
router.get("/:token", serveSignedFile);

export default router;
