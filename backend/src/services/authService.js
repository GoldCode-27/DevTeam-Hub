import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/db.js';
import AppError from '../utils/appError.js';
import {
  generateRefreshToken,
  getClientMeta,
  getRefreshExpiryDate,
  hashRefreshToken,
  signAccessToken
} from '../utils/tokenUtils.js';

const USER_SAFE_COLUMNS = `
  id, public_id, username, email, first_name, last_name,
  job_title, status, bio, current_focus, avatar_url, last_active_at
`;

const findUserByLogin = async (login) => {
  const [rows] = await pool.query(
    `SELECT ${USER_SAFE_COLUMNS}, password_hash
     FROM users
     WHERE email = ? OR username = ?
     LIMIT 1`,
    [login, login]
  );
  return rows[0] || null;
};

const loadPermissions = async (userId) => {
  const [rows] = await pool.query(
    `SELECT p.slug
     FROM permissions p
     INNER JOIN user_permissions up ON p.id = up.permission_id
     WHERE up.user_id = ?`,
    [userId]
  );
  return rows.map((row) => row.slug);
};

const toPublicUser = (user, permissions = []) => ({
  public_id: user.public_id,
  username: user.username,
  email: user.email,
  first_name: user.first_name,
  last_name: user.last_name,
  job_title: user.job_title,
  status: user.status,
  bio: user.bio,
  current_focus: user.current_focus,
  avatar_url: user.avatar_url,
  last_active_at: user.last_active_at,
  permissions
});

const createSession = async (userId, req, connection = pool) => {
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const expiresAt = getRefreshExpiryDate();
  const { ipAddress, userAgent } = getClientMeta(req);

  await connection.query(
    `INSERT INTO sessions (user_id, refresh_token_hash, ip_address, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, refreshTokenHash, ipAddress, userAgent, expiresAt]
  );

  await connection.query(
    `UPDATE users SET last_active_at = NOW() WHERE id = ?`,
    [userId]
  );

  return { refreshToken, expiresAt };
};

const buildAuthPayload = async (user, refreshToken, expiresAt) => {
  const permissions = await loadPermissions(user.id);
  const accessToken = signAccessToken({
    sub: user.public_id,
    uid: user.id,
    username: user.username
  });

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: process.env.JWT_ACCESS_EXPIRES || '15m',
    refresh_token: refreshToken,
    refresh_expires_at: expiresAt.toISOString(),
    user: toPublicUser(user, permissions)
  };
};

export const register = async (userData, req) => {
  const {
    username,
    email,
    password,
    first_name,
    last_name,
    job_title,
    bio,
    skills = []
  } = userData;

  if (!username || !email || !password || !first_name || !last_name) {
    throw new AppError(
      'Missing required registration fields',
      400,
      'VALIDATION_ERROR',
      [
        ...(!username ? [{ field: 'username', message: 'Username is required' }] : []),
        ...(!email ? [{ field: 'email', message: 'Email is required' }] : []),
        ...(!password ? [{ field: 'password', message: 'Password is required' }] : []),
        ...(!first_name ? [{ field: 'first_name', message: 'First name is required' }] : []),
        ...(!last_name ? [{ field: 'last_name', message: 'Last name is required' }] : [])
      ]
    );
  }

  const connection = await pool.getConnection();
  let committed = false;

  try {
    await connection.beginTransaction();

    const [existing] = await connection.query(
      `SELECT id FROM users WHERE email = ? OR username = ? LIMIT 1`,
      [email.trim().toLowerCase(), username.trim()]
    );

    if (existing.length > 0) {
      throw new AppError('Username or Email already exists', 409, 'DUPLICATE_ENTRY');
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    const publicId = uuidv4();

    const [result] = await connection.query(
      `INSERT INTO users (public_id, username, email, password_hash, first_name, last_name, job_title, bio, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
      [
        publicId,
        username.trim(),
        email.trim().toLowerCase(),
        passwordHash,
        first_name.trim(),
        last_name.trim(),
        job_title || null,
        bio || null
      ]
    );

    const userId = result.insertId;

    if (Array.isArray(skills) && skills.length > 0) {
      const skillValues = skills.map((skill) => [userId, skill.trim()]);
      await connection.query(
        `INSERT INTO user_skills (user_id, skill) VALUES ?`,
        [skillValues]
      );
    }

    const [newUsers] = await connection.query(
      `SELECT ${USER_SAFE_COLUMNS} FROM users WHERE id = ?`,
      [userId]
    );
    const newUser = newUsers[0];

    const { refreshToken, expiresAt } = await createSession(userId, req, connection);

    await connection.commit();
    committed = true;

    return buildAuthPayload(newUser, refreshToken, expiresAt);
  } catch (error) {
    if (!committed) {
      await connection.rollback();
    }
    throw error;
  } finally {
    connection.release();
  }
};

