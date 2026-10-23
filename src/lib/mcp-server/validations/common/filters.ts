
import { z } from 'zod';
import { isValidEstimateIndex } from '../../utils/constants';

export const priorityFilterSchema = z.union([
  z.enum(['None', 'Urgent', 'High', 'Medium', 'Low']),
  z.array(z.enum(['None', 'Urgent', 'High', 'Medium', 'Low'])),
]).optional();

export const priorityFilterNoNoneSchema = z.union([
  z.enum(['Urgent', 'High', 'Medium', 'Low']),
  z.array(z.enum(['Urgent', 'High', 'Medium', 'Low'])),
]).optional();

export const priorityIndexSchema = z.number().int().min(0).max(4).optional();

export const estimateIndexOptionalSchema = z
  .number()
  .int()
  .optional()
  .refine((n) => n === undefined || isValidEstimateIndex(n), {
    message:
      'estimate must be 0 (no size) or 2–6 (XS through XL). Indices 1 and 7 are not supported.',
  });

export const statusFilterSchema = z.enum(['Normal', 'Archive', 'Deleted']).optional();

export const assignedToFilterSchema = z.union([
  z.literal('me'),
  z.literal('unassigned'),
  z.coerce.number().int().positive(),
  z.array(z.coerce.number().int().positive()),
]).optional();

export const assignedToSearchFilterSchema = z.union([
  z.literal('me'),
  z.literal('unassigned'),
  z.number().int().positive(),
]).optional();

export const labelsFilterSchema = z.union([
  z.string(),
  z.number().int().positive(),
  z.array(z.union([z.string(), z.number().int().positive()])),
]).optional();

export const labelsAssignSchema = z
  .array(z.union([z.string(), z.number()]))
  .optional()
  .describe('Label IDs to set on the task. Get available labels from get_user_context or list_projects (each project includes labels). Replaces existing labels; empty array removes all.');
