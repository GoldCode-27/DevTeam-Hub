/**
 * Global Error Handling Middleware
 * Catches all thrown application errors and formats them strictly to match the API specification:
 * { "error": { "code": "...", "message": "...", "details": [] } }
 */
const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const errorCode = err.code || 'INTERNAL_SERVER_ERROR';
  const message = err.message || 'An unexpected internal server error occurred.';
  const details = err.details || [];

  // Log server errors for developer inspection in development mode
  if (statusCode >= 500) {
    console.error(` [Error ${statusCode} - ${errorCode}]:`, err);
  }

  res.status(statusCode).json({
    error: {
      code: errorCode,
      message: message,
      details: details
    }
  });
};

module.exports = errorHandler;