import express from 'express';
import { getDashboard } from '../controllers/dashboardController.js';
import authenticate from '../middlewares/authMiddleware.js';

// Create an Express router instance for dashboard-related endpoints
const router = express.Router();

/**
 * Route: GET /api/dashboard
 * Access: Authenticated Workspace Members & Admins
 */
// Define the GET route, applying the authentication middleware first, then the dashboard controller
router.get('/', authenticate, getDashboard);

// Export the router to be mounted in the main server file
export default router;