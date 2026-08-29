/**
 * Page-related validation schemas
 *
 * Validations for: create_page, get_page, update_page, list_pages, search_pages
 */

import { z } from 'zod';
import {
  createTaskIdentificationBaseSchema,
  ticketNumberSchema,
} from './common/task-identification';

const PAGE_CONTENT_MAX_LENGTH = 100_000;
const PAGE_TITLE_MAX_LENGTH = 500;
const PAGE_NOTE_MAX_LENGTH = 1_000;
const PAGE_SEARCH_QUERY_MAX_LENGTH = 200;

const pageIdentifierSchema = z.union([
  z.coerce.number().int().positive('id must be a positive integer or page publicId'),
  z.string().trim().min(1, 'id cannot be empty').max(100, 'id cannot exceed 100 characters'),
]);
type PageIdentifier = z.infer<typeof pageIdentifierSchema>;

const pageIdentifierFields = {
  id: pageIdentifierSchema.optional(),
  page_id: pageIdentifierSchema.optional(),
};

function validatePageIdentifierAlias(
  data: { id?: PageIdentifier; page_id?: PageIdentifier },
  ctx: z.RefinementCtx
) {
  if (data.id === undefined && data.page_id === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provide page_id or id; both field names are accepted',
      path: ['page_id'],
    });
  } else if (
    data.id !== undefined &&
    data.page_id !== undefined &&
    data.id !== data.page_id
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'page_id and id must identify the same page when both are provided',
      path: ['page_id', 'id'],
    });
  }
}

function normalizePageIdentifierAlias<
  T extends { id?: PageIdentifier; page_id?: PageIdentifier },
>(data: T): Omit<T, 'id' | 'page_id'> & { id: PageIdentifier } {
  const { id, page_id, ...rest } = data;
  return {
    ...rest,
    id: id ?? page_id!,
  };
}

const pageContentTypeSchema = z.enum(['markdown', 'html']).default('markdown');

/**
 * Schema for create_page tool input
 */
export function getCreatePageInputSchema() {
  return createTaskIdentificationBaseSchema()
    .extend({
      title: z
        .string()
        .max(PAGE_TITLE_MAX_LENGTH, `title cannot exceed ${PAGE_TITLE_MAX_LENGTH} characters`)
        .optional(),
      content: z
        .string()
        .max(PAGE_CONTENT_MAX_LENGTH, `content cannot exceed ${PAGE_CONTENT_MAX_LENGTH} characters`),
      content_type: pageContentTypeSchema,
      parent_page_id: z.coerce
        .number()
        .int()
        .positive('parent_page_id must be a positive integer')
        .optional(),
    })
    .strict()
    .refine(
      (data) => {
        const methodCount = [
          data.task_id !== undefined,
          data.ticket_number !== undefined,
          data.unique_index !== undefined,
        ].filter(Boolean).length;
        return methodCount === 1;
      },
      {
        message: 'Provide exactly one of task_id, ticket_number, or (project_id + unique_index)',
        path: ['task_id', 'ticket_number', 'unique_index'],
      }
    )
    .refine(
      (data) => data.unique_index === undefined || data.project_id !== undefined,
      {
        message: 'project_id is required when using unique_index',
        path: ['project_id'],
      }
    );
}

export const CreatePageInputSchema = getCreatePageInputSchema();
export type CreatePageInput = z.infer<typeof CreatePageInputSchema>;

/**
 * Schema for get_page tool input
 */
export function getGetPageInputSchema() {
  return getGetPageBaseSchema()
    .superRefine(validatePageIdentifierAlias)
    .transform(normalizePageIdentifierAlias);
}

export function getGetPageBaseSchema() {
  return z
    .object({
      ...pageIdentifierFields,
      format: z.enum(['markdown', 'html']).default('markdown'),
    })
    .strict();
}

export const GetPageInputSchema = getGetPageInputSchema();
export type GetPageInput = z.infer<typeof GetPageInputSchema>;

/**
 * Schema for update_page tool input
 */
export function getUpdatePageInputSchema() {
  return getUpdatePageBaseSchema()
    .superRefine((data, ctx) => {
      if (data.title === undefined && data.content === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Provide title or content',
          path: ['title'],
        });
      }
    })
    .superRefine(validatePageIdentifierAlias)
    .transform(normalizePageIdentifierAlias);
}

