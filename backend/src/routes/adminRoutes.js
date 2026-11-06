import express from 'express';
import { onboardUser, updateMemberByAdmin,getVisibility, updateVisibilityBulk  } from '../controllers/userController.js';
import { authenticate, requirePermission } from '../middlewares/authMiddleware.js';

const router = express.Router();

// Enforce authentication and admin privileges across all admin endpoints
router.use(authenticate);
router.use(requirePermission('user:manage'));

/**
 * @route   POST /api/admin/users
 * @desc    Create a team member with temporary password (Task T15)
 * @access  Admin Only (user:manage)
 */
router.post('/users', onboardUser);

/**
 * @route   PATCH /api/admin/users/:id
 * @desc    Update a member status (suspend/reactivate) and permissions (Task T16)
 * @access  Admin Only (user:manage)
 */
router.patch('/users/:id', updateMemberByAdmin);

/**
 * @route   GET /api/admin/visibility
 * @desc    Get visibility matrix with pagination (Task T17)
 * @access  Admin Only (user:manage)
 */
router.get('/visibility', getVisibility);

/**
 * @route   PATCH /api/admin/visibility
 * @desc    Bulk update visibility for tasks or resources (Task T18)
 * @access  Admin Only (user:manage)
 */
router.patch('/visibility', updateVisibilityBulk);

export default router;