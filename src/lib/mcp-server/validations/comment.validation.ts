/**
 * Comment-related validation schemas
 * 
 * Validations for: add_comment, get_comments
 */

import { z } from 'zod';
import { getConfig } from '../config/index';
import {
  createTaskIdentificationBaseSchema,
} from './common/task-identification';
import { paginationSchema, sortOrderSchema } from './common/pagination';
import { inlineAttachmentsSchema } from './attachment.validation';
import { hasMarkdownStructure } from '../../../utils/helperFunctions/markdownToHtml';

const config = getConfig();

const commentContentTypeSchema = z
  .enum(['html', 'markdown'])
  .optional()
  .describe('Input format for text. Defaults to HTML.');

const replyToCommentIdSchema = z.coerce
  .number()
  .int()
  .safe()
  .positive('reply_to_comment_id must be a positive integer')
  .optional()
  .describe('For agent replies, the comment ID that invoked the agent. This routes the answer to the requester\'s Important inbox.');

const replyToInvocationIdSchema = z.coerce
  .number()
  .int()
  .safe()
  .positive('reply_to_invocation_id must be a positive integer')
  .optional()
  .describe('For agent replies, the agent Mentioned notification ID that invoked the agent. Use this when the mention was in the task description, which has no comment ID. Routes the answer to the requester\'s Important inbox.');

/**
 * Schema for a single mention in add_comment
 * Required when text contains @DisplayName - resolves to user_id for notifications
 */
export const mentionSchema = z.object({
  user_id: z.coerce.number().int().positive('user_id must be a positive integer'),
  display_name: z.string().min(1, 'display_name cannot be empty'),
});

export type MentionInput = z.infer<typeof mentionSchema>;

/**
 * Schema for add_comment tool input
 * Validates task identification and comment text
 */
export function getAddCommentInputSchema() {
  const baseSchema = createTaskIdentificationBaseSchema().extend({
    text: z
      .string()
      .min(1, 'Comment text cannot be empty')
      .max(config.limits.commentTextMaxLength, `Comment text cannot exceed ${config.limits.commentTextMaxLength} characters`)
      .describe('Comment text. HTML or structural markdown; content_type can explicitly select either format. Use @DisplayName with matching mentions entries.'),
    content_type: commentContentTypeSchema,
    mentions: z
      .array(mentionSchema)
      .optional()
      .describe('Required when text contains @mentions. Resolve each @DisplayName via list_project_members, then include { user_id, display_name } for each. Use longest match first (e.g. prefer "John Doe" over "John" when both exist).'),
    attachments: inlineAttachmentsSchema,
    reply_to_comment_id: replyToCommentIdSchema,
    reply_to_invocation_id: replyToInvocationIdSchema,
  }).strict();

  return baseSchema
    .refine(
      (data) =>
        data.reply_to_comment_id === undefined ||
        data.reply_to_invocation_id === undefined,
      {
        message: 'Provide either reply_to_comment_id or reply_to_invocation_id, not both',
        path: ['reply_to_invocation_id'],
      }
    )
    .refine(
      (data) => isAcceptedRichText(data.text, data.content_type),
      {
        message: 'Comment text must be HTML or structural markdown such as a list, emphasis, code, or link. Plain text is not accepted.',
        path: ['text'],
      }
    )
    .refine(
      (data) => {
        const hasTaskId = data.task_id !== undefined;
        const hasTicketNumber = data.ticket_number !== undefined;
        const hasUniqueIndex = data.unique_index !== undefined && data.project_id !== undefined;
        return hasTaskId || hasTicketNumber || hasUniqueIndex;
      },
      {
        message: 'Either task_id, ticket_number, or (project_id + unique_index) must be provided',
        path: ['task_id', 'ticket_number', 'unique_index'],
      }
    )
    .refine(
      (data) => {
        const hasTaskId = data.task_id !== undefined;
        const hasTicketNumber = data.ticket_number !== undefined;
        const hasUniqueIndex = data.unique_index !== undefined;
        const methodCount = [hasTaskId, hasTicketNumber, hasUniqueIndex].filter(Boolean).length;
        return methodCount === 1;
      },
      {
        message: 'Cannot provide multiple identification methods. Use either task_id, ticket_number, or (project_id + unique_index), but not multiple.',
        path: ['task_id', 'ticket_number', 'unique_index'],
      }
    )
    .refine(
      (data) => {
        if (data.unique_index !== undefined) {
          return data.project_id !== undefined;
        }
        return true;
      },
      {
        message: 'project_id is required when using unique_index',
        path: ['project_id'],
      }
    );
}

export const AddCommentInputSchema = getAddCommentInputSchema();
export type AddCommentInput = z.infer<typeof AddCommentInputSchema>;

/**
 * Schema for update_comment tool input.
 */
export function getUpdateCommentBaseSchema() {
  return z
    .object({
      comment_id: z.coerce
        .number()
        .int()
        .positive('comment_id must be a positive integer'),
      text: z
        .string()
        .trim()
        .min(1, 'Comment text cannot be empty')
        .max(5000, 'Comment text cannot exceed 5000 characters'),
      content_type: commentContentTypeSchema,
      mentions: z.array(mentionSchema).optional(),
    })
    .strict();
}

