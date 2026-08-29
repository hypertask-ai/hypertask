/**
 * Common pagination schemas
 * 
 * Shared validation logic for pagination parameters across list/search tools.
 */

import { z } from 'zod';

/**
 * Common pagination fields
 */
export const paginationSchema = z.object({
  limit: z.number().int().positive().max(100).optional(),
  offset: z.number().int().nonnegative().optional(),
});

/**
 * Search-specific pagination (smaller limit)
 */
export function createSearchPaginationSchema(maxLimit: number, defaultLimit: number) {
  return z.object({
    limit: z.number().int().positive().max(maxLimit).optional().default(defaultLimit),
  });
}

/**
 * Sort order schema
 */
export const sortOrderSchema = z.enum(['asc', 'desc']).optional();

/**
 * Common sort fields
 */
export const sortBySchema = z.enum(['createdAt', 'updatedAt', 'dueDate', 'priority', 'title', 'lastUsedAt']).optional();
