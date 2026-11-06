import rateLimit from 'express-rate-limit';

/**
 * Login / refresh brute-force protection
 */
export const loginRateLimiter = rateLimit({
  windowMs: Number(process.env.LOGIN_RATE_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.LOGIN_RATE_MAX) || 20,
  standardHeaders: true,
  legacyHeaders: false,
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
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many refresh attempts. Try again later.',
      details: []
    }
  }
});