export function getUpdatePageBaseSchema() {
  return z
    .object({
      ...pageIdentifierFields,
      title: z
        .string()
        .trim()
        .min(1, 'title cannot be empty')
        .max(PAGE_TITLE_MAX_LENGTH, `title cannot exceed ${PAGE_TITLE_MAX_LENGTH} characters`)
        .optional(),
      content: z
        .string()
        .max(PAGE_CONTENT_MAX_LENGTH, `content cannot exceed ${PAGE_CONTENT_MAX_LENGTH} characters`)
        .optional(),
      content_type: pageContentTypeSchema,
      mode: z.enum(['replace', 'append', 'prepend']).default('replace'),
      if_version: z.coerce
        .number()
        .int()
        .positive('if_version must be a positive integer')
        .optional(),
      note: z
        .string()
        .max(PAGE_NOTE_MAX_LENGTH, `note cannot exceed ${PAGE_NOTE_MAX_LENGTH} characters`)
        .optional(),
    })
    .strict();
}

export const UpdatePageInputSchema = getUpdatePageInputSchema();
export type UpdatePageInput = z.infer<typeof UpdatePageInputSchema>;

/**
 * Schema for list_pages tool input
 * Exactly one task identifier or project_id must be provided.
 */
export function getListPagesInputSchema() {
  return z
    .object({
      task_id: z.coerce.number().int().positive('task_id must be a positive integer').optional(),
      ticket_number: ticketNumberSchema.optional(),
      unique_index: z.coerce.number().int().positive('unique_index must be a positive integer').optional(),
      project_id: z.coerce.number().int().positive('project_id must be a positive integer').optional(),
    })
    .strict()
    .refine(
      (data) => {
        const hasTaskIdentifier =
          data.task_id !== undefined ||
          data.ticket_number !== undefined ||
          data.unique_index !== undefined;
        const hasProjectIdentifier =
          data.project_id !== undefined && data.unique_index === undefined;
        return hasTaskIdentifier !== hasProjectIdentifier;
      },
      {
        message: 'Provide exactly one task identifier or project_id',
        path: ['task_id', 'ticket_number', 'unique_index', 'project_id'],
      }
    )
    .refine(
      (data) => {
        const methodCount = [
          data.task_id !== undefined,
          data.ticket_number !== undefined,
          data.unique_index !== undefined,
        ].filter(Boolean).length;
        return methodCount <= 1;
      },
      {
        message: 'Provide only one of task_id, ticket_number, or (project_id + unique_index)',
        path: ['task_id', 'ticket_number', 'unique_index'],
      }
    )
    .refine(
      (data) => data.unique_index === undefined || data.project_id !== undefined,
      {
        message: 'project_id is required when using unique_index',
        path: ['project_id'],
      }
    );
}

export const ListPagesInputSchema = getListPagesInputSchema();
export type ListPagesInput = z.infer<typeof ListPagesInputSchema>;

/**
 * Schema for search_pages tool input
 */
export function getSearchPagesInputSchema() {
  return z
    .object({
      query: z
        .string()
        .trim()
        .min(1, 'query cannot be empty')
        .max(
          PAGE_SEARCH_QUERY_MAX_LENGTH,
          `query cannot exceed ${PAGE_SEARCH_QUERY_MAX_LENGTH} characters`
        ),
    })
    .strict();
}

export const SearchPagesInputSchema = getSearchPagesInputSchema();
export type SearchPagesInput = z.infer<typeof SearchPagesInputSchema>;

/**
 * Base schema for page_history tool input.
 * FastMCP requires a plain Zod object for tool parameters.
 */
export function getPageHistoryBaseSchema() {
  return z
    .object({
      action: z.enum(['versions', 'restore', 'archive']),
      ...pageIdentifierFields,
      version_id: z.coerce
        .number()
        .int()
        .positive('version_id must be a positive integer')
        .optional()
        .describe('Required when action is restore.'),
    })
    .strict();
}

export function getPageHistoryInputSchema() {
  return getPageHistoryBaseSchema()
    .superRefine((data, ctx) => {
      validatePageIdentifierAlias(data, ctx);
      if (data.action === 'restore' && data.version_id === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'version_id is required for restore',
          path: ['version_id'],
        });
      }
    })
    .transform(normalizePageIdentifierAlias);
}

export const PageHistoryInputSchema = getPageHistoryInputSchema();
export type PageHistoryInput = z.infer<typeof PageHistoryInputSchema>;
