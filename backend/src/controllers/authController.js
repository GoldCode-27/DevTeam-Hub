import { googleLogin, login, logout, refresh, register } from '../services/authService.js';
import {
  REFRESH_COOKIE_NAME,
  clearRefreshCookieOptions,
  getRefreshCookieOptions
} from '../utils/tokenUtils.js';

/**
 * Auth Controller (Developer 2)
 * Sets refresh token in an httpOnly cookie; returns access JWT in the JSON body.
 */

const readRefreshToken = (req) =>
  req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refresh_token || null;

//get refresh token from cookie or body, if not found return null
const setRefreshCookie = (res, refreshToken, expiresAt) => {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, getRefreshCookieOptions(expiresAt));
};

//clear refresh token cookie
const clearRefreshCookie = (res) => {
  res.clearCookie(REFRESH_COOKIE_NAME, clearRefreshCookieOptions());
};

//strip refresh token and expiration from the response body, return public payload
const stripRefreshFromBody = (data) => {
  const { refresh_token, refresh_expires_at, ...publicPayload } = data;
  return { publicPayload, refresh_token, refresh_expires_at };
};

//send authentication response to the client, set refresh token cookie, and return public payload
const sendAuthResponse = (res, data, statusCode) => {
  const { publicPayload, refresh_token, refresh_expires_at } = stripRefreshFromBody(data);
  setRefreshCookie(res, refresh_token, refresh_expires_at);
  res.status(statusCode).json({
     ...publicPayload, refresh_expires_at 
    });
};

//register handller
export const registerHandler = async (req, res, next) => {
  try {
    const data = await register(req.body);
    res.status(201).json({
      ...data,
      // message: 'User registered successfully'
    });
  } catch (error) {
    next(error);
  }
};
//continue with google handller 
export const googleAuthHandler = async (req, res, next) => {
  try {
    //  idToken from Frontend sent to  googleLogin 
    const data = await googleLogin(req.body, req);
    
    sendAuthResponse(res, data, 200);
  } catch (error) {
    next(error);
  }
};
//login  handler is responsible for handling user login requests. It extracts the login credentials from the request body, calls the login service, and sends the authentication response back to the client.
//  If an error occurs during the process, it passes the error to the next middleware for handling.
export const loginHandler = async (req, res, next) => {
  try {
    const data = await login(
      {
        login: req.body.login ?? req.body.email ?? req.body.username,
        password: req.body.password
      },
      req
    );
    sendAuthResponse(res, data, 200);
  } catch (error) {
    next(error);
  }
};
 
// refresh handler is responsible for handling token refresh requests.
//  It reads the refresh token from the request, calls the refresh service, 
// and sends the new authentication response back to the client.
export const refreshHandler = async (req, res, next) => {
  try {
    const data = await refresh({ refresh_token: readRefreshToken(req) }, req);
    sendAuthResponse(res, data, 200);
  } catch (error) {
    clearRefreshCookie(res);
    next(error);
  }
};

//logout handler is responsible for handling user logout requests. It extracts the 
// session ID and a flag indicating whether to log out from all devices from the request body,
//  calls the logout service, and clears the refresh token cookie if necessary.
export const logoutHandler = async (req, res, next) => {
  try {
    const { session_id, all_other_devices } = req.body || {};

    await logout(
      {
        refresh_token: readRefreshToken(req),
        session_id,
        all_other_devices: Boolean(all_other_devices)
      },
      req.user?.id
    );

    if (!all_other_devices) {
      clearRefreshCookie(res);
    }

    res.status(204).send();
  } catch (error) {
    next(error);
  }
};
