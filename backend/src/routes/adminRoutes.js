import express from 'express';
import { onboardUser, updateMemberByAdmin  } from '../controllers/userController.js';
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


export default router;