export const UpdateCommentInputSchema = getUpdateCommentBaseSchema();
export type UpdateCommentInput = z.infer<typeof UpdateCommentInputSchema>;

/**
 * Schema for delete_comment tool input.
 */
export function getDeleteCommentBaseSchema() {
  return z
    .object({
      comment_id: z.coerce
        .number()
        .int()
        .positive('comment_id must be a positive integer'),
    })
    .strict();
}

export const DeleteCommentInputSchema = getDeleteCommentBaseSchema();
export type DeleteCommentInput = z.infer<typeof DeleteCommentInputSchema>;

/**
 * Base schema for add_comment tool (without refine validation)
 * Used for FastMCP parameter validation, refine is checked in execute
 */
export function getAddCommentBaseSchema() {
  return createTaskIdentificationBaseSchema()
    .extend({
      text: z
        .string()
        .min(1, 'Comment text cannot be empty')
        .max(config.limits.commentTextMaxLength, `Comment text cannot exceed ${config.limits.commentTextMaxLength} characters`)
        .describe('Comment text. HTML or structural markdown; content_type can explicitly select either format. Use @DisplayName with matching mentions entries.'),
      content_type: commentContentTypeSchema,
      mentions: z
        .array(mentionSchema)
        .optional()
        .describe('Required when text contains @mentions. Resolve each @DisplayName via list_project_members, then include { user_id, display_name } for each. Use longest match first (e.g. prefer "John Doe" over "John" when both exist).'),
      attachments: inlineAttachmentsSchema,
      reply_to_comment_id: replyToCommentIdSchema,
      reply_to_invocation_id: replyToInvocationIdSchema,
    })
    .strict();
}

/**
 * Check if text appears to be HTML format
 * Simple heuristic: checks for HTML tags
 */
function isHtmlFormat(text: string): boolean {
  if (!text || typeof text !== 'string') {
    return false;
  }
  
  // Check for HTML tags (basic pattern)
  const htmlTagPattern = /<[a-z][\s\S]*>/i;
  return htmlTagPattern.test(text.trim());
}

function isAcceptedRichText(
  text: string,
  contentType?: 'html' | 'markdown'
): boolean {
  return (
    contentType === 'markdown' ||
    isHtmlFormat(text) ||
    (contentType === undefined && hasMarkdownStructure(text))
  );
}

/**
 * Sanitize comment text input
 * - Strip leading/trailing whitespace
 * - Normalize line endings
 */
