import pool from '../config/db.js';
import AppError from '../utils/appError.js';

/**
 * Authentication & Identity Middleware
 * Resolves the authenticated user from the database and attaches direct permission slugs.
 * Falls back to Seed User 1 (Alex Chen - Lead/Admin) for local development if no header is present.
 */
const authenticate = async (req, res, next) => {
  try {
    // 1. Resolve user ID from request headers (supports local testing toggle via 'x-user-id')
    const userId = req.headers['x-user-id'] || 1;

    // 2. Fetch user identity from the database using the resolved ID
    const [users] = await pool.query(
      `SELECT id, public_id, username, first_name, last_name, email, status, last_active_at 
       FROM users 
       WHERE id = ?`,
      [userId]
    );

    // If the user does not exist or their account is suspended, throw an unauthenticated error
    if (!users.length || users[0].status !== 'ACTIVE') {
      return next(new AppError('User not found or account is suspended', 401, 'UNAUTHENTICATED'));
    }

    const user = users[0];

    // 3. Fetch direct user permissions by joining user_permissions and permissions tables
    const [permissions] = await pool.query(
      `SELECT p.slug 
       FROM permissions p
       INNER JOIN user_permissions up ON p.id = up.permission_id
       WHERE up.user_id = ?`,
      [user.id]
    );

    // 4. Attach permission slugs array to the user object (e.g., ['user:manage', 'task:create'])
    user.permissions = permissions.map(row => row.slug);
    req.user = user;

    // Proceed to the next middleware or controller
    next();
  } catch (error) {
    // Catch any unexpected database or runtime errors and pass them to the global error handler
    next(error);
  }
};

export default authenticate;