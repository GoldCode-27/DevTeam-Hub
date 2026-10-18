/**
 * Custom Application Error Class
 * Inherits from JavaScript's built-in Error class to standardize operational
 * error handling across all controllers and services.
 *
 * It formats errors to match the API documentation specification:
 * { "error": { "code": "...", "message": "...", "details": [] } }
 */
class AppError extends Error {
  /**
   * @param {string} message - Human-readable explanation of the error
   * @param {number} statusCode - HTTP status code (e.g., 400, 401, 403, 404, 500)
   * @param {string} code - Machine-readable error code (e.g., 'NOT_FOUND', 'VALIDATION_ERROR')
   * @param {Array} details - Optional array of field-level errors or additional context
   */
  constructor(message, statusCode = 500, code = 'INTERNAL_SERVER_ERROR', details = []) {
    // 1. Pass the message to the parent Error class
    super(message);

    // 2. HTTP response status code
    this.statusCode = statusCode;

    // 3. API specification error slug
    this.code = code;

    // 4. Granular error details (useful for form validations)
    this.details = details;

    // 5. Mark as operational error (differentiates expected business errors from unknown system bugs)
    this.isOperational = true;

    // 6. Capture clean stack trace without polluting it with this constructor call
    Error.captureStackTrace(this, this.constructor);
  }
}

export default AppError;