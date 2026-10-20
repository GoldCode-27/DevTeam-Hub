// Import the data aggregation function from the activity service file
import { getActivitiesData } from '../services/activityService.js';

/**
 * Activity Controller
 * Extracts authenticated user context and request query filters,
 * delegating aggregation to the service layer.
 */

// Export an asynchronous function named getActivities to handle the incoming HTTP request
export const getActivities = async (req, res, next) => {
  
  // Wrap the logic in a try-catch block to prevent the server from crashing if an error occurs
  try {
    
    // Pass the authenticated user details and URL query parameters to the service layer, then store the result
    const data = await getActivitiesData(req.user, req.query);
    
    // Send a successful HTTP 200 OK response along with the retrieved data in JSON format to the client
    res.status(200).json(data);
    
  } catch (error) {
    
    // Catch any errors and forward them to the global error-handling middleware using the next function
    next(error);
    
  }
};