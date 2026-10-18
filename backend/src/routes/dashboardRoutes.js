import express from 'express';
import { getDashboard } from '../controllers/dashboardController.js';
import authenticate from '../middlewares/authMiddleware.js';

const router = express.Router();

/**
 * Route: GET /api/dashboard
 * Access: Authenticated Workspace Members & Admins
 */
router.get('/', authenticate, getDashboard);

export default router;