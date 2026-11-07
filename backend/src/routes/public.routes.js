import { Router } from "express";
import rateLimit from "express-rate-limit";
import { getPublicWorkspace } from "../controllers/public.controller.js";
import AppError from "../utils/appError.js";

const router = Router();

// ===========================================================================
// Rate Limiter: Protects landing page from scraping and DoS attacks
// Policy: Max 100 requests per 15 minutes per IP address
// ===========================================================================
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: "draft-7", // Return standard RateLimit-* headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
  handler: (req, res, next) => {
    // Matches the official API documented error shape: 429 RATE_LIMITED
    next(
      new AppError(
        "Too many requests from this IP. Please try again after 15 minutes.",
        429,
        "RATE_LIMITED",
      ),
    );
  },
});

// ===========================================================================
// T25: Public Workspace Route (Open to unauthenticated guests)
// ===========================================================================
router.get("/", publicLimiter, getPublicWorkspace);

export default router;
