import { Router } from "express";
import rateLimit from "express-rate-limit";
import { getPublicWorkspace } from "../controllers/public.controller.js";

const router = Router();

// Rate limiter: 100 requests per 15 minutes per IP
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

// No authentication: accessible to all guests
router.get("/", publicLimiter, getPublicWorkspace);

export default router;
