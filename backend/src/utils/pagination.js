/**
 * Shared Helper: Pagination Calculator
 * Parses query params (?page=1&per_page=20) and calculates SQL LIMIT & OFFSET.
 */
export const getPagination = (query, defaultLimit = 20, maxLimit = 100) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.per_page || query.limit, 10) || defaultLimit));
  const offset = (page - 1) * limit;

  return { page, limit, offset };
};