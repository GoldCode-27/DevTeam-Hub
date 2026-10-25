import crypto from "crypto";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import db from "../config/db.js";
import AppError from "../utils/appError.js";
import { sendWelcomeEmail } from "../utils/emailService.js";
import {
  ACCESS_TOKEN_EXPIRES,generateRefreshToken,getClientMeta,getRefreshExpiryDate,hashRefreshToken,signAccessToken,
} from "../utils/tokenUtils.js";
import { verifyGoogleIdToken } from "../utils/googleUtils.js"; 
// Destructure safeQuery and pool from db.js
const { pool, safeQuery } = db;

const USER_SAFE_COLUMNS = `
  id, public_id, username, email, first_name, last_name,
  job_title, status, bio, current_focus, avatar_url, last_active_at
`;

const findUserByLogin = async (login) => {
  const rows = await safeQuery(
    `SELECT ${USER_SAFE_COLUMNS}, password_hash
     FROM users
     WHERE email = ? OR username = ?
     LIMIT 1`,
    [login, login],
  );
  return rows[0] || null;
};

const loadPermissions = async (userId) => {
  const rows = await safeQuery(
    `SELECT p.slug
     FROM permissions p
     INNER JOIN user_permissions up ON p.id = up.permission_id
     WHERE up.user_id = ?`,
    [userId],
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
  permissions,
});

const runQuery = async (sql, params, connection = null) => {
  if (connection) {
    const [result] = await connection.query(sql, params);
    return result;
  }
  return safeQuery(sql, params);
};

