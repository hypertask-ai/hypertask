
import { z } from 'zod';
import { getConfig } from '../config/index';
import {
  createTaskIdentificationBaseSchema,
} from './common/task-identification';
import { paginationSchema, sortOrderSchema } from './common/pagination';
import { withListQuerySchema } from './common/listQuery';
import { inlineAttachmentsSchema } from './attachment.validation';

const config = getConfig();

const commentKindSchema = z.enum(['question', 'qa', 'done']).optional()
  .describe('question for a decision by a person, qa for a QA verdict, done for the closing summary; leave out for progress notes, which go to the agent log');

const hasAttachmentsSchema = z.boolean().optional()
  .describe('Set true when files will be attached after creation so an agent post stays a comment instead of going to the agent log');

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

export const mentionSchema = z.object({
  user_id: z.coerce.number().int().positive('user_id must be a positive integer'),
  display_name: z.string().min(1, 'display_name cannot be empty'),
});

export type MentionInput = z.infer<typeof mentionSchema>;

export function getAddCommentInputSchema() {
  const baseSchema = createTaskIdentificationBaseSchema().extend({
    text: z
      .string()
      .trim()
      .min(1, 'Comment text cannot be empty')
      .max(config.limits.commentTextMaxLength, `Comment text cannot exceed ${config.limits.commentTextMaxLength} characters`)
      .describe('Comment text. HTML or structural markdown; content_type can explicitly select either format. Use @DisplayName with matching mentions entries.'),
    content_type: commentContentTypeSchema,
    mentions: z
      .array(mentionSchema)
      .optional()
      .describe('Required when text contains @mentions. Resolve each @DisplayName via list_project_members, then include { user_id, display_name } for each. Use longest match first (e.g. prefer "John Doe" over "John" when both exist).'),
    attachments: inlineAttachmentsSchema,
    kind: commentKindSchema,
    has_attachments: hasAttachmentsSchema,
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

export function getAddCommentBaseSchema() {
  return createTaskIdentificationBaseSchema()
    .extend({
      text: z
        .string()
        .trim()
        .min(1, 'Comment text cannot be empty')
        .max(config.limits.commentTextMaxLength, `Comment text cannot exceed ${config.limits.commentTextMaxLength} characters`)
        .describe('Comment text. HTML or structural markdown; content_type can explicitly select either format. Use @DisplayName with matching mentions entries.'),
      content_type: commentContentTypeSchema,
      mentions: z
        .array(mentionSchema)
        .optional()
        .describe('Required when text contains @mentions. Resolve each @DisplayName via list_project_members, then include { user_id, display_name } for each. Use longest match first (e.g. prefer "John Doe" over "John" when both exist).'),
      attachments: inlineAttachmentsSchema,
      kind: commentKindSchema,
      has_attachments: hasAttachmentsSchema,
      reply_to_comment_id: replyToCommentIdSchema,
      reply_to_invocation_id: replyToInvocationIdSchema,
    })
    .strict();
}

export function sanitizeCommentText(text: string): string {
  return text.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function validateAndSanitizeAddCommentInput(input: unknown): AddCommentInput {
  const validated = AddCommentInputSchema.parse(input);

  return {
    ...validated,
    text: sanitizeCommentText(validated.text),
  };
}

export function getGetCommentsBaseSchema() {
  return withListQuerySchema(
    createTaskIdentificationBaseSchema().merge(paginationSchema),
  )
    .extend({
      sort_order: sortOrderSchema,
      include_activity: z
        .boolean()
        .default(false)
        .describe('Include task activity history such as label, move, assignment, and priority changes. Defaults to false.'),
    })
    .strict();
}

export function getGetCommentsInputSchema() {
  const baseSchema = getGetCommentsBaseSchema();

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
        .trim()
        .min(1, 'Comment text cannot be empty')
        .max(config.limits.commentTextMaxLength, `Comment text cannot exceed ${config.limits.commentTextMaxLength} characters`)
        .optional()
        .describe('Comment text for add/update. HTML or structural markdown; content_type can explicitly select either format.'),
      content_type: commentContentTypeSchema,
      mentions: z
        .array(mentionSchema)
        .optional()
        .describe('Required when text contains @mentions. Resolve via list_project_members, then include { user_id, display_name } for each.'),
      attachments: inlineAttachmentsSchema,
      kind: commentKindSchema,
      has_attachments: hasAttachmentsSchema,
      reply_to_comment_id: replyToCommentIdSchema,
      reply_to_invocation_id: replyToInvocationIdSchema,
    })
    .strict();
}

export function getAddCommentCrudInputSchema() {
  return getAddCommentCrudBaseSchema().superRefine((data, ctx) => {
      const { kind, has_attachments, action, task_id, ticket_number, project_id, unique_index, comment_id, text, content_type, attachments, reply_to_comment_id, reply_to_invocation_id } = data;

      if (action !== 'add' && has_attachments !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'has_attachments is only supported when action is add', path: ['has_attachments'] });
      }

      if (action !== 'add' && kind !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'kind is only supported when action is add', path: ['kind'] });
      }

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
