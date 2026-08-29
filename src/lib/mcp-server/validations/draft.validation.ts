import { z } from 'zod';
import { getConfig } from '../config/index';
import { createTaskIdentificationBaseSchema } from './common/task-identification';

const config = getConfig();

function isHtmlFormat(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  return /<[a-z][\s\S]*>/i.test(text.trim());
}

function sanitizeDraftText(text: string): string {
  return text.trim().replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export const draftTypeSchema = z
  .enum(['comment', 'description'])
  .default('description')
  .describe("Type of draft: 'comment' for a comment draft, 'description' for a description draft");

export function getCreateDraftInputSchema() {
  return createTaskIdentificationBaseSchema()
    .extend({
      draft_type: draftTypeSchema,
      text: z
        .string()
        .min(1, 'Draft text cannot be empty')
        .max(
          config.limits.commentTextMaxLength,
          `Draft text cannot exceed ${config.limits.commentTextMaxLength} characters`
        )
        .describe('Draft text. MUST be in HTML format (e.g., "<p>Text</p>" for paragraphs, "<br>" for line breaks).')
        .refine((text) => isHtmlFormat(text), {
          message:
            'Draft text must be in HTML format. Use HTML tags like <p>Text</p> for paragraphs or <br> for line breaks. Plain text is not accepted.',
        }),
    })
    .strict();
}

export const CreateDraftInputSchema = getCreateDraftInputSchema();
export type CreateDraftInput = z.infer<typeof CreateDraftInputSchema>;

export function getCreateDraftBaseSchema() {
  return createTaskIdentificationBaseSchema()
    .extend({
      draft_type: draftTypeSchema,
      text: z
        .string()
        .min(1, 'Draft text cannot be empty')
        .max(
          config.limits.commentTextMaxLength,
          `Draft text cannot exceed ${config.limits.commentTextMaxLength} characters`
        )
        .describe('Draft text. MUST be in HTML format (e.g., "<p>Text</p>" for paragraphs, "<br>" for line breaks).')
        .refine((text) => isHtmlFormat(text), {
          message:
            'Draft text must be in HTML format. Use HTML tags like <p>Text</p> for paragraphs or <br> for line breaks. Plain text is not accepted.',
        }),
    })
    .strict();
}

export function validateAndSanitizeCreateDraftInput(input: unknown): CreateDraftInput {
  const validated = CreateDraftInputSchema.parse(input);
  return { ...validated, text: sanitizeDraftText(validated.text) };
}

export function getListDraftsInputSchema() {
  return createTaskIdentificationBaseSchema()
    .strict()
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
        message:
          'Cannot provide multiple identification methods. Use either task_id, ticket_number, or (project_id + unique_index), but not multiple.',
        path: ['task_id', 'ticket_number', 'unique_index'],
      }
    )
    .refine(
      (data) => {
        if (data.unique_index !== undefined) return data.project_id !== undefined;
        return true;
      },
      {
        message: 'project_id is required when using unique_index',
        path: ['project_id'],
      }
    );
}

export const ListDraftsInputSchema = getListDraftsInputSchema();
export type ListDraftsInput = z.infer<typeof ListDraftsInputSchema>;

export function getListDraftsBaseSchema() {
  return createTaskIdentificationBaseSchema().strict();
}

export const updateDraftTextSchema = z
  .string()
  .min(1, 'Draft text cannot be empty')
  .max(
    config.limits.commentTextMaxLength,
    `Draft text cannot exceed ${config.limits.commentTextMaxLength} characters`
  )
  .describe('Updated draft text. MUST be in HTML format (e.g., "<p>Text</p>" for paragraphs, "<br>" for line breaks).')
  .refine((text) => isHtmlFormat(text), {
    message:
      'Draft text must be in HTML format. Use HTML tags like <p>Text</p> for paragraphs or <br> for line breaks. Plain text is not accepted.',
  });

export const updateDraftInputSchema = z
  .object({
    draft_id: z.coerce.number().int().positive('draft_id must be a positive integer'),
    text: updateDraftTextSchema,
  })
  .strict();

export type UpdateDraftInput = z.infer<typeof updateDraftInputSchema>;

