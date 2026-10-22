// Import the dashboard data aggregation function from the dashboard service file
import { getDashboardSummary } from '../services/dashboardService.js';

/**
 * Dashboard Controller
 * Receives the authenticated request and responds with aggregated dashboard data.
 */

// Export an asynchronous function named getDashboard to handle incoming dashboard HTTP requests
export const getDashboard = async (req, res, next) => {
  
  // Wrap the logic in a try-catch block to prevent the server from crashing if an error occurs
  try {
    
    // Pass the authenticated user context (req.user) to the service layer to fetch personalized dashboard data
    const data = await getDashboardSummary(req.user);
    
    // Send a successful HTTP 200 OK response along with the aggregated dashboard JSON data to the client
    res.status(200).json(data);
    
  } catch (error) {
    
    // Catch any errors and forward them to the global error-handling middleware using the next function
    next(error);
    
  }
};