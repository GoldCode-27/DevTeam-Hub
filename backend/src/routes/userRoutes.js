/**
 * @file userRoutes.js
 * @description Route declarations for users and profile endpoints.
 */

import express from 'express';
import { listUsers, getUserProfile, updateMyProfile  } from '../controllers/userController.js';

// Dev 2's authentication middleware 
import { authenticate } from '../middlewares/authMiddleware.js';


const router = express.Router();

/**
 * @route   GET /api/users
 * @desc    List team members (Task T12)
 * @access  Protected (Requires Bearer token)
 */
router.get('/', authenticate, listUsers);

/**
 * @route   GET /api/users/:id
 * @desc    Get user details or self profile (Task T13)
 * @access  Protected (Supports ?include=permissions,sessions)
 */
router.get('/:id', authenticate, getUserProfile);

/**
 * @route   PATCH /api/users/me
 * @desc    Update your profile (Task T14)
 * @access  Protected (Requires Bearer token)
 */
router.patch('/me', authenticate, updateMyProfile);

export default router;