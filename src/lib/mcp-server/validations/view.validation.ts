/**
 * Task-related validation schemas
 * 
 * Validations for: get_tasks, list_tasks, search_tasks
 */

import { z } from 'zod';
import { SORTING_MODES } from '@/models/Views/model';
import { SUBTASK_SETTINGS } from '@/models/Views/model';
import { getConfig } from '../config/index';
import {
  createTaskIdentificationArraySchema,
  createTaskIdentificationBaseSchema,
} from './common/task-identification';
import {
  paginationSchema,
  sortBySchema,
  sortOrderSchema,
  createSearchPaginationSchema,
} from './common/pagination';
import {
  priorityFilterNoNoneSchema,
  priorityFilterSchema,
  priorityIndexSchema,
  estimateIndexOptionalSchema,
  statusFilterSchema,
  assignedToFilterSchema,
  assignedToSearchFilterSchema,
  labelsFilterSchema,
  labelsAssignSchema,
} from './common/filters';

const config = getConfig();

/**
 * Schema for get_tasks tool input
 * Supports batch retrieval by task_id array or ticket_number array
 */
export function getGetTasksInputSchema() {
  return createTaskIdentificationArraySchema();
}

export const GetTaskInputSchema = getGetTasksInputSchema();
export type GetTaskInput = z.infer<typeof GetTaskInputSchema>;

/**
 * Base schema for get_tasks (without refine validation)
 * Used for FastMCP parameter validation
 */
export function getGetTasksBaseSchema() {
  return createTaskIdentificationBaseSchema().extend({
    task_id: z.array(z.coerce.number().int().positive()).optional(),
    ticket_number: z.array(createTaskIdentificationBaseSchema().shape.ticket_number).optional(),
  });
}

/**
 * Schema for list_views tool input
 */
export function getListViewsInputSchema() {
    return z
      .object({
        project_id: z.number().int().positive().optional(),
        visibility: z.enum(["Public", "Private"]).optional(),
      })
      .merge(paginationSchema)
      .extend({
        sort_by: sortBySchema,
        sort_order: sortOrderSchema,
      })
      .strict()
  }

export const ListViewsInputSchema = getListViewsInputSchema();
export type ListViewInput = z.infer<typeof ListViewsInputSchema>;

/**
 * Schema for get_view tool input
 */
export function getViewInputSchema() {
  return z
    .object({
      viewId: z.string().uuid(),
    })
    .strict()
}

export const GetViewInputSchema = getViewInputSchema();
export type GetViewInput = z.infer<typeof ListViewsInputSchema>;

const viewVisibilitySchema = z.enum(['Public', 'Private']);
const viewMatchSchema = z.enum(['ALL', 'ANY']);
const viewSortingModeSchema = z.enum(SORTING_MODES);
const viewSortingOrderSchema = z.enum(['Ascending', 'Descending']);
const viewSubtaskSettingSchema = z.enum(SUBTASK_SETTINGS).describe(
  'None hides subtasks and their count; Parent shows parent tasks with a subtask count; Flattened shows subtasks as rows; Card shows subtasks on parent cards; Flattened_Card does both.',
);
const viewSortingStackSchema = z
  .array(
    z
      .object({
        mode: viewSortingModeSchema.exclude(['Manual']),
        order: viewSortingOrderSchema,
      })
      .strict(),
  )
  .max(2);
const viewIdSchema = z.string().uuid();
const viewAssigneeIdSchema = z.union([
  z.number().int().positive(),
  z.string().uuid(),
]);
// The REST view service performs the type-specific validation and canonicalization
// for this document. The MCP boundary must preserve the complete native filter
// projection instead of stripping fields that it does not interpret itself.
const nativeBoardFiltersSchema = z.record(z.string(), z.unknown());
const visibleSectionIdsSchema = z.array(z.number().int().positive());

/**
 * Schema for create_view tool input
 */
export function getCreateViewInputSchema() {
  return z
    .object({
      project_id: z.number().int().positive(),
      title: z.string().trim().min(1),
      visibility: viewVisibilitySchema.optional(),
      filters: z
        .object({
          label_names: z.array(z.string().min(1)).optional(),
          assignee_ids: z.array(viewAssigneeIdSchema).optional(),
          match: viewMatchSchema.optional(),
        })
        .strict()
        .optional(),
      board_filters: nativeBoardFiltersSchema.optional(),
      visible_section_ids: visibleSectionIdsSchema.optional(),
      sorting_mode: viewSortingModeSchema.optional(),
      sorting_order: viewSortingOrderSchema.optional(),
      sorting_stack: viewSortingStackSchema.optional(),
      subtask_setting: viewSubtaskSettingSchema.optional(),
      set_as_default: z.boolean().optional(),
    })
    .strict();
}

