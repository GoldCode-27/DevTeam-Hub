import express from 'express';
import {
  registerHandler,
  googleAuthHandler,
  loginHandler,
  logoutHandler,
  refreshHandler
} from '../controllers/authController.js';
import { authenticate, requirePermission } from '../middlewares/authMiddleware.js';
import {
  loginRateLimiter,
  refreshRateLimiter
} from '../middlewares/rateLimitMiddleware.js';

const router = express.Router();

/**
 * Developer 2: Authentication Module
 * Access JWT (Bearer) + rotating refresh token (httpOnly cookie)
 *
 * POST /api/auth/register
 * POST /api/auth/google
 * POST /api/auth/login
 * POST /api/auth/refresh
 * POST /api/auth/logout
 */

router.post(
  '/register',
  authenticate,
  requirePermission('user:manage'),
  registerHandler
);
router.post('/google', loginRateLimiter, googleAuthHandler);
router.post('/login', loginRateLimiter, loginHandler);
router.post('/refresh', refreshRateLimiter, refreshHandler);
router.post('/logout', authenticate, logoutHandler);

export default router;
