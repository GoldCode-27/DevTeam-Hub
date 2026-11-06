import AppError from '../utils/appError.js';

/**
 * 404 Not Found Middleware (ES6 Module)
 */
const notFoundHandler = (req, res, next) => {
  next(new AppError(`Cannot find ${req.originalUrl} on this server`, 404, 'NOT_FOUND'));
};

export default notFoundHandler;