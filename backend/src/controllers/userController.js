/**
 * @file userController.js
 * @description Request handler for user management routes.
 */

// Import user service using ES module syntax
import { getUsers, getUserById, updateUserProfile, createTeamMember, updateMemberStatusAndPermissions, getVisibilityMatrix   } from '../services/userService.js';



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

/**
 * Handles GET /api/users/:id
 * Fetches user profile details for a given public_id or 'me' (Task T13).
 */
export const getUserProfile = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { include } = req.query;

    // Extract client metadata to evaluate is_current session state
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
    const clientUserAgent = req.headers['user-agent'];

    const userProfile = await getUserById({
      targetId: id,
      include,
      currentUser: req.user,
      clientIp,
      clientUserAgent
    });

    return res.status(200).json(userProfile);
  } catch (error) {
    next(error);
  }
};

/**
 * Handles PATCH /api/users/me
 * Updates current authenticated user's profile details (Task T14).
 */
export const updateMyProfile = async (req, res, next) => {
  try {
    const userId = req.user.id || req.user.uid;

    const updatedProfile = await updateUserProfile({
      userId,
      updateData: req.body
    });

    return res.status(200).json(updatedProfile);
  } catch (error) {
    next(error);
  }
};

/**
 * Handles POST /api/admin/users
 * Onboards a new team member and generates temporary credentials (Task T15).
 */
export const onboardUser = async (req, res, next) => {
  try {
    const { full_name, email, permissions } = req.body;
    const adminUserId = req.user.id || req.user.uid;

    const result = await createTeamMember({
      full_name,
      email,
      permissions,
      adminUserId
    });

    return res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * Handles PATCH /api/admin/users/:id
 * Updates target user status and replaces permission set (Task T16).
 */
export const updateMemberByAdmin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, permissions } = req.body;
    const adminUserId = req.user.id || req.user.uid;

    const result = await updateMemberStatusAndPermissions({
      targetPublicId: id,
      status,
      permissions,
      adminUserId
    });

    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

/**
 * Handles GET /api/admin/visibility
 * Returns visibility matrix for tasks or resources with pagination (Task T17).
 */
export const getVisibility = async (req, res, next) => {
  try {
    const { type, page, per_page } = req.query;

    const result = await getVisibilityMatrix({
      type,
      page,
      per_page
    });

    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};



export default {
  listUsers
};