export const updateDraftBaseSchema = z
  .object({
    draft_id: z.coerce.number().int().positive('draft_id must be a positive integer'),
    text: z
      .string()
      .min(1, 'Draft text cannot be empty')
      .max(
        config.limits.commentTextMaxLength,
        `Draft text cannot exceed ${config.limits.commentTextMaxLength} characters`
      )
      .describe('Updated draft text. MUST be in HTML format.'),
  })
  .strict();

export const publishDraftInputSchema = z
  .object({
    draft_id: z.coerce.number().int().positive('draft_id must be a positive integer'),
  })
  .strict();

export type PublishDraftInput = z.infer<typeof publishDraftInputSchema>;

export const deleteDraftInputSchema = z
  .object({
    draft_id: z.coerce.number().int().positive('draft_id must be a positive integer'),
  })
  .strict();

export type DeleteDraftInput = z.infer<typeof deleteDraftInputSchema>;

export function getDraftCrudBaseSchema() {
  return createTaskIdentificationBaseSchema()
    .extend({
      action: z
        .enum(['create', 'list', 'update', 'publish', 'delete'])
        .default('create')
        .describe(
          "Operation: 'create' (requires task_id/ticket_number + text + optional draft_type), 'list' (requires task_id/ticket_number), 'update' (requires draft_id + text), 'publish' (requires draft_id), 'delete' (requires draft_id)"
        ),
      draft_id: z
        .coerce.number()
        .int()
        .positive('draft_id must be a positive integer')
        .optional()
        .describe('Draft ID. Required for update, publish, and delete.'),
      draft_type: draftTypeSchema.optional(),
      text: z
        .string()
        .max(
          config.limits.commentTextMaxLength,
          `Draft text cannot exceed ${config.limits.commentTextMaxLength} characters`
        )
        .optional()
        .describe('Draft text. Required for create and update. MUST be HTML format.'),
    })
    .strict();
}

export function getDraftCrudInputSchema() {
  return getDraftCrudBaseSchema().superRefine((data, ctx) => {
    const { action, task_id, ticket_number, project_id, unique_index, draft_id, text } = data;

    if (action === 'create' || action === 'list') {
      const hasTaskId = task_id !== undefined;
      const hasTicketNumber = ticket_number !== undefined;
      const hasUniqueIndex = unique_index !== undefined && project_id !== undefined;
      if (!hasTaskId && !hasTicketNumber && !hasUniqueIndex) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `For action ${action}: provide task_id, ticket_number, or (project_id + unique_index)`,
          path: ['task_id'],
        });
      }
      const methodCount = [hasTaskId, hasTicketNumber, hasUniqueIndex].filter(Boolean).length;
      if (methodCount > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `For action ${action}: use only one of task_id, ticket_number, or (project_id + unique_index)`,
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
    }

    if (action === 'create') {
      if (!text || text.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'For action create: text is required',
          path: ['text'],
        });
      } else if (!isHtmlFormat(text)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Draft text must be in HTML format. Use <p>Text</p> or <br> for line breaks.',
          path: ['text'],
        });
      }
    }

    if (action === 'update') {
      if (draft_id === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'For action update: draft_id is required',
          path: ['draft_id'],
        });
      }
      if (!text || text.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'For action update: text is required',
          path: ['text'],
        });
      } else if (!isHtmlFormat(text)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Draft text must be in HTML format. Use <p>Text</p> or <br> for line breaks.',
          path: ['text'],
        });
      }
    }

    if (action === 'publish' || action === 'delete') {
      if (draft_id === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `For action ${action}: draft_id is required`,
          path: ['draft_id'],
        });
      }
    }
  });
}

export const DraftCrudInputSchema = getDraftCrudInputSchema();
export type DraftCrudInput = z.infer<typeof DraftCrudInputSchema>;

export function validateAndSanitizeDraftCrudInput(input: unknown): DraftCrudInput {
  const validated = DraftCrudInputSchema.parse(input);
  if (validated.action === 'create' || validated.action === 'update') {
    return { ...validated, text: sanitizeDraftText(validated.text!) };
  }
  return validated;
}
