/**
 * @file userService.js
 * @description Core business logic for user management and retrieval.
 * Part of Task T12 (List team members) 
 */

// Import database pool from the configured database connection module
import db from '../config/db.js';


import AppError from '../utils/appError.js';


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


/**
 * Task T13: Get a user (or yourself)
 * 
 * Fetches user profile by 'me' or public_id.
 * Includes user skills, and optionally permissions and sessions.
 * 
 * Security Rules:
 * - Email is returned ONLY to the owner or users with 'user:manage' permission.
 * - 'permissions' and 'sessions' are returned ONLY to the owner or 'user:manage' holders.
 * 
 * @param {Object} options
 * @param {string} options.targetId - The requested identifier ('me' or user public_id UUID)
 * @param {string} [options.include] - Comma-separated relationships ('permissions,sessions')
 * @param {Object} options.currentUser - The authenticated user object from req.user
 * @param {string} [options.clientIp] - Client IP address for determining active session
 * @param {string} [options.clientUserAgent] - Client User Agent for determining active session
 * @returns {Promise<Object>} Formatted user profile
 */
export const getUserById = async ({
  targetId,
  include = '',
  currentUser,
  clientIp,
  clientUserAgent
}) => {
  // Determine if the caller is requesting their own profile
  const isSelf = targetId === 'me' || targetId === currentUser.public_id;

  // Determine if caller has administrative privileges
  const isAdmin = Array.isArray(currentUser.permissions) && currentUser.permissions.includes('user:manage');

  // Authorization check: Only the account owner or admins can see sensitive fields
  const canAccessSensitiveData = isSelf || isAdmin;

  // 1. Fetch user base record
  let userSql = `
    SELECT 
      id,
      public_id,
      username,
      first_name,
      last_name,
      email,
      status,
      job_title,
      bio,
      current_focus,
      avatar_url,
      social_links,
      last_active_at
    FROM users
  `;

  const userParams = [];

  if (targetId === 'me') {
    // Lookup by internal database ID from authenticated user token
    userSql += ` WHERE id = ? LIMIT 1`;
    userParams.push(currentUser.id || currentUser.uid);
  } else {
    // Lookup by public UUID
    userSql += ` WHERE public_id = ? LIMIT 1`;
    userParams.push(targetId);
  }

  const [userRows] = await pool.query(userSql, userParams);

  if (userRows.length === 0) {
    throw new AppError('User not found', 404, 'NOT_FOUND');
  }

  const user = userRows[0];

  // 2. Fetch user skills from user_skills table
  const [skillRows] = await pool.query(
    `SELECT skill FROM user_skills WHERE user_id = ? ORDER BY skill ASC`,
    [user.id]
  );
  const skills = skillRows.map((r) => r.skill);

  // 3. Parse social_links safely (stored as JSON or string)
  let parsedSocialLinks = { github: '', linkedin: '', x: '' };
  if (user.social_links) {
    try {
      parsedSocialLinks = typeof user.social_links === 'string'
        ? JSON.parse(user.social_links)
        : user.social_links;
    } catch {
      parsedSocialLinks = { github: '', linkedin: '', x: '' };
    }
  }

  // 4. Construct initial response payload adhering to API schema
  const responseData = {
    public_id: user.public_id,
    username: user.username,
    first_name: user.first_name,
    last_name: user.last_name,
    avatar_url: user.avatar_url,
    // Email Privacy Rule: Hidden (null) if requester is neither owner nor admin
    email: canAccessSensitiveData ? user.email : null,
    status: user.status,
    job_title: user.job_title,
    bio: user.bio,
    current_focus: user.current_focus,
    skills,
    social_links: parsedSocialLinks,
    presence: computePresence(user.last_active_at)
  };

  // 5. Handle optional inclusions ('permissions', 'sessions')
  const includes = include
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  // Inclusion of permissions
  if (includes.includes('permissions') && canAccessSensitiveData) {
    const [permRows] = await pool.query(
      `SELECT 
        p.module,
        p.slug,
        p.description
       FROM permissions p
       INNER JOIN user_permissions up ON up.permission_id = p.id
       WHERE up.user_id = ?
       ORDER BY p.module, p.slug`,
      [user.id]
    );

    responseData.permissions = permRows.map((p) => ({
      module: p.module,
      slug: p.slug,
      description: p.description,
      granted: true
    }));
  }

  // Inclusion of active sessions
  if (includes.includes('sessions') && canAccessSensitiveData) {
    const [sessionRows] = await pool.query(
      `SELECT 
        id,
        ip_address,
        user_agent,
        last_used_at,
        created_at
       FROM sessions
       WHERE user_id = ? AND is_revoked = FALSE
       ORDER BY last_used_at DESC, created_at DESC`,
      [user.id]
    );

    // Determine current active session based on IP/UserAgent match or most recent activity
    responseData.sessions = sessionRows.map((session, index) => {
      const isIpMatch = clientIp && session.ip_address === clientIp;
      const isUaMatch = clientUserAgent && session.user_agent === clientUserAgent;
      const isCurrent = isSelf && (index === 0 || (isIpMatch && isUaMatch));

      return {
        id: session.id,
        ip_address: session.ip_address,
        user_agent: session.user_agent,
        last_used_at: session.last_used_at ? new Date(session.last_used_at).toISOString() : null,
        is_current: Boolean(isCurrent)
      };
    });
  }

  return responseData;
};


