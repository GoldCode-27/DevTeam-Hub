/**
 * @file userService.js
 * @description Core business logic for user management and retrieval.
 * Part of Task T12 (List team members) for Developer 3.
 */

// Import database pool from the configured database connection module
import db from '../config/db.js';

// Destructure the connection pool from the default export
const { pool } = db;

/**
 * Dynamically computes a user's presence state based on their last active timestamp.
 * 
 * Business Logic from API Docs:
 * - Active within the last 2 minutes  => "online"
 * - Active within the last 15 minutes => "away"
 * - Inactive for > 15 minutes or null => "offline"
 * 
 * @param {Date|string|null} lastActiveAt - Timestamp of user's latest interaction
 * @returns {('online'|'away'|'offline')} Calculated presence state
 */
const computePresence = (lastActiveAt) => {
  if (!lastActiveAt) return 'offline';

  const now = new Date();
  const lastActive = new Date(lastActiveAt);
  const diffInMinutes = (now - lastActive) / (1000 * 60);

  if (diffInMinutes <= 2) {
    return 'online';
  } else if (diffInMinutes <= 15) {
    return 'away';
  } else {
    return 'offline';
  }
};

/**
 * Retrieves a paginated list of team members with search and status filters.
 * 
 * Security Rule:
 * - Regular authenticated users can only view 'ACTIVE' accounts.
 * - Only users holding the 'user:manage' permission slug can view other statuses (e.g., 'SUSPENDED').
 * 
 * @param {Object} filters
 * @param {string} [filters.q] - Search query matching name, username, or email
 * @param {string} [filters.presence] - Filter by calculated presence (online/away/offline)
 * @param {string} [filters.status] - Account status (ACTIVE, SUSPENDED, etc.)
 * @param {number|string} [filters.page=1] - Requested page number
 * @param {number|string} [filters.per_page=20] - Number of items per page (maximum 100)
 * @param {Array<string>} [filters.currentUserPermissions=[]] - Permissions granted to the requester
 * @returns {Promise<{page: number, users: Array<Object>}>} Paginated team members list
 */
export const getUsers = async ({
  q,
  presence,
  status,
  page = 1,
  per_page = 20,
  currentUserPermissions = []
}) => {
  // Normalize pagination inputs
  const currentPage = Math.max(1, parseInt(page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(per_page, 10) || 20));
  const offset = (currentPage - 1) * limit;

  // Determine if the caller possesses administrative rights
  const isAdmin = Array.isArray(currentUserPermissions) && currentUserPermissions.includes('user:manage');

  const conditions = [];
  const params = [];

  // Security enforcement: Restrict non-admins to ACTIVE status
  if (!isAdmin) {
    conditions.push("u.status = 'ACTIVE'");
  } else if (status) {
    conditions.push("u.status = ?");
    params.push(status);
  }

  // Keyword search across first_name, last_name, username, and email
  if (q && q.trim() !== '') {
    conditions.push("(u.first_name LIKE ? OR u.last_name LIKE ? OR u.username LIKE ? OR u.email LIKE ?)");
    const searchTerm = `%${q.trim()}%`;
    params.push(searchTerm, searchTerm, searchTerm, searchTerm);
  }

  // Construct WHERE clause dynamically
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // SQL Query selecting only public/safe fields (password_hash is strictly omitted)
  const sql = `
    SELECT 
      u.public_id,
      u.username,
      u.first_name,
      u.last_name,
      u.avatar_url,
      u.job_title,
      u.current_focus,
      u.status,
      u.last_active_at
    FROM users u
    ${whereClause}
    ORDER BY u.created_at DESC
    LIMIT ? OFFSET ?
  `;

  // Append pagination parameters (converted to numbers for MySQL safety)
  params.push(Number(limit), Number(offset));

  // Execute query via connection pool
  const [rows] = await pool.query(sql, params);

  // Map database records to the contract specified in API documentation
  let users = rows.map((user) => ({
    public_id: user.public_id,
    username: user.username,
    first_name: user.first_name,
    last_name: user.last_name,
    avatar_url: user.avatar_url,
    job_title: user.job_title,
    current_focus: user.current_focus,
    presence: computePresence(user.last_active_at),
    last_active_at: user.last_active_at ? new Date(user.last_active_at).toISOString() : null
  }));

  // Apply presence filter in memory if requested
  if (presence) {
    users = users.filter((u) => u.presence.toLowerCase() === presence.toLowerCase());
  }

  return {
    page: currentPage,
    users
  };
};

export default {
  getUsers
};