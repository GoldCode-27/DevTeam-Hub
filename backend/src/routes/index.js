import express from 'express';
import authRoutes from './authRoutes.js';
import dashboardRoutes from './dashboardRoutes.js';
import activityRoutes from './activityRoutes.js';

const router = express.Router();

/**
 * Developer 1 API Module Routes
 */
router.use('/dashboard', dashboardRoutes);
router.use('/activities', activityRoutes);

//developer 2: Authentication Module
router.use('/auth', authRoutes);
export default router;