/**
 * Task T14: Update your profile
 * 
 * Updates the authenticated user's profile details.
 * 
 * Strict Business Rules:
 * - Email is strictly IMMUTABLE (cannot be modified via profile update).
 * - Bio length must not exceed 500 characters (returns 422 if exceeded).
 * - Partial update: updates only fields explicitly supplied in the payload.
 * - Skills array replaces the existing set completely.
 * 
 * @param {Object} options
 * @param {number|string} options.userId - Internal user ID of the caller (from req.user)
 * @param {Object} options.updateData - Fields submitted for modification
 * @returns {Promise<Object>} Updated user profile object matching API documentation schema
 */
export const updateUserProfile = async ({ userId, updateData }) => {
  const {
    first_name,
    last_name,
    job_title,
    bio,
    current_focus,
    social_links,
    avatar_url,
    skills
  } = updateData;

  // Validation Rule: bio max 500 characters
  if (bio && bio.length > 500) {
    throw new AppError('Bio cannot exceed 500 characters', 422, 'VALIDATION_ERROR', [
      { field: 'bio', message: 'Bio must be at most 500 characters long' }
    ]);
  }

  const updates = [];
  const params = [];

  // Dynamically accumulate fields to update (Notice: email is strictly omitted)
  if (first_name !== undefined) {
    updates.push('first_name = ?');
    params.push(first_name ? first_name.trim() : null);
  }
  if (last_name !== undefined) {
    updates.push('last_name = ?');
    params.push(last_name ? last_name.trim() : null);
  }
  if (job_title !== undefined) {
    updates.push('job_title = ?');
    params.push(job_title ? job_title.trim() : null);
  }
  if (bio !== undefined) {
    updates.push('bio = ?');
    params.push(bio ? bio.trim() : null);
  }
  if (current_focus !== undefined) {
    updates.push('current_focus = ?');
    params.push(current_focus ? current_focus.trim() : null);
  }
  if (avatar_url !== undefined) {
    updates.push('avatar_url = ?');
    params.push(avatar_url ? avatar_url.trim() : null);
  }
  if (social_links !== undefined) {
    updates.push('social_links = ?');
    // Ensure social_links is safely saved as a JSON string
    params.push(typeof social_links === 'object' ? JSON.stringify(social_links) : social_links);
  }

  // Use a transaction connection to handle users and user_skills atomically
  const connection = await pool.getConnection();
  let committed = false;

  try {
    await connection.beginTransaction();

    // 1. Update users table if any user field has changed
    if (updates.length > 0) {
      const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
      params.push(userId);
      await connection.query(sql, params);
    }

    // 2. Full replacement strategy for skills array if provided
    if (Array.isArray(skills)) {
      // Remove previous skills for this user
      await connection.query(`DELETE FROM user_skills WHERE user_id = ?`, [userId]);

      // Filter and insert distinct valid skills
      const sanitizedSkills = skills
        .map((s) => String(s).trim())
        .filter(Boolean);

      if (sanitizedSkills.length > 0) {
        const skillValues = sanitizedSkills.map((skill) => [userId, skill]);
        await connection.query(
          `INSERT INTO user_skills (user_id, skill) VALUES ?`,
          [skillValues]
        );
      }
    }

    await connection.commit();
    committed = true;
  } catch (error) {
    if (!committed) {
      await connection.rollback();
    }
    throw error;
  } finally {
    connection.release();
  }

  // 3. Return the freshly updated profile using our existing getUserById service
  return getUserById({
    targetId: 'me',
    currentUser: { id: userId },
    clientIp: null,
    clientUserAgent: null
  });
};

export default {
  getUsers
};