/**
 * Task-related validation schemas
 * 
 * Validations for: get_tasks, list_tasks, search_tasks
 */

import { z } from 'zod';
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
import { inlineAttachmentsSchema } from './attachment.validation';
import { hasMarkdownStructure } from '../../../utils/helperFunctions/markdownToHtml';

const config = getConfig();

const taskContentTypeSchema = z
  .enum(['html', 'markdown'])
  .optional()
  .describe('Input format for description. Defaults to HTML.');

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
 * Schema for task_context tool input
 */
export function getTaskContextInputSchema() {
  return z
    .object({
      task_id: z.number().int().positive(),
      project_id: z.number().int().positive(),
      summary: z.boolean().optional(),
    })
    .strict();
}

export const TaskContextInputSchema = getTaskContextInputSchema();
export type TaskContextInput = z.infer<typeof TaskContextInputSchema>;

/**
 * Base schema for task_description_history tool input.
 * FastMCP requires a plain Zod object for tool parameters.
 */
export function getTaskDescriptionHistoryBaseSchema() {
  return z
    .object({
      action: z.enum(['versions', 'restore']),
      // Same identifier set as every other task tool: a raw id, a ticket
      // number, or project_id + unique_index.
      task_id: z.number().int().positive().optional(),
      ticket_number: z.string().trim().min(1).optional(),
      unique_index: z.number().int().positive().optional(),
      project_id: z.number().int().positive().optional(),
      version_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Required when action is restore.'),
    })
    .strict();
}

export function getTaskDescriptionHistoryInputSchema() {
  return getTaskDescriptionHistoryBaseSchema().superRefine((data, ctx) => {
    if (data.action === 'restore' && data.version_id === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'version_id is required for restore',
        path: ['version_id'],
      });
    }
    const named =
      data.task_id !== undefined ||
      data.ticket_number !== undefined ||
      (data.unique_index !== undefined && data.project_id !== undefined);
    if (!named) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide task_id, ticket_number, or project_id + unique_index',
        path: ['task_id'],
      });
    }
  });
}

export const TaskDescriptionHistoryInputSchema =
  getTaskDescriptionHistoryInputSchema();
export type TaskDescriptionHistoryInput = z.infer<
  typeof TaskDescriptionHistoryInputSchema
>;

/**
 * Schema for next_tasks tool input
 */
export function getNextTasksInputSchema() {
  return z
    .object({
      project_id: z.number().int().positive(),
      limit: z.number().int().positive().optional(),
      section: z.string().trim().min(1).optional(),
      exclude_blocked: z.boolean().optional(),
      labels: z.string().trim().min(1).optional(),
      cursor: z.string().trim().min(1).optional(),
    })
    .strict();
}

export const NextTasksInputSchema = getNextTasksInputSchema();
export type NextTasksInput = z.infer<typeof NextTasksInputSchema>;

/**
 * Base schema for link_tasks tool input.
 * FastMCP requires a plain Zod object for tool parameters.
 */
export function getLinkTasksBaseSchema() {
  return z
    .object({
      action: z.enum(['link', 'list', 'unlink']).default('link'),
      source_task_id: z.coerce.number().int().positive().optional(),
      source_ticket_number: z.string().trim().min(1).optional(),
      source_unique_index: z.coerce.number().int().positive().optional(),
      source_project_id: z.coerce.number().int().positive().optional(),
      target_task_id: z.coerce.number().int().positive().optional(),
      target_ticket_number: z.string().trim().min(1).optional(),
      target_unique_index: z.coerce.number().int().positive().optional(),
      target_project_id: z.coerce.number().int().positive().optional(),
      task_id: z.coerce.number().int().positive().optional(),
      ticket_number: z.string().trim().min(1).optional(),
      unique_index: z.coerce.number().int().positive().optional(),
      project_id: z.coerce.number().int().positive().optional(),
      relation_type: z
        .enum(['RelatedTo', 'BlockedBy', 'BlockedTo'])
        .optional()
        .describe('Required when action is link.'),
    })
    .strict();
}

/**
 * Schema for link_tasks tool input
 */
