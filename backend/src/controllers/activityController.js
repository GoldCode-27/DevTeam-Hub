import { getActivitiesData } from '../services/activityService.js';

/**
 * Activity Controller
 * Extracts authenticated user context and request query filters,
 * delegating aggregation to the service layer.
 */
export const getActivities = async (req, res, next) => {
  try {
    const data = await getActivitiesData(req.user, req.query);
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};