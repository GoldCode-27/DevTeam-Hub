const AppError = require('../utils/appError');

/**
 * 404 Not Found Middleware
 * Catches all unmatched routes and passes a standardized NOT_FOUND AppError to the global handler.
 */
const notFoundHandler = (req, res, next) => {
  next(new AppError(`Cannot find ${req.originalUrl} on this server`, 404, 'NOT_FOUND'));
};

module.exports = notFoundHandler;