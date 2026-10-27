/**
 * @file userController.js
 * @description Request handler for user management routes.
 */

// Import user service using ES module syntax
import { getUsers } from '../services/userService.js';

/**
 * Handles GET /api/users request to list team members.
 * 
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @param {import('express').NextFunction} next - Express next middleware function
 */
export const listUsers = async (req, res, next) => {
  try {
     console.log('--- DEBUG req.user CONTENT ---');
    console.log(JSON.stringify(req.user, null, 2));
    console.log('------------------------------');
    const { q, presence, status, page, per_page } = req.query;

    // Permissions attached to req.user by authMiddleware
    const currentUserPermissions = req.user?.permissions || [];

    // Fetch team members via service layer
    const result = await getUsers({
      q,
      presence,
      status,
      page,
      per_page,
      currentUserPermissions
    });

    // Return exact response shape matching API documentation
    return res.status(200).json(result);
  } catch (error) {
    // Forward unexpected exceptions to global error handler
    next(error);
  }
};

export default {
  listUsers
};