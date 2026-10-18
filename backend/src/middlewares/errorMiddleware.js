/**
 * Global Error Handling Middleware
 * Centralizes application-wide error handling and guarantees that all API error
 * responses strictly conform to the DevTeam-Hub API documentation specification:
 *
 * {
 *   "error": {
 *     "code": "VALIDATION_ERROR | NOT_FOUND | UNAUTHENTICATED | ...",
 *     "message": "Descriptive human-readable error message",
 *     "details": []
 *   }
 * }
 */
const errorHandler = (err, req, res, next) => {
  // 1. Resolve HTTP status code (defaults to 500 for unhandled exceptions)
  const statusCode = err.statusCode || 500;

  // 2. Resolve standardized error code
  const errorCode = err.code || 'INTERNAL_SERVER_ERROR';

  // 3. Resolve human-readable error message
  const message = err.message || 'An unexpected internal server error occurred.';

  // 4. Resolve error details array (e.g., validation constraint failures)
  const details = err.details || [];

  // 5. Log critical internal server errors to terminal for debugging
  if (statusCode >= 500) {
    console.error(`[Server Error ${statusCode} - ${errorCode}]:`, err.message);
  }

  // 6. Return standardized JSON response to the client
  res.status(statusCode).json({
    error: {
      code: errorCode,
      message: message,
      details: details
    }
  });
};

export default errorHandler;