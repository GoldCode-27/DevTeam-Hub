import express from 'express';
import authRoutes from './authRouts.js'; // Import the auth routes
import dashboardRoutes from './dashboardRoutes.js';
import activityRoutes from './activityRoutes.js';
import installRoutes from './install.routes.js'; // Import the install routes
import userRoutes from './userRoutes.js'; // Import the user and admin routes
import adminRoutes from './adminRoutes.js';

import resourceRoutes from "./resource.routes.js";
import publicRoutes from "./public.routes.js";
import fileRoutes from "./file.routes.js";
import testUploadRoutes from "./testUpload.routes.js";

// Create a main router instance to aggregate all modular API routes
const router = express.Router();

/**
 * Developer 1 API Module Routes
 */
// Mount dashboard routes under the '/dashboard' prefix (results in /api/dashboard)
router.use('/dashboard', dashboardRoutes);

// Mount activity routes under the '/activities' prefix (results in /api/activities)
router.use('/activities', activityRoutes);

// Mount install routes under the '/install' prefix (results in /api/install)
router.use('/install', installRoutes); // Mount install routes

// Mount auth routes under the '/auth' prefix (results in /api/auth)
router.use('/auth', authRoutes); // Mount auth routes

/**
 * Developer 3 API Module Routes
 */
// Mount user and admin routes under the '/users' prefix (results in /api/users)
router.use('/users', userRoutes); // Mount user routes


/**
 * Developer 3: Admin Control Center API Module Routes
 * 
 * Mounts administrative control endpoints under the '/admin' sub-path (results in /api/admin/...).
 * Covers user onboarding, member suspension, permission toggles, and visibility matrix.
 * Strictly guarded by authentication and 'user:manage' permission middleware.
 */
router.use('/admin', adminRoutes); // Mount admin routes

// Mount resource routes under the '/resources' prefix (results in /api/resources)

router.use("/resources", resourceRoutes);
// Mount public and file routes under their respective prefixes
router.use("/public", publicRoutes);
// Mount file routes under the '/files' prefix (results in /api/files)
router.use("/files", fileRoutes);
router.use("/", testUploadRoutes);
// Export the master router to be mounted into the main server application

export default router;


/*git commit -m "feat(utils): add shared pagination and activity notification helpers"
git push origin feature/dev1-foundation-dashboard */