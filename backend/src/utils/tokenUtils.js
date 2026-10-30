
import crypto from 'crypto';
import jwt from 'jsonwebtoken';


/**
  Token Utilities (JWT-based Access & Refresh Tokens)
 */

export const REFRESH_COOKIE_NAME = 'refresh_token';
export const ACCESS_TOKEN_EXPIRES = process.env.JWT_ACCESS_EXPIRES || '15m';
export const REFRESH_TOKEN_EXPIRES = process.env.REFRESH_TOKEN_EXPIRES || '30d';

// Create Access Token 
export const signAccessToken = (payload) => {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error('JWT_ACCESS_SECRET is not configured');
  return jwt.sign(payload, secret, { expiresIn: ACCESS_TOKEN_EXPIRES });
};

// Access Token Verification
export const verifyAccessToken = (token) => {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) throw new Error('JWT_ACCESS_SECRET is not configured');
  return jwt.verify(token, secret);
};

// Create Refresh Token as jwt
export const signRefreshToken = (payload) => {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) throw new Error('JWT_REFRESH_SECRET is not configured');
  return jwt.sign(payload, secret, { expiresIn: REFRESH_TOKEN_EXPIRES });
};

// Refresh Token Verification
export const verifyRefreshToken = (token) => {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) throw new Error('JWT_REFRESH_SECRET is not configured');
  return jwt.verify(token, secret);
};

// Refresh Token Expiry Date Calculation
export const getRefreshExpiryDate = () => {
  const days = Number(REFRESH_TOKEN_EXPIRES) || 30;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);
  return expiresAt;
};

// Refresh Token Hashing (using SHA-256) Crypto
export const hashRefreshToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

export const getClientMeta = (req) => ({
  ipAddress: req.ip || req.socket?.remoteAddress || '0.0.0.0',
  userAgent: String(req.headers['user-agent'] || 'unknown').slice(0, 512)
});

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