import express from 'express';
import { getActivities } from '../controllers/activityController.js';
import authenticate from '../middlewares/authMiddleware.js';

// Create an Express router instance for activity-related endpoints
const router = express.Router();

/**
 * Route: GET /api/activities
 * Query parameters: scope (me|all), range (7d|30d), type
 * Access: Authenticated workspace members
 */
// Define the GET route, applying the authentication middleware first, then the activity controller
router.get('/', authenticate, getActivities);

// Export the router to be mounted in the main server file
export default router;