import express from 'express';
import { getActivities } from '../controllers/activityController.js';
import authenticate from '../middlewares/authMiddleware.js';

const router = express.Router();

/**
 * Route: GET /api/activities
 * Query parameters: scope (me|all), range (7d|30d), type
 * Access: Authenticated workspace members
 */
router.get('/', authenticate, getActivities);

export default router;