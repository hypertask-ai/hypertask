/**
 * Shared MCP tool input fields for list/search (HTPR-6530).
 * Same names on every list tool: query, filter, sort, fields, limit, cursor.
 */

import { z } from 'zod'

export const listFilterSchema = z
  .object({
    section: z.string().min(1).optional(),
    label: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
    assignee: z.union([z.string().min(1), z.number().int()]).optional(),
    status: z.string().min(1).optional(),
    updated_since: z.string().min(1).optional(),
    has_pr: z.string().min(1).optional(),
  })
  .strict()
  .optional()

export const listQueryToolSchema = z.object({
  query: z
    .string()
    .min(1)
    .optional()
    .describe('Free-text search over the list. Same name on every list tool.'),
  filter: listFilterSchema.describe(
    'Structured filters. Keys: section, label, assignee, status, updated_since, has_pr.',
  ),
  sort: z
    .string()
    .min(1)
    .optional()
    .describe('Sort as field or field:asc|desc, for example updatedAt:desc.'),
  fields: z
    .union([z.string().min(1), z.array(z.string().min(1))])
    .optional()
    .describe('Projection. Comma string or array, for example title,url.'),
  cursor: z
    .string()
    .min(1)
    .optional()
    .describe('Opaque cursor from the previous page. Prefer this over offset.'),
})
