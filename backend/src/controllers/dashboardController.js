import { getDashboardSummary } from '../services/dashboardService.js';

/**
 * Dashboard Controller
 * Receives the authenticated request and responds with aggregated dashboard data.
 */
export const getDashboard = async (req, res, next) => {
  try {
    const data = await getDashboardSummary(req.user);
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};