import express from 'express';
import dashboardRoutes from './dashboardRoutes.js';
import activityRoutes from './activityRoutes.js';

// Create a main router instance to aggregate all modular API routes
const router = express.Router();

/**
 * Developer 1 API Module Routes
 */
// Mount dashboard routes under the '/dashboard' prefix (results in /api/dashboard)
router.use('/dashboard', dashboardRoutes);

// Mount activity routes under the '/activities' prefix (results in /api/activities)
router.use('/activities', activityRoutes);

// Export the master router to be mounted into the main server application
export default router;





/*git commit -m "feat(utils): add shared pagination and activity notification helpers"
git push origin feature/dev1-foundation-dashboard */