export function getLinkTasksInputSchema() {
  return getLinkTasksBaseSchema()
    .refine(
      (data) => {
        if (data.action === 'list') {
          const methodCount = [
            data.task_id,
            data.ticket_number,
            data.unique_index,
          ].filter((value) => value !== undefined).length;
          return methodCount === 1;
        }
        const methodCount = [
          data.source_task_id,
          data.source_ticket_number,
          data.source_unique_index,
        ].filter((value) => value !== undefined).length;
        return methodCount === 1;
      },
      {
        message:
          'Provide exactly one task identifier for the selected action',
        path: [
          'task_id',
          'ticket_number',
          'unique_index',
          'source_task_id',
          'source_ticket_number',
          'source_unique_index',
        ],
      }
    )
    .refine(
      (data) => {
        if (data.action === 'list') return true;
        const methodCount = [
          data.target_task_id,
          data.target_ticket_number,
          data.target_unique_index,
        ].filter((value) => value !== undefined).length;
        return methodCount === 1;
      },
      {
        message:
          'Provide exactly one target task identifier',
        path: [
          'target_task_id',
          'target_ticket_number',
          'target_unique_index',
        ],
      }
    )
    .refine(
      (data) =>
        data.action !== 'list' ||
        data.unique_index === undefined ||
        data.project_id !== undefined,
      {
        message: 'project_id is required when using unique_index',
        path: ['project_id'],
      }
    )
    .refine(
      (data) =>
        data.action === 'list' ||
        data.source_unique_index === undefined ||
        data.source_project_id !== undefined ||
        data.project_id !== undefined,
      {
        message:
          'source_project_id or project_id is required when using source_unique_index',
        path: ['source_project_id'],
      }
    )
    .refine(
      (data) =>
        data.action === 'list' ||
        data.target_unique_index === undefined ||
        data.target_project_id !== undefined ||
        data.project_id !== undefined,
      {
        message:
          'target_project_id or project_id is required when using target_unique_index',
        path: ['target_project_id'],
      }
    )
    .refine(
      (data) => data.action !== 'link' || data.relation_type !== undefined,
      {
        message: 'relation_type is required for link',
        path: ['relation_type'],
      }
    );
}

export const LinkTasksInputSchema = getLinkTasksInputSchema();
export type LinkTasksInput = z.infer<typeof LinkTasksInputSchema>;

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
 * Schema for list_tasks tool input
 */
export function getListTasksInputSchema() {
  return z
    .object({
      project_id: z.number().int().positive().optional(),
      /** Prefer this for filtering; aligns with GET /mcp/tasks?section_id= when the API expects a column id. */
      section_id: z.coerce.number().int().positive().optional(),
      section: z.string().min(1).optional(),
      assigned_to: assignedToFilterSchema,
      priority: priorityFilterNoNoneSchema,
      has_due_date: z.boolean().optional(),
      due_date_before: z.string().datetime().optional(),
      due_date_after: z.string().datetime().optional(),
      status: statusFilterSchema,
      labels: labelsFilterSchema,
      created_by: z.number().int().positive().optional(),
      updated_since: z.string().datetime().optional(),
      created_since: z.string().datetime().optional(),
      has_comments: z.boolean().optional(),
      has_attachments: z.boolean().optional(),
      search: z.string().min(1).optional(),
    })
    .merge(paginationSchema)
    .extend({
      sort_by: sortBySchema,
      sort_order: sortOrderSchema,
    })
    .strict();
}

export const ListTasksInputSchema = getListTasksInputSchema();
export type ListTasksInput = z.infer<typeof ListTasksInputSchema>;

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
 * Schema for find_related_tasks tool input
 */
export function getFindRelatedTasksInputSchema() {
  return createTaskIdentificationBaseSchema()
    .extend({
      text: z
        .string()
        .trim()
        .min(1, 'text must not be empty')
        .max(2000, 'text cannot exceed 2000 characters')
        .optional(),
      limit: z.number().int().positive().optional(),
    })
    .strict()
    .refine(
      (data) => {
        const methodCount = [
          data.task_id,
          data.ticket_number,
          data.unique_index,
        ].filter((value) => value !== undefined).length;
        return methodCount + Number(data.text !== undefined) === 1;
      },
      {
        message:
          'Provide exactly one of task_id, ticket_number, (project_id + unique_index), or text',
        path: ['task_id', 'ticket_number', 'unique_index', 'text'],
      }
    )
    .refine(
      (data) =>
        data.unique_index === undefined || data.project_id !== undefined,
      {
        message: 'project_id is required when using unique_index',
        path: ['project_id'],
      }
    )
    .refine(
      (data) => data.text === undefined || data.project_id === undefined,
      {
        message: 'project_id can only qualify a task identifier',
        path: ['project_id'],
      }
    );
}