export function sanitizeCommentText(text: string): string {
  return text.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Validate and sanitize add_comment input
 */
export function validateAndSanitizeAddCommentInput(input: unknown): AddCommentInput {
  // First validate with Zod
  const validated = AddCommentInputSchema.parse(input);

  // Then sanitize the text field
  return {
    ...validated,
    text: sanitizeCommentText(validated.text),
  };
}

/**
 * Base schema for get_comments tool (without refine validation)
 * Used for FastMCP parameter validation
 */
export function getGetCommentsBaseSchema() {
  return createTaskIdentificationBaseSchema()
    .merge(paginationSchema)
    .extend({
      sort_order: sortOrderSchema,
      include_activity: z
        .boolean()
        .default(false)
        .describe('Include task activity history such as label, move, assignment, and priority changes. Defaults to false.'),
    })
    .strict();
}

/**
 * Schema for get_comments tool input (with refine validation)
 * Either task_id or ticket_number must be provided
 */
export function getGetCommentsInputSchema() {
  const baseSchema = createTaskIdentificationBaseSchema()
    .merge(paginationSchema)
    .extend({
      sort_order: sortOrderSchema,
      include_activity: z
        .boolean()
        .default(false)
        .describe('Include task activity history such as label, move, assignment, and priority changes. Defaults to false.'),
    })
    .strict();

  return baseSchema
    .refine(
      (data) => {
        const hasTaskId = data.task_id !== undefined;
        const hasTicketNumber = data.ticket_number !== undefined;
        const hasUniqueIndex = data.unique_index !== undefined && data.project_id !== undefined;
        return hasTaskId || hasTicketNumber || hasUniqueIndex;
      },
      {
        message: 'Either task_id, ticket_number, or (project_id + unique_index) must be provided',
        path: ['task_id', 'ticket_number', 'unique_index'],
      }
    )
    .refine(
      (data) => {
        const hasTaskId = data.task_id !== undefined;
        const hasTicketNumber = data.ticket_number !== undefined;
        const hasUniqueIndex = data.unique_index !== undefined;
        const methodCount = [hasTaskId, hasTicketNumber, hasUniqueIndex].filter(Boolean).length;
        return methodCount === 1;
      },
      {
        message: 'Cannot provide multiple identification methods. Use either task_id, ticket_number, or (project_id + unique_index), but not multiple.',
        path: ['task_id', 'ticket_number', 'unique_index'],
      }
    )
    .refine(
      (data) => {
        if (data.unique_index !== undefined) {
          return data.project_id !== undefined;
        }
        return true;
      },
      {
        message: 'project_id is required when using unique_index',
        path: ['project_id'],
      }
    );
}

export const GetCommentsInputSchema = getGetCommentsInputSchema();
export type GetCommentsInput = z.infer<typeof GetCommentsInputSchema>;

/**
 * Base schema for add_comment tool (without superRefine)
 * Used for FastMCP parameter validation - must be ZodObject for tool registration
 */
export function getAddCommentCrudBaseSchema() {
  return createTaskIdentificationBaseSchema()
    .extend({
      action: z
        .enum(['add', 'update', 'delete'])
        .default('add')
        .describe(
          "Operation: 'add' = create comment (requires task_id/ticket_number + text), 'update' = edit comment (requires comment_id + text), 'delete' = remove comment (requires comment_id only)"
        ),
      comment_id: z
        .coerce.number()
        .int()
        .positive('comment_id must be a positive integer')
        .optional()
        .describe('Comment ID. Required for update and delete. Obtain from get_comments_for_task.'),
      text: z
        .string()
        .max(config.limits.commentTextMaxLength, `Comment text cannot exceed ${config.limits.commentTextMaxLength} characters`)
        .optional()
        .describe('Comment text for add/update. HTML or structural markdown; content_type can explicitly select either format.'),
      content_type: commentContentTypeSchema,
      mentions: z
        .array(mentionSchema)
        .optional()
        .describe('Required when text contains @mentions. Resolve via list_project_members, then include { user_id, display_name } for each.'),
      attachments: inlineAttachmentsSchema,
      reply_to_comment_id: replyToCommentIdSchema,
      reply_to_invocation_id: replyToInvocationIdSchema,
    })
    .strict();
}

/**
 * Add comment CRUD input schema with action-based validation (superRefine)
 * Used in execute for full validation
 */
export function getAddCommentCrudInputSchema() {
  return getAddCommentCrudBaseSchema().superRefine((data, ctx) => {
      const { action, task_id, ticket_number, project_id, unique_index, comment_id, text, content_type, attachments, reply_to_comment_id, reply_to_invocation_id } = data;

      if (action === 'delete' && content_type !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'content_type is not supported when action is delete',
          path: ['content_type'],
        });
      }

      if (action !== 'add' && attachments !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'attachments are only supported when action is add',
          path: ['attachments'],
        });
      }

      if (action !== 'add' && reply_to_comment_id !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'reply_to_comment_id is only supported when action is add',
          path: ['reply_to_comment_id'],
        });
      }

      if (action !== 'add' && reply_to_invocation_id !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'reply_to_invocation_id is only supported when action is add',
          path: ['reply_to_invocation_id'],
        });
      }

      if (reply_to_comment_id !== undefined && reply_to_invocation_id !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Provide either reply_to_comment_id or reply_to_invocation_id, not both',
          path: ['reply_to_invocation_id'],
        });
      }

      if (action === 'add') {
        const hasTaskId = task_id !== undefined;
        const hasTicketNumber = ticket_number !== undefined;
        const hasUniqueIndex = unique_index !== undefined && project_id !== undefined;
        if (!hasTaskId && !hasTicketNumber && !hasUniqueIndex) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'For action add: provide task_id, ticket_number, or (project_id + unique_index)',
            path: ['task_id'],
          });
        }
        const methodCount = [hasTaskId, hasTicketNumber, hasUniqueIndex].filter(Boolean).length;
        if (methodCount > 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'For action add: use only one of task_id, ticket_number, or (project_id + unique_index)',
            path: ['task_id'],
          });
        }
        if (unique_index !== undefined && project_id === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'project_id is required when using unique_index',
            path: ['project_id'],
          });
        }
        if (!text || text.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'For action add: text is required',
            path: ['text'],
          });
        } else if (!isAcceptedRichText(text, content_type)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Comment text must be HTML or structural markdown such as a list, emphasis, code, or link.',
            path: ['text'],
          });
        }
      }

      if (action === 'update') {
        if (comment_id === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'For action update: comment_id is required',
            path: ['comment_id'],
          });
        }
        if (!text || text.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'For action update: text is required',
            path: ['text'],
          });
        } else if (!isAcceptedRichText(text, content_type)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Comment text must be HTML or structural markdown such as a list, emphasis, code, or link.',
            path: ['text'],
          });
        }
      }

      if (action === 'delete') {
        if (comment_id === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'For action delete: comment_id is required',
            path: ['comment_id'],
          });
        }
      }
    });
}

export const AddCommentCrudInputSchema = getAddCommentCrudInputSchema();
export type AddCommentCrudInput = z.infer<typeof AddCommentCrudInputSchema>;

/**
 * Validate and sanitize add_comment CRUD input
 * Returns validated input for the appropriate action
 */
export function validateAndSanitizeAddCommentCrudInput(input: unknown): AddCommentCrudInput {
  const validated = AddCommentCrudInputSchema.parse(input);

  if (validated.action === 'add' || validated.action === 'update') {
    return {
      ...validated,
      text: sanitizeCommentText(validated.text!),
    };
  }

  return validated;
}