export const CreateViewInputSchema = getCreateViewInputSchema();
export type CreateViewInput = z.infer<typeof CreateViewInputSchema>;

/**
 * Base schema for update_view tool input.
 * FastMCP requires a plain Zod object for tool parameters.
 */
export function getUpdateViewBaseSchema() {
  return z
    .object({
      viewId: viewIdSchema,
      title: z.string().trim().min(1).optional(),
      visibility: viewVisibilitySchema.optional(),
      label_names: z.array(z.string().min(1)).optional(),
      assignee_ids: z.array(viewAssigneeIdSchema).optional(),
      match: viewMatchSchema.optional(),
      board_filters: nativeBoardFiltersSchema.optional(),
      visible_section_ids: visibleSectionIdsSchema.optional(),
      sorting_mode: viewSortingModeSchema.optional(),
      sorting_order: viewSortingOrderSchema.optional(),
      sorting_stack: viewSortingStackSchema.optional(),
      subtask_setting: viewSubtaskSettingSchema.optional(),
      set_as_default: z.boolean().optional(),
    })
    .strict();
}

/**
 * Schema for update_view tool input
 */
export function getUpdateViewInputSchema() {
  return getUpdateViewBaseSchema().refine(
    (data) =>
      data.title !== undefined ||
      data.visibility !== undefined ||
      data.label_names !== undefined ||
      data.assignee_ids !== undefined ||
      data.match !== undefined ||
      data.board_filters !== undefined ||
      data.visible_section_ids !== undefined ||
      data.sorting_mode !== undefined ||
      data.sorting_order !== undefined ||
      data.sorting_stack !== undefined ||
      data.subtask_setting !== undefined ||
      data.set_as_default !== undefined,
    {
      message: 'At least one view field must be provided',
      path: [
        'title',
        'visibility',
        'label_names',
        'assignee_ids',
        'match',
        'board_filters',
        'visible_section_ids',
        'sorting_mode',
        'sorting_order',
        'sorting_stack',
        'subtask_setting',
        'set_as_default',
      ],
    },
  );
}

export const UpdateViewInputSchema = getUpdateViewInputSchema();
export type UpdateViewInput = z.infer<typeof UpdateViewInputSchema>;

/**
 * Schema for delete_view tool input
 */
export function getDeleteViewInputSchema() {
  return z
    .object({
      viewId: viewIdSchema,
    })
    .strict();
}

export const DeleteViewInputSchema = getDeleteViewInputSchema();
export type DeleteViewInput = z.infer<typeof DeleteViewInputSchema>;

/**
 * Schema for switch_view tool input
 */
export function getApplyViewInputSchema() {
  return z
    .object({
      viewId: viewIdSchema,
    })
    .strict();
}

export const ApplyViewInputSchema = getApplyViewInputSchema();
export type ApplyViewInput = z.infer<typeof ApplyViewInputSchema>;

/**
 * Schema for search_tasks tool input (basic)
 */
export function getSearchTasksInputSchema() {
  return z
    .object({
      query: z
        .string()
        .max(config.limits.searchQueryMaxLength, `Search query cannot exceed ${config.limits.searchQueryMaxLength} characters`),
      board_id: z.number().int().positive().optional(),
      project_id: z.number().int().positive().optional(),
    })
    .merge(createSearchPaginationSchema(config.limits.searchLimitMax, config.limits.searchLimitDefault))
    .strict();
}

export const SearchTasksInputSchema = getSearchTasksInputSchema();
export type SearchTasksInput = z.infer<typeof SearchTasksInputSchema>;

/**
 * Enhanced schema for search_tasks tool input with additional filters
 */
export function getEnhancedSearchTasksInputSchema() {
  return z
    .object({
      query: z
        .string()
        .max(config.limits.searchQueryMaxLength, `Search query cannot exceed ${config.limits.searchQueryMaxLength} characters`),
      board_id: z.number().int().positive().optional(),
      project_id: z.number().int().positive().optional(),
      assigned_to: assignedToSearchFilterSchema,
      priority: priorityFilterSchema,
      section: z.string().min(1).optional(),
      has_due_date: z.boolean().optional(),
      status: statusFilterSchema,
    })
    .merge(createSearchPaginationSchema(config.limits.searchLimitMax, config.limits.searchLimitDefault))
    .strict();
}

export const EnhancedSearchTasksInputSchema = getEnhancedSearchTasksInputSchema();
export type EnhancedSearchTasksInput = z.infer<typeof EnhancedSearchTasksInputSchema>;