const createSession = async (userId, req, connection = null) => {
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const expiresAt = getRefreshExpiryDate();
  const { ipAddress, userAgent } = getClientMeta(req);

  await runQuery(
    `INSERT INTO sessions (user_id, refresh_token_hash, ip_address, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, refreshTokenHash, ipAddress, userAgent, expiresAt],
    connection,
  );

  await runQuery(
    `UPDATE users SET last_active_at = NOW() WHERE id = ?`,
    [userId],
    connection,
  );

  return { refreshToken, expiresAt };
};

const buildAuthPayload = async (user, refreshToken, expiresAt) => {
  const permissions = await loadPermissions(user.id);
  const accessToken = signAccessToken({
    sub: user.public_id,
    uid: user.id,
    username: user.username,
  });

  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_EXPIRES,
    refresh_token: refreshToken,
    refresh_expires_at: expiresAt.toISOString(),
    user: toPublicUser(user, permissions),
  };
};

export const register = async (userData) => {
  const {
    username,
    email,
    first_name,
    last_name,
    job_title,
    bio,
    skills = [],
  } = userData;

  if (!username || !email || !first_name || !last_name) {
    throw new AppError(
      "Missing required registration fields",
      400,
      "VALIDATION_ERROR",
      [
        ...(!username
          ? [{ field: "username", message: "Username is required" }]
          : []),
        ...(!email ? [{ field: "email", message: "Email is required" }] : []),
        ...(!first_name
          ? [{ field: "first_name", message: "First name is required" }]
          : []),
        ...(!last_name
          ? [{ field: "last_name", message: "Last name is required" }]
          : []),
      ],
    );
  }

  const connection = await pool.getConnection();
  let committed = false;

  try {
    await connection.beginTransaction();

    const [existing] = await connection.query(
      `SELECT id FROM users WHERE email = ? OR username = ? LIMIT 1`,
      [email.trim().toLowerCase(), username.trim()],
    );

    if (existing.length > 0) {
      throw new AppError(
        "Username or Email already exists",
        409,
        "DUPLICATE_ENTRY",
      );
    }

    const tempPassword = crypto.randomBytes(4).toString("hex");
    const passwordHash = await bcrypt.hash(tempPassword, 10);
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
        bio || null,
      ],
    );

    const userId = result.insertId;

    if (Array.isArray(skills) && skills.length > 0) {
      const skillValues = skills
        .map((skill) => String(skill).trim())
        .filter(Boolean)
        .map((skill) => [userId, skill]);

      if (skillValues.length > 0) {
        await connection.query(
          `INSERT INTO user_skills (user_id, skill) VALUES ?`,
          [skillValues],
        );
      }
    }

    const [newUsers] = await connection.query(
      `SELECT ${USER_SAFE_COLUMNS} FROM users WHERE id = ?`,
      [userId],
    );
    const newUser = newUsers[0];

    await sendWelcomeEmail(email.trim().toLowerCase(), tempPassword);

    await connection.commit();
    committed = true;

    return {
      success: true,
      message:
        "User registered successfully by admin and temporary password email sent.",
      user: toPublicUser(newUser),
    };
  } catch (error) {
    if (!committed) {
      await connection.rollback();
    }
    throw error;
  } finally {
    connection.release();
  }
};

export const googleLogin = async (payload = {}, req) => {
  // 1. check if the idToken is provided in the payload 
  if (!payload.idToken) {
    throw new AppError("Google ID token is required", 400, "VALIDATION_ERROR", [
      { field: "idToken", message: "idToken field is required for Google sign-in" }
    ]);
  }

  // 2. compare the provided idToken with the one generated by Google to verify its authenticity
  const googleProfile = await verifyGoogleIdToken(payload.idToken);
  const email = googleProfile?.email;

  if (!email) {
    throw new AppError("Email is required", 400, "VALIDATION_ERROR", [
      { field: "email", message: "Google account email is required" },
    ]);
  }

  const user = await findUserByLogin(email.trim().toLowerCase());
  if (!user) {
    throw new AppError(
      "Access Denied: Account not pre-registered by admin",
      403,
      "FORBIDDEN",
    );
  }

  if (user.status === "SUSPENDED") {
    throw new AppError("Account is suspended", 403, "FORBIDDEN");
  }

  const { password_hash: _passwordHash, ...safeUser } = user;
  const { refreshToken, expiresAt } = await createSession(safeUser.id, req);
  return buildAuthPayload(safeUser, refreshToken, expiresAt);
};
export const login = async ({ login, password }, req) => {
  if (!login || !password) {
    throw new AppError(
      "Login and password are required",
      400,
      "VALIDATION_ERROR",
      [
        ...(!login
          ? [{ field: "login", message: "Email or username is required" }]
          : []),
        ...(!password
          ? [{ field: "password", message: "Password is required" }]
          : []),
      ],
    );
  }

  const normalizedLogin = login.trim();
  const lookup = normalizedLogin.includes("@")
    ? normalizedLogin.toLowerCase()
    : normalizedLogin;

  const user = await findUserByLogin(lookup);
  if (!user) {
    throw new AppError("Invalid credentials", 401, "UNAUTHENTICATED");
  }

  const passwordOk = await bcrypt.compare(password, user.password_hash);
  if (!passwordOk) {
    throw new AppError("Invalid credentials", 401, "UNAUTHENTICATED");
  }

  if (user.status === "SUSPENDED") {
    throw new AppError("Account is suspended", 403, "FORBIDDEN");
  }

  if (user.status === "PENDING_ONBOARDING") {
    throw new AppError("Account onboarding is not complete", 403, "FORBIDDEN");
  }

  const { password_hash: _passwordHash, ...safeUser } = user;
  const { refreshToken, expiresAt } = await createSession(safeUser.id, req);
  return buildAuthPayload(safeUser, refreshToken, expiresAt);
};

export const refresh = async ({ refresh_token }, req) => {
  if (!refresh_token) {
    throw new AppError("Refresh token is required", 400, "VALIDATION_ERROR", [
      { field: "refresh_token", message: "Refresh token is required" },
    ]);
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
      [tokenHash],
    );

    const session = sessions[0];
    if (!session) {
      throw new AppError("Invalid refresh token", 401, "UNAUTHENTICATED");
    }

    if (session.is_revoked) {
      await connection.query(
        `UPDATE sessions SET is_revoked = TRUE WHERE user_id = ? AND is_revoked = FALSE`,
        [session.user_id],
      );
      await connection.commit();
      committed = true;
      throw new AppError(
        "Refresh token has been revoked",
        401,
        "UNAUTHENTICATED",
      );
    }

    if (new Date(session.expires_at) <= new Date()) {
      await connection.query(
        `UPDATE sessions SET is_revoked = TRUE WHERE id = ?`,
        [session.session_id],
      );
      await connection.commit();
      committed = true;
      throw new AppError("Refresh token has expired", 401, "UNAUTHENTICATED");
    }

    if (session.status !== "ACTIVE") {
      throw new AppError(
        "User not found or account is suspended",
        401,
        "UNAUTHENTICATED",
      );
    }

    await connection.query(
      `UPDATE sessions SET is_revoked = TRUE WHERE id = ?`,
      [session.session_id],
    );

    const { refreshToken, expiresAt } = await createSession(
      session.user_id,
      req,
      connection,
    );
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
  const users = await safeQuery(
    `SELECT id, public_id, username, first_name, last_name, email, status, last_active_at
     FROM users
     WHERE id = ?`,
    [userId],
  );

  if (!users.length || users[0].status !== "ACTIVE") {
    throw new AppError(
      "User not found or account is suspended",
      401,
      "UNAUTHENTICATED",
    );
  }

  const { password_hash: _passwordHash, ...user } = users[0];
  user.permissions = await loadPermissions(user.id);
  return user;
};

export const logout = async (
  { refresh_token, session_id, all_other_devices } = {},
  userId,
) => {
  if (!userId) {
    throw new AppError("Authentication required", 401, "UNAUTHENTICATED");
  }

  const tokenHash = refresh_token ? hashRefreshToken(refresh_token) : null;

  if (all_other_devices) {
    if (session_id) {
      await safeQuery(
        `UPDATE sessions SET is_revoked = TRUE
         WHERE user_id = ? AND id != ? AND is_revoked = FALSE`,
        [userId, session_id],
      );
    } else if (tokenHash) {
      await safeQuery(
        `UPDATE sessions SET is_revoked = TRUE
         WHERE user_id = ? AND refresh_token_hash != ? AND is_revoked = FALSE`,
        [userId, tokenHash],
      );
    } else {
      await safeQuery(
        `UPDATE sessions SET is_revoked = TRUE
         WHERE user_id = ? AND is_revoked = FALSE`,
        [userId],
      );
    }

    return { success: true };
  }

  if (session_id) {
    await safeQuery(
      `UPDATE sessions SET is_revoked = TRUE
       WHERE id = ? AND user_id = ? AND is_revoked = FALSE`,
      [session_id, userId],
    );
  } else if (tokenHash) {
    await safeQuery(
      `UPDATE sessions SET is_revoked = TRUE
       WHERE refresh_token_hash = ? AND user_id = ? AND is_revoked = FALSE`,
      [tokenHash, userId],
    );
  } else {
    await safeQuery(
      `UPDATE sessions SET is_revoked = TRUE
       WHERE user_id = ? AND is_revoked = FALSE`,
      [userId],
    );
  }

  return { success: true };
};
