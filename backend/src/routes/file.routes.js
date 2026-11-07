import { Router } from "express";
import rateLimit from "express-rate-limit";
import { serveSignedFile } from "../controllers/file.controller.js";
import AppError from "../utils/appError.js";

const router = Router();

// ===========================================================================
// Rate Limiter: Protects download file endpoint from brute-force token guessing
// Policy: Max 60 downloads per 5 minutes per IP address
// ===========================================================================
const downloadLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 60, // Limit each IP to 60 downloads per windowMs
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (req, res, next) => {
    next(
      new AppError(
        "Too many download attempts from this IP. Please try again after 5 minutes.",
        429,
        "RATE_LIMITED",
      ),
    );
  },
});

// ===========================================================================
// T19/T24: Serve Signed File
// Access is authorized strictly by the HMAC-SHA256 cryptographic signed token.
// The regex pattern ensures only valid Base64URL payload.signature tokens are processed.
// ===========================================================================
router.get("/:token", downloadLimiter, serveSignedFile);

export default router;