/**
 * Base schema for update_task tool (without refine validation)
 * Used for FastMCP parameter validation, refine is checked in execute
 */
export function getUpdateTaskBaseSchema() {
  return createTaskIdentificationBaseSchema()
    .extend({
      // Update fields - all optional (only update what's provided)
      title: z.string().min(1).optional(),
      description: z
        .string()
        .min(1)
        .optional()
        .describe('The description of the task. MUST be in HTML format (e.g., "<p>Text</p>" for paragraphs, "<br>" for line breaks). Plain text will be rejected.')
        .refine(
          (text) => !text || isHtmlFormat(text),
          {
            message: 'Description must be in HTML format. Use HTML tags like <p>Text</p> for paragraphs or <br> for line breaks. Plain text is not accepted.',
          }
        ),
      priority: priorityIndexSchema, // Use index (0-4) instead of string
      estimate: estimateIndexOptionalSchema,
      status: statusFilterSchema,
      sectionId: z.number().int().positive().optional(),
      labels: labelsAssignSchema,
      due_date: z
        .union([z.string(), z.null()])
        .optional()
        .describe('Due date in ISO 8601 format (e.g. "2026-03-10"). Pass null to clear/remove the due date.'),
      assignee: z.array(z.number().int().positive()).optional(),
      parent_task_id: z
      .number()
      .optional()
      .describe('The parent task ID to update the task as a sub-task of.'),
    })
    .strict();
}

/**
 * Schema for update_task tool input
 * Requires task identification + optional update fields
 */
export function getUpdateTaskInputSchema() {
  const baseSchema = getUpdateTaskBaseSchema();

  return baseSchema
    .refine(
      (data) => {
        // At least one identification method must be provided
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
        // Only one identification method should be provided
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
        // If unique_index is provided, project_id must also be provided
        if (data.unique_index !== undefined) {
          return data.project_id !== undefined;
        }
        return true;
      },
      {
        message: 'project_id is required when using unique_index',
        path: ['project_id'],
      }
    )
    .refine(
      (data) => {
        // At least one update field must be provided (can't update nothing)
        const hasUpdateFields =
          data.title !== undefined ||
          data.description !== undefined ||
          data.priority !== undefined ||
          data.estimate !== undefined ||
          data.status !== undefined ||
          data.sectionId !== undefined ||
          data.labels !== undefined ||
          data.due_date !== undefined ||
          data.assignee !== undefined ||
          data.parent_task_id !== undefined;
        return hasUpdateFields;
      },
      {
        message: 'At least one update field (title, description, priority, estimate, status, sectionId, labels, due_date, assignee, parent_task_id) must be provided',
        path: ['title', 'description', 'priority', 'estimate', 'status', 'sectionId', 'labels', 'due_date', 'assignee', 'parent_task_id'],
      }
    );
}

export const UpdateTaskInputSchema = getUpdateTaskInputSchema();
export type UpdateTaskInput = z.infer<typeof UpdateTaskInputSchema>;

/**
 * Base schema for assign_user tool (without refine validation)
 * intent assign (default): idempotent — ensure user is assigned; does not remove.
 * intent unassign: explicitly remove the user from assignees.
 */
export function getAssignUserBaseSchema() {
  return createTaskIdentificationBaseSchema().extend({
    intent: z
      .enum(['assign', 'unassign'])
      .default('assign')
      .describe(
        'assign: idempotent add — assigns if not already assigned; if already assigned, no-op. unassign: remove this user from assignees.',
      ),
    user_id: z
      .coerce.number()
      .int()
      .positive()
      .optional()
      .describe('User ID to assign or unassign (use intent: unassign to remove).'),
    user_ids: z
      .array(z.coerce.number().int().positive())
      .min(1)
      .optional()
      .describe('For multiple mode: user IDs; each user follows intent (assign = idempotent, unassign = remove).'),
  }).strict();
}

/**
 * Schema for assign_user tool input
 * Requires task identification + either user_id or user_ids
 */
export function getAssignUserInputSchema() {
  const baseSchema = getAssignUserBaseSchema();

  return baseSchema
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
    )
    .refine(
      (data) => {
        const hasUserId = data.user_id !== undefined;
        const hasUserIds = data.user_ids !== undefined && data.user_ids.length > 0;
        return hasUserId || hasUserIds;
      },
      {
        message: 'Either user_id or user_ids must be provided',
        path: ['user_id', 'user_ids'],
      }
    )
    .refine(
      (data) => {
        const hasUserId = data.user_id !== undefined;
        const hasUserIds = data.user_ids !== undefined;
        return !(hasUserId && hasUserIds);
      },
      {
        message: 'Cannot provide both user_id and user_ids. Use one or the other.',
        path: ['user_id', 'user_ids'],
      }
    );
}

