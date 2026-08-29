import { z } from 'zod';
import { createTaskIdentificationBaseSchema } from './common/task-identification';

/**
 * move_task_to_inbox: route a task into a specific project member's inbox,
 * mirroring the "Move task to inbox" command-palette action. HTPR-4553.
 */
export function getMoveTaskToInboxBaseSchema() {
  return createTaskIdentificationBaseSchema().extend({
    user_id: z
      .number()
      .int()
      .positive()
      .describe('The project member whose inbox receives the task. Required.'),
  });
}

export function getMoveTaskToInboxInputSchema() {
  return getMoveTaskToInboxBaseSchema()
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
        const methodCount = [
          data.task_id !== undefined,
          data.ticket_number !== undefined,
          data.unique_index !== undefined,
        ].filter(Boolean).length;
        return methodCount === 1;
      },
      {
        message: 'Cannot provide multiple task identification methods. Use one of: task_id, ticket_number, or (project_id + unique_index).',
        path: ['task_id', 'ticket_number', 'unique_index'],
      }
    );
}

export const MoveTaskToInboxInputSchema = getMoveTaskToInboxInputSchema();
export type MoveTaskToInboxInput = z.infer<typeof MoveTaskToInboxInputSchema>;

export function getInboxListBaseSchema() {
  return z
    .object({
      /** Omit to use the authenticated user from the JWT (recommended for CLI / HTPR-3079). */
      user_id: z.number().int().positive().optional(),
      composition: z.boolean().optional(),
      project_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Required when composition is true.'),
    })
    .strict();
}

export function getInboxListInputSchema() {
  return getInboxListBaseSchema().refine(
    (data) => data.composition !== true || data.project_id !== undefined,
    {
      message: 'project_id is required when composition is true',
      path: ['project_id'],
    }
  );
}

export const InboxListInputSchema = getInboxListInputSchema();
export type InboxListInput = z.infer<typeof InboxListInputSchema>;

export function getInboxArchiveInputSchema() {
  return z
    .object({
      notification_ids: z.array(z.number().int().positive()).min(1),
    })
    .strict();
}

export const InboxArchiveInputSchema = getInboxArchiveInputSchema();
export type InboxArchiveInput = z.infer<typeof InboxArchiveInputSchema>;

/** Same shape as archive: notification row ids to restore to the inbox. */
export function getInboxUnarchiveInputSchema() {
  return getInboxArchiveInputSchema();
}

export const InboxUnarchiveInputSchema = getInboxUnarchiveInputSchema();
export type InboxUnarchiveInput = z.infer<typeof InboxUnarchiveInputSchema>;
