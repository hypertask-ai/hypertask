/**
 * Common task identification schemas
 * 
 * Shared validation logic for identifying tasks across multiple tools.
 * Supports three identification methods:
 * 1. task_id - Direct task ID
 * 2. ticket_number - Human-readable ticket number (e.g., "ENG-101")
 * 3. unique_index + project_id - Efficient lookup by project and task index
 */

import { z } from 'zod';
import { getConfig } from '../../config/index';

const config = getConfig();

/**
 * Ticket number schema - used across multiple tools
 */
export const ticketNumberSchema = z
  .string()
  .min(1)
  .max(config.limits.ticketNumberMaxLength)
  .regex(/^[a-zA-Z0-9_-]+$/, 'Ticket number must contain only alphanumeric characters, hyphens, and underscores');

/**
 * Base task identification schema (without validation)
 * Used for FastMCP parameter validation - refine logic checked in execute
 */
export function createTaskIdentificationBaseSchema() {
  return z
    .object({
      // z.coerce: Claude sometimes sends "20706" instead of 20706 (HTPR-3618)
      task_id: z.coerce.number().int().positive().optional(),
      ticket_number: ticketNumberSchema.optional(),
      unique_index: z.coerce.number().int().positive().optional(),
      project_id: z.coerce.number().int().positive().optional(),
    })
    .strict();
}

/**
 * Task identification schema for single task (with validation)
 * Requires exactly one identification method
 */
export function createTaskIdentificationSchema() {
  return createTaskIdentificationBaseSchema()
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

/**
 * Task identification schema for multiple tasks (arrays)
 * Used by get_tasks tool
 */
export function createTaskIdentificationArraySchema() {
  return z
    .object({
      // z.coerce: Claude sometimes stringifies IDs (HTPR-3618)
      task_id: z.array(z.coerce.number().int().positive()).optional(),
      ticket_number: z.array(ticketNumberSchema).optional(),
      unique_index: z.coerce.number().int().positive().optional(),
      project_id: z.coerce.number().int().positive().optional(),
    })
    .strict()
    .refine(
      (data) => {
        const hasTaskId = data.task_id !== undefined && data.task_id.length > 0;
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
        const hasTaskId = data.task_id !== undefined && data.task_id.length > 0;
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
