import crypto from 'crypto';
import jwt from 'jsonwebtoken';

/**
 * Token Utilities (Developer 2 — Auth)
 * Short-lived access JWTs + opaque rotating refresh tokens (SHA-256 in sessions).
 */

export const REFRESH_COOKIE_NAME = 'refresh_token';
export const ACCESS_TOKEN_EXPIRES = process.env.JWT_ACCESS_EXPIRES || '15m';

// Hashes the refresh token using SHA-256 for secure storage in the database.
export const hashRefreshToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

//generate a random refresh token (48 bytes, base64url-encoded)
export const generateRefreshToken = () => crypto.randomBytes(48).toString('base64url');

// Generates a short-lived access JWT with the given payload.
export const signAccessToken = (payload) => {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) {
    throw new Error('JWT_ACCESS_SECRET is not configured');
  }

  return jwt.sign(payload, secret, {
    expiresIn: ACCESS_TOKEN_EXPIRES
  });
};

// Verifies the access JWT and returns the decoded payload. Throws an error if invalid or expired.
export const verifyAccessToken = (token) => {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) {
    throw new Error('JWT_ACCESS_SECRET is not configured');
  }

  return jwt.verify(token, secret);
};

//
export const getRefreshExpiryDate = () => {
  const days = Number(process.env.REFRESH_TOKEN_DAYS) || 30;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);
  return expiresAt;
};

// Retrieves the client's IP address and user-agent from the request for logging or security purposes.
export const getClientMeta = (req) => ({
  ipAddress: req.ip || req.socket?.remoteAddress || '0.0.0.0',
  userAgent: String(req.headers['user-agent'] || 'unknown').slice(0, 512)
});

// export const getClientMeta = (req) => {
//   // declaring (Variables)
//   const ipAddress = req.ip || req.socket?.remoteAddress || '0.0.0.0';
//   const userAgent = String(req.headers['user-agent'] || 'unknown').slice(0, 512);

//   // returning the object with ipAddress and userAgent
//   return {
//     ipAddress: ipAddress,
//     userAgent: userAgent
//   };
// };

/**
 * httpOnly refresh cookie flags.
 * Secure is on in production (or when COOKIE_SECURE=true) — required for real HTTPS deploys.
 */
export const getRefreshCookieOptions = (expiresAt) => {
  const secure =
    process.env.COOKIE_SECURE === 'true' ||
    process.env.NODE_ENV === 'production';

  return {
    httpOnly: true,
    secure,
    sameSite: secure ? 'none' : 'lax',
    path: '/',
    expires: expiresAt instanceof Date ? expiresAt : new Date(expiresAt)
  };
};

export const clearRefreshCookieOptions = () => {
  const secure =
    process.env.COOKIE_SECURE === 'true' ||
    process.env.NODE_ENV === 'production';

  return {
    httpOnly: true,
    secure,
    sameSite: secure ? 'none' : 'lax',
    path: '/'
  };
};