export const AssignUserInputSchema = getAssignUserInputSchema();
export type AssignUserInput = z.infer<typeof AssignUserInputSchema>;

/**
 * Check if text appears to be HTML format
 * Simple heuristic: checks for HTML tags
 */
function isHtmlFormat(text: string): boolean {
  if (!text || typeof text !== 'string') {
    return false;
  }
  
  // Check for HTML tags (basic pattern)
  const htmlTagPattern = /<[a-z][\s\S]*>/i;
  return htmlTagPattern.test(text.trim());
}

/**
 * Schema for create_task tool input
 * Requires project_id and title, optional description, section, priority, estimate
 */
export function getCreateTaskInputSchema() {
  return z
    .object({
      project_id: z.coerce
        .number()
        .int()
        .positive()
        .describe('The project ID to create the task in (number; strings like "1511" are auto-converted)'),
      title: z.string().min(1).max(500).describe('The title of the task'),
      description: z
        .string()
        .optional()
        .describe('The description of the task. MUST be in HTML format (e.g., "<p>Text</p>" for paragraphs, "<br>" for line breaks). Plain text will be rejected.')
        .refine(
          (text) => !text || isHtmlFormat(text),
          {
            message: 'Description must be in HTML format. Use HTML tags like <p>Text</p> for paragraphs or <br> for line breaks. Plain text is not accepted.',
          }
        ),
      section_id: z.coerce
        .number()
        .int()
        .positive()
        .optional()
        .describe('The section ID to place the task in. Use hypertask_section with action=list to find available sections.'),
      priority: priorityIndexSchema.describe('Priority index: 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low'),
      estimate: estimateIndexOptionalSchema.describe(
        'Estimate index: 0=no size; 2=XS, 3=S, 4=M, 5=L, 6=XL (matches product; 1 and 7 invalid).'
      ),
      labels: labelsAssignSchema,
      due_date: z
        .string()
        .optional()
        .describe('Due date in ISO 8601 format (e.g. "2026-03-10" or "2026-03-10T00:00:00Z").'),
      parent_task_id: z
      .number()
      .optional()
      .describe('The parent task ID to create the task as a sub-task of. If not provided, the task will be created as a top-level task.'),
      assignee: z.array(z.number().int().positive()).optional(),
    })
    .strict();
}

export const CreateTaskInputSchema = getCreateTaskInputSchema();
export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;

/**
 * Base schema for move_task_between_boards (without refine validation)
 * Used for FastMCP parameter validation; refines are checked in execute
 */
export function getMoveTaskBetweenBoardsBaseSchema() {
  return createTaskIdentificationBaseSchema()
    .extend({
      target_project_id: z
        .coerce.number()
        .int()
        .positive()
        .describe('The destination board/project ID. The task will be moved to this board.'),
      target_section_id: z
        .coerce.number()
        .int()
        .positive()
        .optional()
        .describe(
          'Optional section/column ID on the target board. Use hypertask_section with action=list and the target project to find available section IDs.'
        ),
    })
    .strict();
}

/**
 * Schema for move_task_between_boards tool input (with validation)
 * Moves a task from one board/project to another (different from update_task sectionId which moves within same board)
 */
export function getMoveTaskBetweenBoardsInputSchema() {
  return getMoveTaskBetweenBoardsBaseSchema()
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

export const MoveTaskBetweenBoardsInputSchema = getMoveTaskBetweenBoardsInputSchema();
export type MoveTaskBetweenBoardsInput = z.infer<typeof MoveTaskBetweenBoardsInputSchema>;

/**
 * Schema for get_task_tree (task hierarchy in one response).
 * Exactly one of ticket_number or task_id must be provided.
 */
export function getGetTaskTreeInputSchema() {
  return z
    .object({
      ticket_number: z.string().min(1).optional().describe('Ticket number of the task (e.g. HTPR-15)'),
      task_id: z.number().int().positive().optional().describe('Numeric task ID'),
      depth: z.number().int().positive().optional().describe('How many levels deep to show. Omit for the full tree.'),
    })
    .strict()
    .refine(
      (data) => (data.ticket_number !== undefined) !== (data.task_id !== undefined),
      { message: 'Provide either ticket_number or task_id, not both and not neither.' }
    );
}

export const GetTaskTreeInputSchema = getGetTaskTreeInputSchema();
export type GetTaskTreeInput = z.infer<typeof GetTaskTreeInputSchema>;
