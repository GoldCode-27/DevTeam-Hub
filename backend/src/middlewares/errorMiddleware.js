/**
 * Global Error Handling Middleware (ES6 Module)
 */
const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const errorCode = err.code || 'INTERNAL_SERVER_ERROR';
  const message = err.message || 'An unexpected internal server error occurred.';
  const details = err.details || [];

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

export default errorHandler;