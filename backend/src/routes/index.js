import express from 'express';
import dashboardRoutes from './dashboardRoutes.js';
import activityRoutes from './activityRoutes.js';

const router = express.Router();

/**
 * Developer 1 API Module Routes
 */
router.use('/dashboard', dashboardRoutes);
router.use('/activities', activityRoutes);

export default router;