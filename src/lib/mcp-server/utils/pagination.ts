/**
 * Pagination Utilities
 * 
 * Provides standardized pagination response building following MCP best practices.
 * Ensures all paginated responses include has_more and next_offset metadata.
 */

/**
 * Base interface for all paginated responses
 * Following MCP best practice: Paginate Large Results
 */
export interface PaginatedResponse<T> {
  success: boolean;
  items: T[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
  next_offset?: number;
}

/**
 * Parameters for building paginated responses
 */
export interface PaginationParams {
  offset: number;
  limit: number;
  total: number;
  itemsCount: number;
}

/**
 * Builds pagination metadata for a response
 * Calculates has_more and next_offset based on current offset, limit, and total
 * 
 * @param params - Pagination parameters
 * @returns Object with has_more and next_offset fields
 */
export function buildPaginationMetadata(params: PaginationParams): {
  has_more: boolean;
  next_offset?: number;
} {
  const { offset, total, itemsCount } = params;
  
  // Calculate if there are more items beyond current page
  const currentPageEnd = offset + itemsCount;
  const hasMore = currentPageEnd < total;
  
  // Calculate next offset if there are more items
  const nextOffset = hasMore ? currentPageEnd : undefined;
  
  return {
    has_more: hasMore,
    next_offset: nextOffset,
  };
}

/**
 * Helper to build a complete paginated response
 * 
 * @param items - Array of items for current page
 * @param total - Total number of items across all pages
 * @param offset - Current offset (default: 0)
 * @param limit - Current limit (default: items.length)
 * @returns Complete paginated response with metadata
 */
export function buildPaginatedResponse<T>(
  items: T[],
  total: number,
  offset: number = 0,
  limit?: number
): PaginatedResponse<T> {
  const actualLimit = limit ?? items.length;
  const paginationMetadata = buildPaginationMetadata({
    offset,
    limit: actualLimit,
    total,
    itemsCount: items.length,
  });

  return {
    success: true,
    items,
    total,
    limit: actualLimit,
    offset,
    ...paginationMetadata,
  };
}
