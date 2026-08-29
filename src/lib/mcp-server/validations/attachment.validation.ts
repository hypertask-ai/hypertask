import { z } from 'zod';
import { hasUnpairedUtf16Surrogate } from '../../mcp/attachments/filename';
import { isAllowedMime, normalizeMime } from '../../mcp/attachments/constants';
import { MCP_ATTACHMENT_MAX_INLINE_BYTES } from '../../mcp/attachments/constants';
import { bufferMatchesDeclaredMime } from '../../mcp/attachments/magicBytes';
import {
  assertNoDuplicateValidatedFiles,
  decodeBase64Data,
  MCP_ATTACHMENT_MAX_BASE64_INPUT_CHARACTERS,
  type ValidatedFileSpec,
} from '../../mcp/attachments/validateBody';
import { createTaskIdentificationBaseSchema } from './common/task-identification';

const httpUrlString = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, { message: 'url must be a valid HTTP(S) URL without credentials' });

/**
 * Each file is either inline base64 or a URL for the server to ingest (fetched server-side).
 * Exactly one of `data` or `url` must be set.
 */
export const AttachmentFileSchema = z
  .object({
    filename: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .refine((name) => !hasUnpairedUtf16Surrogate(name), {
        message: 'filename must be valid Unicode',
      })
      .refine((name) => !name.includes('/') && !name.includes('\\') && !name.includes('..'), {
        message: 'filename must not contain path segments',
      }),
    content_type: z
      .string()
      .min(1)
      .max(128)
      .refine((value) => isAllowedMime(normalizeMime(value)), {
        message: 'content_type is not supported for attachments',
      }),
    data: z
      .string()
      .min(1)
      .max(MCP_ATTACHMENT_MAX_BASE64_INPUT_CHARACTERS)
      .optional()
      .describe('Base64-encoded raw file bytes (not data URLs)'),
    url: httpUrlString.optional().describe('HTTP(S) URL of the file; backend may fetch and store'),
  })
  .strict()
  .superRefine((o, ctx) => {
    const hasData = o.data !== undefined && o.data.length > 0;
    const hasUrl = o.url !== undefined && o.url.length > 0;
    if (hasData && hasUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide only one of: data (base64) or url',
        path: ['data'],
      });
    } else if (!hasData && !hasUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide data (base64) or url',
        path: ['data'],
      });
    } else if (hasData) {
      try {
        const buffer = decodeBase64Data(o.data!, 0);
        if (!bufferMatchesDeclaredMime(buffer, normalizeMime(o.content_type))) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'data does not match content_type',
            path: ['data'],
          });
        }
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: error instanceof Error ? error.message : 'data is not valid base64',
          path: ['data'],
        });
      }
    }
  });

export const attachmentFilesSchema = z
  .array(AttachmentFileSchema)
  .min(1)
  .max(10)
  .superRefine((files, ctx) => {
    const totalInlineInputCharacters = files.reduce(
      (total, file) => total + (file.data?.length ?? 0),
      0
    );
    if (totalInlineInputCharacters > MCP_ATTACHMENT_MAX_BASE64_INPUT_CHARACTERS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Total inline attachment input must be ${MCP_ATTACHMENT_MAX_BASE64_INPUT_CHARACTERS} characters or less; use url for larger files`,
        path: ['data'],
      });
    }
    const totalInlineBytes = files.reduce((total, file, index) => {
      if (file.data === undefined) return total;
      try {
        return total + decodeBase64Data(file.data, index).length;
      } catch {
        return total;
      }
    }, 0);
    if (totalInlineBytes > MCP_ATTACHMENT_MAX_INLINE_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Total inline attachment data must be ${MCP_ATTACHMENT_MAX_INLINE_BYTES} decoded bytes or less; use url for larger files`,
        path: ['data'],
      });
    }

    try {
      const validatedFiles = files.map<ValidatedFileSpec>((file, index) => {
        const contentType = normalizeMime(file.content_type);
        if (file.data !== undefined && file.url === undefined) {
          return {
            kind: 'data',
            filename: file.filename,
            contentType,
            buffer: decodeBase64Data(file.data, index),
          };
        }
        if (file.url !== undefined && file.data === undefined) {
          return {
            kind: 'url',
            filename: file.filename,
            contentType,
            url: new URL(file.url).toString(),
          };
        }
        throw new Error('Attachment source is invalid');
      });
      assertNoDuplicateValidatedFiles(validatedFiles);
    } catch (error) {
      if (error instanceof Error && /duplicates files\[/.test(error.message)) {
        const duplicateIndex = Number(error.message.match(/^files\[(\d+)\]/)?.[1]);
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: error.message,
          path: Number.isInteger(duplicateIndex) ? [duplicateIndex] : [],
        });
      }
    }
  });

export const inlineAttachmentsSchema = attachmentFilesSchema
  .optional()
  .describe(
    `Files to attach after the operation succeeds. Each file needs filename, content_type, and exactly one of data (base64 bytes; ${MCP_ATTACHMENT_MAX_INLINE_BYTES} decoded bytes total) or url (HTTP(S), for files up to 15 MB).`
  );

/**
 * Base input for attach_files MCP tool (ZodObject only — FastMCP cannot register ZodEffects as parameters).
 * Full validation with refines: use AttachFilesInputSchema.parse() in execute and in AttachmentService.
 */
export function getAttachFilesBaseSchema() {
  return createTaskIdentificationBaseSchema()
    .extend({
      // z.coerce: agents sometimes send comment_id as a string (HTPR-3099 MCP)
      comment_id: z.coerce.number().int().positive().optional(),
      files: attachmentFilesSchema,
    })
    .strict();
}

/**
 * POST /mcp/tasks/attachments — identify task + optional comment + one or more files.
 */
export const AttachFilesInputSchema = getAttachFilesBaseSchema()
  .refine(
    (data) => {
      const hasTaskId = data.task_id !== undefined;
      const hasTicket = data.ticket_number !== undefined;
      const hasUnique = data.unique_index !== undefined && data.project_id !== undefined;
      return hasTaskId || hasTicket || hasUnique;
    },
    { message: 'Provide task_id, ticket_number, or (project_id + unique_index)', path: ['ticket_number'] }
  )
  .refine(
    (data) =>
      data.project_id === undefined ||
      data.unique_index !== undefined ||
      data.ticket_number !== undefined,
    {
      message: 'project_id is only valid with ticket_number or unique_index',
      path: ['project_id'],
    }
  )
  .refine(
    (data) => {
      const methods = [
        data.task_id !== undefined,
        data.ticket_number !== undefined,
        data.unique_index !== undefined,
      ].filter(Boolean).length;
      return methods === 1;
    },
    {
      message: 'Use only one of task_id, ticket_number, or (project_id + unique_index)',
      path: ['ticket_number'],
    }
  );

export type AttachFilesInput = z.infer<typeof AttachFilesInputSchema>;
export type AttachmentFileInput = z.infer<typeof AttachmentFileSchema>;
