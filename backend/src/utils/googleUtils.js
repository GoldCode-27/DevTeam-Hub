import https from 'https';
import AppError from './appError.js';

const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

/**
 * Verify a Google ID token using Node.js built-in https module (stable & reliable)
 */
export async function verifyGoogleIdToken(idToken, { clientId = process.env.GOOGLE_CLIENT_ID, now = Date.now() } = {}) {
  if (!clientId) {
    throw new AppError('Google sign-in is not configured on this server', 503, 'CONFIG_ERROR');
  }

  if (typeof idToken !== 'string' || idToken.length < 20 || idToken.length > 4096) {
    throw new AppError('Invalid Google credential', 400, 'VALIDATION_ERROR', [
      { field: 'idToken', message: 'Invalid Google credential token format' }
    ]);
  }

  // Google tokeninfo endpoint URL
  const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;

  // Using native Node.js https module to avoid fetch/DNS issues
  const claims = await new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new AppError('Google sign-in could not be verified', 401, 'UNAUTHENTICATED'));
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new AppError('Invalid response from Google', 502, 'NETWORK_ERROR'));
        }
      });
    });

    req.on('error', () => {
      reject(new AppError('Could not reach Google to verify the sign-in. Please try again.', 502, 'NETWORK_ERROR'));
    });

    req.setTimeout(300000, () => {
      req.destroy();
      reject(new AppError('Google verification timed out. Please try again.', 504, 'TIMEOUT_ERROR'));
    });
  });

  const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
  const notExpired = Number(claims.exp) * 1000 > now;

  if (claims.aud !== clientId || !ISSUERS.includes(claims.iss) || !notExpired || !claims.sub || !claims.email || !emailVerified) {
    throw new AppError('Google sign-in could not be verified', 401, 'UNAUTHENTICATED');
  }

  return {
    sub: String(claims.sub),
    email: String(claims.email).toLowerCase(),
    name: String(claims.name || claims.email.split('@')[0]).slice(0, 120),
  };
}