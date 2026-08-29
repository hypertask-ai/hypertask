/**
 * Common filter schemas
 * 
 * Shared validation logic for filtering across multiple tools.
 */

import { z } from 'zod';
import { isValidEstimateIndex } from '../../utils/constants';

/**
 * Priority filter - supports single or array (for filtering/searching)
 * Uses string values for API query parameters
 */
export const priorityFilterSchema = z.union([
  z.enum(['None', 'Urgent', 'High', 'Medium', 'Low']),
  z.array(z.enum(['None', 'Urgent', 'High', 'Medium', 'Low'])),
]).optional();

/**
 * Priority filter without "None" option (for list_tasks)
 */
export const priorityFilterNoNoneSchema = z.union([
  z.enum(['Urgent', 'High', 'Medium', 'Low']),
  z.array(z.enum(['Urgent', 'High', 'Medium', 'Low'])),
]).optional();

/**
 * Priority index schema (for updates)
 * Uses numeric index (0-4) matching PriorityConstants
 * 0 = No Priority, 1 = Urgent, 2 = High, 3 = Medium, 4 = Low
 */
export const priorityIndexSchema = z.number().int().min(0).max(4).optional();

/**
 * Optional task/board-manifest estimate index: must match {@link EstimateConstants} (0 = no size; 2–6 = XS–XL).
 * Indices 1 and 7 are not valid in product or on staging API.
 */
export const estimateIndexOptionalSchema = z
  .number()
  .int()
  .optional()
  .refine((n) => n === undefined || isValidEstimateIndex(n), {
    message:
      'estimate must be 0 (no size) or 2–6 (XS through XL). Indices 1 and 7 are not supported.',
  });

/**
 * Status filter
 */
export const statusFilterSchema = z.enum(['Normal', 'Archive', 'Deleted']).optional();

/**
 * Assigned to filter - supports 'me', 'unassigned', or user ID(s)
 */
export const assignedToFilterSchema = z.union([
  z.literal('me'),
  z.literal('unassigned'),
  z.coerce.number().int().positive(),
  z.array(z.coerce.number().int().positive()),
]).optional();

/**
 * Assigned to filter for search (no array support)
 */
export const assignedToSearchFilterSchema = z.union([
  z.literal('me'),
  z.literal('unassigned'),
  z.number().int().positive(),
]).optional();

/**
 * Labels filter - supports string, number, or array (for list_tasks filtering)
 */
export const labelsFilterSchema = z.union([
  z.string(),
  z.number().int().positive(),
  z.array(z.union([z.string(), z.number().int().positive()])),
]).optional();

/**
 * Labels assign - array of label IDs for update_task and create_task
 * Backend accepts UUID strings or numbers
 */
export const labelsAssignSchema = z
  .array(z.union([z.string(), z.number()]))
  .optional()
  .describe('Label IDs to set on the task. Get available labels from get_user_context or list_projects (each project includes labels). Replaces existing labels; empty array removes all.');
