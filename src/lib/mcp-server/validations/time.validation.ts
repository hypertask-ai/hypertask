import { z } from 'zod';

export const TimeActionSchema = z.enum(['start', 'stop', 'status', 'running', 'report', 'log']);

export function getTimeTaskBaseSchema() {
  return z
    .object({
      task: z
        .string()
        .trim()
        .min(1)
        .describe('task id, unique index, or ticket id'),
    })
    .strict();
}

export const TimeTaskInputSchema = getTimeTaskBaseSchema();
export type TimeTaskInput = z.infer<typeof TimeTaskInputSchema>;

export function getTimeBaseSchema() {
  return z
    .object({
      action: TimeActionSchema,
      task: z
        .string()
        .optional()
        .describe('task id, unique index, or ticket id (required for start/stop/status/log)'),
      minutes: z
        .number()
        .int()
        .min(1)
        .max(1440)
        .optional()
        .describe('minutes to log, 1–1440 (required for action=log)'),
      note: z.string().nullable().optional().describe('log note; trimmed to 500 characters'),
      date: z.string().optional().describe('logged day in YYYY-MM-DD format; omitted means today'),
      timezone_offset_minutes: z.number().int().min(-840).max(840).optional()
        .describe('minutes west of UTC for local noon on date (JavaScript getTimezoneOffset)'),
      board: z.union([z.string(), z.number()]).optional(),
      user: z.string().optional().describe('numeric user id or "me"'),
      from: z.string().optional(),
      to: z.string().optional(),
      running: z.boolean().optional(),
    })
    .strict();
}

export const TimeBaseSchema = getTimeBaseSchema();
export type TimeInput = z.infer<typeof TimeBaseSchema>;
