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
        .positive()
        .optional()
        .describe('minutes to log (required for action=log)'),
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
