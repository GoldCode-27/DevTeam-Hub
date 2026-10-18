import express from 'express';
import dashboardRoutes from './dashboardRoutes.js';

const router = express.Router();

/**
 * Mount Sub-routers
 */
// Developer 1: Dashboard Module
router.use('/dashboard', dashboardRoutes);

export default router;