export const FindRelatedTasksInputSchema = getFindRelatedTasksInputSchema();
export type FindRelatedTasksInput = z.infer<typeof FindRelatedTasksInputSchema>;


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
        .describe('Task description. HTML or structural markdown; content_type can explicitly select either format.'),
      content_type: taskContentTypeSchema,
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
      attachments: inlineAttachmentsSchema,
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
      (data) =>
        data.description === undefined ||
        isAcceptedRichText(data.description, data.content_type),
      {
        message: 'Description must be HTML or structural markdown such as a list, emphasis, code, or link. Plain text is not accepted.',
        path: ['description'],
      }
    )
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
          data.parent_task_id !== undefined ||
          data.attachments !== undefined;
        return hasUpdateFields;
      },
      {
        message: 'At least one update field (title, description, priority, estimate, status, sectionId, labels, due_date, assignee, parent_task_id, attachments) must be provided',
        path: ['title', 'description', 'priority', 'estimate', 'status', 'sectionId', 'labels', 'due_date', 'assignee', 'parent_task_id', 'attachments'],
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
    agent_id: z
      .string()
      .uuid()
      .optional()
      .describe('Agent owner only: assign or unassign one of your own agents to the task, no user_id needed. Mirrors the REST agent_id field.'),
    assign_self: z
      .boolean()
      .optional()
      .describe('Agent token only: assign the calling agent to the task, no user_id needed. Mirrors the REST assign_self flag.'),
  }).strict();
}

/**
 * Schema for assign_user tool input
 * Requires task identification + one assignee identification method
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
        const hasAgentId = data.agent_id !== undefined;
        return hasUserId || hasUserIds || hasAgentId || data.assign_self === true;
      },
      {
        message: 'Either user_id, user_ids, agent_id, or assign_self must be provided',
        path: ['user_id', 'user_ids', 'agent_id', 'assign_self'],
      }
    )
    .refine(
      (data) => {
        const hasUserId = data.user_id !== undefined;
        const hasUserIds = data.user_ids !== undefined;
        const hasAgentId = data.agent_id !== undefined;
        const hasAssignSelf = data.assign_self === true;
        return [hasUserId, hasUserIds, hasAgentId, hasAssignSelf].filter(Boolean).length === 1;
      },
      {
        message: 'Cannot provide multiple assignee identification methods. Use one of user_id, user_ids, agent_id, or assign_self.',
        path: ['user_id', 'user_ids', 'agent_id', 'assign_self'],
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

function isAcceptedRichText(
  text: string,
  contentType?: 'html' | 'markdown'
): boolean {
  return (
    contentType === 'markdown' ||
    isHtmlFormat(text) ||
    (contentType === undefined && hasMarkdownStructure(text))
  );
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
        .describe('Task description. HTML or structural markdown; content_type can explicitly select either format.'),
      content_type: taskContentTypeSchema,
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
      attachments: inlineAttachmentsSchema,
    })
    .strict()
    .refine(
      (data) =>
        data.description === undefined ||
        isAcceptedRichText(data.description, data.content_type),
      {
        message: 'Description must be HTML or structural markdown such as a list, emphasis, code, or link. Plain text is not accepted.',
        path: ['description'],
      }
    );
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
export function getGetTaskTreeBaseSchema() {
  return z
    .object({
      ticket_number: z.string().trim().min(1).optional().describe('Ticket number of the task (e.g. HTPR-15)'),
      task_id: z.coerce.number().int().positive().optional().describe('Numeric task ID'),
      depth: z.coerce.number().int().min(0).optional().describe('How many levels deep to show. Use 0 for the root only; omit for the full tree.'),
    })
    .strict();
}

export function getGetTaskTreeInputSchema() {
  return getGetTaskTreeBaseSchema().refine(
      (data) => (data.ticket_number !== undefined) !== (data.task_id !== undefined),
      { message: 'Provide either ticket_number or task_id, not both and not neither.' }
    );
}

export const GetTaskTreeInputSchema = getGetTaskTreeInputSchema();
export type GetTaskTreeInput = z.infer<typeof GetTaskTreeInputSchema>;
