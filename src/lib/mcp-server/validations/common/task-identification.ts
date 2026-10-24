
import { z } from 'zod';
import { getConfig } from '../../config/index';

const config = getConfig();

export const ticketNumberSchema = z
  .string()
  .min(1)
  .max(config.limits.ticketNumberMaxLength)
  .regex(/^[a-zA-Z0-9_-]+$/, 'Ticket number must contain only alphanumeric characters, hyphens, and underscores');

const taskIdSchema = z.coerce.number().int().positive();

export const taskIdOneOrManySchema = z.union([taskIdSchema, z.array(taskIdSchema)]);
export const ticketNumberOneOrManySchema = z.union([ticketNumberSchema, z.array(ticketNumberSchema)]);

const asArray = (value: unknown) =>
  value === undefined || Array.isArray(value) ? value : [value];

export function createTaskIdentificationBaseSchema() {
  return z
    .object({
      id: z.coerce.number().int().positive().optional(),
      task_id: z.coerce.number().int().positive().optional(),
      ticket_number: ticketNumberSchema.optional(),
      unique_index: z.coerce.number().int().positive().optional(),
      project_id: z.coerce.number().int().positive().optional(),
    })
    .strict();
}

export function createTaskIdentificationSchema() {
  return createTaskIdentificationBaseSchema()
    .refine(
      (data) => {
        const hasTaskId = data.id !== undefined || data.task_id !== undefined;
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
        const hasTaskId = data.id !== undefined || data.task_id !== undefined;
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

export function createTaskIdentificationArraySchema() {
  return z
    .object({
      id: taskIdSchema.optional(),
      task_id: z.preprocess(asArray, z.array(taskIdSchema).optional()),
      ticket_number: z.preprocess(asArray, z.array(ticketNumberSchema).optional()),
      unique_index: z.coerce.number().int().positive().optional(),
      project_id: z.coerce.number().int().positive().optional(),
    })
    .strict()
    .refine(
      (data) => {
        const hasTaskId = data.id !== undefined || (data.task_id !== undefined && data.task_id.length > 0);
        const hasTicketNumber = data.ticket_number !== undefined && data.ticket_number.length > 0;
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
        const hasTaskId = data.id !== undefined || (data.task_id !== undefined && data.task_id.length > 0);
        const hasTicketNumber = data.ticket_number !== undefined && data.ticket_number.length > 0;
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
