import {
  // getCurrentUser,
  login,
   logout,
  refresh,
  register // <-- register services
} from '../services/authService.js';
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

const setRefreshCookie = (res, refreshToken, expiresAt) => {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, getRefreshCookieOptions(expiresAt));
};

const clearRefreshCookie = (res) => {
  res.clearCookie(REFRESH_COOKIE_NAME, clearRefreshCookieOptions());
};

const stripRefreshFromBody = (data) => {
  const { refresh_token, refresh_expires_at, ...publicPayload } = data;
  return { publicPayload, refresh_token, refresh_expires_at };
};

// /**
//  * Register Handler 
//  */
// export const registerHandler = async (req, res, next) => {
//   try {
//     const data = await register(req.body, req);

//     const { publicPayload, refresh_token, refresh_expires_at } = stripRefreshFromBody(data);
//     setRefreshCookie(res, refresh_token, refresh_expires_at);

  
//     /*
//     if (req.body.return_refresh_token === true) {
//       res.status(201).json({ ...publicPayload, refresh_token, refresh_expires_at });
//       return;
//     }
//     */

//     res.status(201).json({ ...publicPayload, refresh_expires_at });
//   } catch (error) {
//     next(error);
//   }
// };


export const registerHandler = async (req, res, next) => {
  try {
    // አድሚን አዲስ ተጠቃሚ ሲመዝገብ የፈጠረውን ዩዘር መረጃ ብቻ ይመልሳል እንጂ 
    // የአድሚኑን ኩኪ በአዲስ ቶከን መተካት የለበትም!
    const newUser = await register(req.body, req);

    res.status(201).json({ 
      message: "User registered successfully by admin",
      user: newUser 
    });
  } catch (error) {
    next(error);
  }
};


//login handler
export const loginHandler = async (req, res, next) => {
  try {
    const data = await login(
      {
        login: req.body.login ?? req.body.email ?? req.body.username,
        password: req.body.password
      },
      req
    );

    const { publicPayload, refresh_token, refresh_expires_at } = stripRefreshFromBody(data);
    setRefreshCookie(res, refresh_token, refresh_expires_at);

    // Include refresh_token in JSON only when explicitly requested (mobile / API clients)
    /*
    if (req.body.return_refresh_token === true) {
      res.status(200).json({ ...publicPayload, refresh_token, refresh_expires_at });
      return;
    }
    */

    res.status(200).json({ ...publicPayload, refresh_expires_at });
  } catch (error) {
    next(error);
  }
};

export const refreshHandler = async (req, res, next) => {
  try {
    const data = await refresh({ refresh_token: readRefreshToken(req) }, req);
    const { publicPayload, refresh_token, refresh_expires_at } = stripRefreshFromBody(data);
    setRefreshCookie(res, refresh_token, refresh_expires_at);

    // Include refresh_token in JSON only when explicitly requested (mobile / API clients)
    /*
    if (req.body.return_refresh_token === true) {
      res.status(200).json({ ...publicPayload, refresh_token, refresh_expires_at });
      return;
    }
    */

    res.status(200).json({ ...publicPayload, refresh_expires_at });
  } catch (error) {
    clearRefreshCookie(res);
    next(error);
  }
};

export const logoutHandler = async (req, res, next) => {
  try {
    const { session_id, all_other_devices } = req.body || {};
    const userId = req.user.id; // from authenticate middleware 

    // 1. all_other_devices = true
    if (all_other_devices) {
      await logoutAllOtherDevices(userId, req.session_id); 
    } 
    // // 2. if some  session_id 
    // else if (session_id) {
    //   await logoutSessionById(session_id, userId);
    // } 
    // 3. (Body empity)  close these session only
    else {
      const refreshToken = readRefreshToken(req);
      await logout({ refresh_token: refreshToken });
    }

    clearRefreshCookie(res);
    res.status(204).send(); 
  } catch (error) {
    clearRefreshCookie(res);
    next(error);
  }
};
// export const meHandler = async (req, res, next) => {
//   try {
//     const data = await getCurrentUser(req.user.id);
//     res.status(200).json({ user: data });
//   } catch (error) {
//     next(error);
//   }
// };