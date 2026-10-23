import express from 'express';
import {
  registerHandler,
  loginHandler,
  logoutHandler,
  // meHandler,
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
 * POST /api/auth/login       
 * POST /api/auth/refresh    
 * POST /api/auth/logout     
 * //router.get('/me', authenticate, meHandler);
       
 */

// 1. authenticate 
// 2. requirePermission('user:manage') 

router.post('/register', authenticate, requirePermission('user:manage'), registerHandler);
router.post('/login', loginRateLimiter, loginHandler);
router.post('/refresh', refreshRateLimiter, refreshHandler);
router.post('/logout', authenticate, logoutHandler);
//router.get('/me', authenticate, meHandler);

export default router;