export const login = async ({ login, password }, req) => {
  if (!login || !password) {
    throw new AppError(
      'Login and password are required',
      400,
      'VALIDATION_ERROR',
      [
        ...(!login ? [{ field: 'login', message: 'Email or username is required' }] : []),
        ...(!password ? [{ field: 'password', message: 'Password is required' }] : [])
      ]
    );
  }

  const user = await findUserByLogin(login.trim());
  if (!user) {
    throw new AppError('Invalid credentials', 401, 'UNAUTHENTICATED');
  }

  const passwordOk = await bcrypt.compare(password, user.password_hash);
  if (!passwordOk) {
    throw new AppError('Invalid credentials', 401, 'UNAUTHENTICATED');
  }

  if (user.status === 'SUSPENDED') {
    throw new AppError('Account is suspended', 403, 'FORBIDDEN');
  }

  if (user.status === 'PENDING_ONBOARDING') {
    throw new AppError('Account onboarding is not complete', 403, 'FORBIDDEN');
  }

  const { password_hash, ...safeUser } = user;
  const { refreshToken, expiresAt } = await createSession(safeUser.id, req);
  return buildAuthPayload(safeUser, refreshToken, expiresAt);
};

export const refresh = async ({ refresh_token }, req) => {
  if (!refresh_token) {
    throw new AppError(
      'Refresh token is required',
      400,
      'VALIDATION_ERROR',
      [{ field: 'refresh_token', message: 'Refresh token is required' }]
    );
  }

  const tokenHash = hashRefreshToken(refresh_token);
  const connection = await pool.getConnection();
  let committed = false;

  try {
    await connection.beginTransaction();

    const [sessions] = await connection.query(
      `SELECT s.id AS session_id, s.user_id, s.is_revoked, s.expires_at,
              u.id, u.public_id, u.username, u.email, u.first_name, u.last_name,
              u.job_title, u.status, u.bio, u.current_focus, u.avatar_url, u.last_active_at
       FROM sessions s
       INNER JOIN users u ON u.id = s.user_id
       WHERE s.refresh_token_hash = ?
       LIMIT 1
       FOR UPDATE`,
      [tokenHash]
    );

    const session = sessions[0];
    if (!session) {
      throw new AppError('Invalid refresh token', 401, 'UNAUTHENTICATED');
    }

    if (session.is_revoked) {
      await connection.query(
        `UPDATE sessions SET is_revoked = TRUE WHERE user_id = ? AND is_revoked = FALSE`,
        [session.user_id]
      );
      await connection.commit();
      committed = true;
      throw new AppError('Refresh token has been revoked', 401, 'UNAUTHENTICATED');
    }

    if (new Date(session.expires_at) <= new Date()) {
      await connection.query(
        `UPDATE sessions SET is_revoked = TRUE WHERE id = ?`,
        [session.session_id]
      );
      await connection.commit();
      committed = true;
      throw new AppError('Refresh token has expired', 401, 'UNAUTHENTICATED');
    }

    if (session.status !== 'ACTIVE') {
      throw new AppError('User not found or account is suspended', 401, 'UNAUTHENTICATED');
    }

    await connection.query(
      `UPDATE sessions SET is_revoked = TRUE WHERE id = ?`,
      [session.session_id]
    );

    const { refreshToken, expiresAt } = await createSession(session.user_id, req, connection);
    await connection.commit();
    committed = true;

    return buildAuthPayload(session, refreshToken, expiresAt);
  } catch (error) {
    if (!committed) {
      await connection.rollback();
    }
    throw error;
  } finally {
    connection.release();
  }
};

export const loadUserForAccessToken = async (userId) => {
  const [users] = await pool.query(
    `SELECT id, public_id, username, first_name, last_name, email, status, last_active_at
     FROM users
     WHERE id = ?`,
    [userId]
  );

  if (!users.length || users[0].status !== 'ACTIVE') {
    throw new AppError('User not found or account is suspended', 401, 'UNAUTHENTICATED');
  }

  const user = users[0];
  user.permissions = await loadPermissions(user.id);
  return user;
};

/**
 * Logs out a user based on session management rules:
 * 1. If session_id is provided, revokes that specific session.
 * 2. If all_other_devices is true, revokes all other active sessions for the user.
 * 3. Otherwise, revokes the session matching the provided refresh token.
 * @param {Object} logoutData Object containing refresh_token, session_id, and all_other_devices flags.
 * @param {number} userId The internal database ID of the user performing the logout.
 * @returns {Promise<{success: boolean}>} Success status object.
 */
export const logout = async ({ refresh_token, session_id, all_other_devices }, userId) => {
  const connection = await pool.getConnection();

  try {
    // Case 1: Log out from all other devices (keeping current or revoking all valid ones)
    if (all_other_devices && userId) {
      if (session_id) {
        // Revoke all sessions except the specified active session
        await connection.query(
          `UPDATE sessions SET is_revoked = TRUE WHERE user_id = ? AND id != ? AND is_revoked = FALSE`,
          [userId, session_id]
        );
      } else {
        // Revoke all sessions for this user
        await connection.query(
          `UPDATE sessions SET is_revoked = TRUE WHERE user_id = ? AND is_revoked = FALSE`,
          [userId]
        );
      }
      return { success: true };
    }

    // // Case 2: Revoke a specific session by its ID
    // if (session_id && userId) {
    //   await connection.query(
    //     `UPDATE sessions SET is_revoked = TRUE WHERE id = ? AND user_id = ? AND is_revoked = FALSE`,
    //     [session_id, userId]
    //   );
    //   return { success: true };
    // }

    // // Case 3: Standard logout using the refresh token (current session)
    // if (refresh_token) {
    //   const tokenHash = hashRefreshToken(refresh_token);
    //   await connection.query(
    //     `UPDATE sessions SET is_revoked = TRUE WHERE refresh_token_hash = ? AND is_revoked = FALSE`,
    //     [tokenHash]
    //   );
    // }

    return { success: true };
  } finally {
    connection.release();
  }
};