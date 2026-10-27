/**
 * @file userRoutes.js
 * @description Route declarations for users and profile endpoints.
 */

import express from 'express';
import { listUsers } from '../controllers/userController.js';

// Dev 2's authentication middleware 
import { authenticate } from '../middlewares/authMiddleware.js';

const router = express.Router();

/**
 * @route   GET /api/users
 * @desc    List team members (Task T12)
 * @access  Protected (Requires Bearer token)
 */
router.get('/', authenticate, listUsers);

export default router;