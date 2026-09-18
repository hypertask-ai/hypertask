/**
 * Shared MCP tool input fields for list/search (HTPR-6530).
 * Same names on every list tool: query, filter, sort, fields, limit, cursor.
 * Merge these only when the caller has htpr-6530-mcp-list-query.
 */

import { z } from 'zod'
import { HAS_PR_VALUES, type HasPrValue } from '@/lib/mcp/listQuery'

export type ListQuerySchemaOptions = {
  listQuery?: boolean
}

export const listFilterSchema = z
  .object({
    section: z.string().min(1).optional(),
    label: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
    assignee: z.union([z.string().min(1), z.number().int()]).optional(),
    status: z.string().min(1).optional(),
    updated_since: z
      .string()
      .min(1)
      .refine((value) => !Number.isNaN(Date.parse(value)), {
        message: 'updated_since must be an ISO datetime',
      })
      .optional(),
    has_pr: z
      .enum(HAS_PR_VALUES as unknown as [HasPrValue, ...HasPrValue[]])
      .optional(),
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

type ListQueryFieldShape = typeof listQueryToolSchema.shape

export type SchemaWithListQuery<T extends z.ZodObject<z.ZodRawShape>> = z.ZodObject<
  T['shape'] & ListQueryFieldShape
>

export function withListQuerySchema<T extends z.ZodObject<z.ZodRawShape>>(
  schema: T,
  options: { listQuery: true },
  extras?: { omitQuery?: boolean },
): SchemaWithListQuery<T>
export function withListQuerySchema<T extends z.ZodObject<z.ZodRawShape>>(
  schema: T,
  options?: ListQuerySchemaOptions,
  extras?: { omitQuery?: boolean },
): T
export function withListQuerySchema<T extends z.ZodObject<z.ZodRawShape>>(
  schema: T,
  options?: ListQuerySchemaOptions,
  extras: { omitQuery?: boolean } = {},
): T | SchemaWithListQuery<T> {
  if (!options?.listQuery) return schema
  const extra = extras.omitQuery
    ? listQueryToolSchema.omit({ query: true })
    : listQueryToolSchema
  return schema.merge(extra) as SchemaWithListQuery<T>
}
