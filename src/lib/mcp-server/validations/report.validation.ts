
import { z } from 'zod';

import {
  REPORT_BODY_MAX,
  REPORT_CAPABILITIES,
  REPORT_SLUG_RE,
} from '@/utils/controllers/reports/reportService';

const REPORT_SLUG_MAX_LENGTH = 64;
const REPORT_TITLE_MAX_LENGTH = 200;

const projectIdSchema = z.coerce
  .number()
  .int()
  .positive('project_id must be a positive integer');
const slugSchema = z
  .string()
  .max(
    REPORT_SLUG_MAX_LENGTH,
    `slug cannot exceed ${REPORT_SLUG_MAX_LENGTH} characters`
  )
  .regex(
    REPORT_SLUG_RE,
    'slug must contain only lowercase letters, numbers, and single dashes'
  );
const titleSchema = z
  .string()
  .trim()
  .min(1, 'title cannot be empty')
  .max(
    REPORT_TITLE_MAX_LENGTH,
    `title cannot exceed ${REPORT_TITLE_MAX_LENGTH} characters`
  );
const bodyHtmlSchema = z.string().max(
  REPORT_BODY_MAX,
  `body_html cannot exceed ${REPORT_BODY_MAX} characters. ${REPORT_CAPABILITIES}`
);

export function getReportCrudBaseSchema() {
  return z
    .object({
      action: z.enum(['list', 'get', 'velocity', 'create', 'update', 'delete']),
      range: z.string().max(8).optional(),
      project_id: projectIdSchema.optional(),
      slug: slugSchema.optional(),
      title: titleSchema.optional(),
      description: z.string().nullable().optional(),
      body_html: bodyHtmlSchema.optional(),
    })
    .strict();
}

export function getReportCrudInputSchema() {
  return getReportCrudBaseSchema().superRefine((data, ctx) => {
    if (data.project_id === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'project_id is required for all actions',
        path: ['project_id'],
      });
    }

    if (
      data.action !== 'list' &&
      data.action !== 'velocity' &&
      data.slug === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'slug is required for get, create, update, and delete',
        path: ['slug'],
      });
    }

    if (data.action === 'create' && data.title === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'title is required for create',
        path: ['title'],
      });
    }

    if (data.action === 'create' && data.body_html === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `body_html is required for create. ${REPORT_CAPABILITIES}`,
        path: ['body_html'],
      });
    }

    if (
      data.action === 'update' &&
      data.title === undefined &&
      data.description === undefined &&
      data.body_html === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one of title, description, or body_html is required for update',
        path: ['title'],
      });
    }
  });
}

export const ReportCrudInputSchema = getReportCrudInputSchema();
export type ReportCrudInput = z.infer<ReturnType<typeof getReportCrudBaseSchema>>;
