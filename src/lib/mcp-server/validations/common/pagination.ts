
import { z } from 'zod';

export const paginationSchema = z.object({
  limit: z.number().int().positive().max(100).optional(),
  offset: z.number().int().nonnegative().optional(),
});

export function createSearchPaginationSchema(maxLimit: number, defaultLimit: number) {
  return z.object({
    limit: z.number().int().positive().max(maxLimit).optional().default(defaultLimit),
  });
}

export const sortOrderSchema = z.enum(['asc', 'desc']).optional();

export const sortBySchema = z.enum(['createdAt', 'updatedAt', 'dueDate', 'priority', 'title', 'lastUsedAt']).optional();
