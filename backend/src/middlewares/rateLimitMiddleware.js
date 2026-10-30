import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import jwt from 'jsonwebtoken';

/**
 * Login / refresh brute-force protection */

export const loginRateLimiter = rateLimit({
  windowMs: Number(process.env.LOGIN_RATE_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.LOGIN_RATE_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  //
  keyGenerator: (req, res) => {
    // for standard login username and email
    const identifier = req.body?.login || req.body?.email || req.body?.username;
    if (identifier) {
      return `login_${identifier.toLowerCase().trim()}`;
    }

    // for Google login, use the email from the idToken
    const idToken = req.body?.idToken;
    if (idToken && typeof idToken === 'string') {
      try {
        // idToken (Google JWT) decode email from it 
        const decodedGoogleToken = jwt.decode(idToken);
        if (decodedGoogleToken && decodedGoogleToken.email) {
          return `login_google_${decodedGoogleToken.email.toLowerCase().trim()}`;
        }
      } catch (err) {
        // if token is not valid
      }
    }

    // if no identifier, fallback to IP address
    return ipKeyGenerator(req, res);
  },

  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many login attempts. Try again later.',
      details: []
    }
  }
});

export const refreshRateLimiter = rateLimit({
  windowMs: Number(process.env.REFRESH_RATE_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.REFRESH_RATE_MAX) || 60,
  standardHeaders: true,
  legacyHeaders: false,
  
  //for refresh from cookie or body, we can use the refresh token to identify the user
  keyGenerator: (req, res) => {
    const refreshToken = req.cookies?.refresh_token || req.body?.refresh_token;

    if (refreshToken && typeof refreshToken === 'string') {
      try {
        const decoded = jwt.decode(refreshToken);
        if (decoded && (decoded.uid || decoded.id)) {
          return `refresh_user_${decoded.uid || decoded.id}`;
        }
      } catch (err) {
        //if token is not decoded correctly
      }
    }

    return ipKeyGenerator(req, res);
  },

  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many refresh attempts. Try again later.',
      details: []
    }
  }
});