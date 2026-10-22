import AppError from "../utils/appError.js";
 import { loadUserForAccessToken } from "../services/authService.js";
 import { verifyAccessToken } from "../utils/tokenUtils.js";

/**
 * Expects: Authorization: Bearer <access_token> (short-lived JWT)
 * Refresh tokens are never accepted here — only on /api/auth/refresh.
 */
export const authenticate = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      return next(
        new AppError(
          "Missing or invalid Authorization header",
          401,
          "UNAUTHENTICATED",
        ),
      );
    }

    const accessToken = header.slice(7).trim();
    if (!accessToken) {
      return next(new AppError("Missing access token", 401, "UNAUTHENTICATED"));
    }

    let payload;
    try {
      payload = verifyAccessToken(accessToken);
    } catch {
      return next(
        new AppError("Invalid or expired access token", 401, "UNAUTHENTICATED"),
      );
    }

    if (!payload?.uid) {
      return next(
        new AppError("Invalid access token payload", 401, "UNAUTHENTICATED"),
      );
    }

    req.user = await loadUserForAccessToken(payload.uid);
    next();
  } catch (error) {
    if (error instanceof AppError) {
      return next(error);
    }
    next(error);
  }
};

/**
 * Checks if the authenticated user has the required permission(s)
 * directly from `req.user.permissions` (loaded in memory during authentication).
 *
 * @param {string|string[]} requiredPermissions - Single permission or array of permissions required.
 * @param {boolean} [requireAll=false] - If true, user must have ALL permissions. If false, ANY permission suffices.
 */
export const requirePermission = (requiredPermissions, requireAll = false) => {
  return (req, res, next) => {
    try {
      if (!req.user || !req.user.id) {
        return next(new AppError("Unauthorized", 401, "UNAUTHENTICATED"));
      }

      const userPermissions = req.user.permissions || [];
      const permissionsToCheck = Array.isArray(requiredPermissions)
        ? requiredPermissions
        : [requiredPermissions];

      if (permissionsToCheck.length === 0) {
        return next();
      }

      let hasPermission = false;

      if (requireAll) {
        hasPermission = permissionsToCheck.every((p) =>
          userPermissions.includes(p),
        );
      } else {
        hasPermission = permissionsToCheck.some((p) =>
          userPermissions.includes(p),
        );
      }

      if (!hasPermission) {
        return next(
          new AppError(
            `Forbidden: Missing required permissions (${permissionsToCheck.join(", ")})`,
            403,
            "FORBIDDEN",
          ),
        );
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

export default authenticate;
