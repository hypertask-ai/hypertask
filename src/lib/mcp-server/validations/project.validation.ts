/**
 * Project-related validation schemas
 * 
 * Validations for: list_projects, list_sections
 */

import { z } from 'zod';
import { paginationSchema, sortBySchema, sortOrderSchema } from './common/pagination';
import { estimateIndexOptionalSchema, statusFilterSchema } from './common/filters';

/**
 * Schema for list_projects tool input
 */
export function getListProjectsInputSchema() {
  return z
    .object({
      status: statusFilterSchema,
      search: z.string().min(1).optional(),
    })
    .merge(paginationSchema)
    .extend({
      sort_by: sortBySchema,
      sort_order: sortOrderSchema,
    })
    .strict();
}

export const ListProjectsInputSchema = getListProjectsInputSchema();
export type ListProjectsInput = z.infer<typeof ListProjectsInputSchema>;

/**
 * Schema for board_manifest tool input
 */
export function getBoardManifestInputSchema() {
  return z
    .object({
      project_id: z.number().int().positive(),
    })
    .strict();
}

export const BoardManifestInputSchema = getBoardManifestInputSchema();
export type BoardManifestInput = z.infer<typeof BoardManifestInputSchema>;

/**
 * Schema for get_board_playbook tool input
 */
export function getBoardPlaybookInputSchema() {
  return z
    .object({
      project_id: z.number().int().positive(),
    })
    .strict();
}

export const BoardPlaybookInputSchema = getBoardPlaybookInputSchema();
export type BoardPlaybookInput = z.infer<typeof BoardPlaybookInputSchema>;

/**
 * Base schema for board_config tool input.
 * FastMCP requires a plain Zod object for tool parameters.
 */
export function getBoardConfigBaseSchema() {
  return z
    .object({
      action: z.enum([
        'get_playbook',
        'set_playbook',
        'get_instructions',
        'set_instructions',
      ]),
      project_id: z.number().int().positive(),
      definition_of_done: z
        .array(z.string().max(500))
        .max(50)
        .optional(),
      working_rules: z.string().max(5000).optional(),
      notes: z.string().max(5000).optional(),
      custom_instruction: z
        .string()
        .optional()
        .describe('Required when action is set_instructions.'),
      model_selected: z.string().optional(),
    })
    .strict();
}

export function getBoardConfigInputSchema() {
  return getBoardConfigBaseSchema().superRefine((data, ctx) => {
    if (
      data.action === 'set_instructions' &&
      data.custom_instruction === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'custom_instruction is required for set_instructions',
        path: ['custom_instruction'],
      });
    }
  });
}

export const BoardConfigInputSchema = getBoardConfigInputSchema();
export type BoardConfigInput = z.infer<typeof BoardConfigInputSchema>;

const PROJECT_MEMBER_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Base schema for project_admin tool input.
 * FastMCP requires a plain Zod object for tool parameters.
 */
export function getProjectAdminBaseSchema() {
  return z
    .object({
      action: z.enum(['archive', 'invite_member']),
      project_id: z.number().int().positive(),
      status: z.enum(['Archive', 'Normal']).optional(),
      userToAdd: z
        .union([
          z.number().int().positive(),
          z.string().trim().min(1).refine(
            (value) =>
              /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ||
              PROJECT_MEMBER_UUID_PATTERN.test(value),
            'userToAdd must be an email address or agent UUID'
          ),
        ])
        .optional()
        .describe('Required when action is invite_member.'),
    })
    .strict();
}

export function getProjectAdminInputSchema() {
  return getProjectAdminBaseSchema().superRefine((data, ctx) => {
    if (data.action === 'invite_member' && data.userToAdd === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'userToAdd is required for invite_member',
        path: ['userToAdd'],
      });
    }
  });
}

export const ProjectAdminInputSchema = getProjectAdminInputSchema();
export type ProjectAdminInput = z.infer<typeof ProjectAdminInputSchema>;

/**
 * Base schema for list_sections tool (without refine validation)
 * Used for FastMCP parameter validation
 */
export function getListSectionsBaseSchema() {
  return z
    .object({
      project_id: z.number().int().positive().optional(),
      board_id: z.number().int().positive().optional(),
      include_hidden: z.boolean().optional(),
    })
    .strict();
}

/**
 * Schema for list_sections tool input (with refine validation)
 * Either project_id or board_id must be provided
 */
export function getListSectionsInputSchema() {
  return getListSectionsBaseSchema().refine(
    (data) => data.project_id !== undefined || data.board_id !== undefined,
    {
      message: 'Either project_id or board_id must be provided',
      path: ['project_id', 'board_id'],
    }
  );
}

export const ListSectionsInputSchema = getListSectionsInputSchema();
export type ListSectionsInput = z.infer<typeof ListSectionsInputSchema>;

/**
 * Schema for create_section tool input (legacy, used internally)
 */
export function getCreateSectionInputSchema() {
  return z
    .object({
      project_id: z.number().int().positive(),
      title: z.string().min(1).max(200),
      after_section_id: z.number().int().positive().optional(),
    })
    .strict();
}

export const CreateSectionInputSchema = getCreateSectionInputSchema();
export type CreateSectionInput = z.infer<typeof CreateSectionInputSchema>;

/**
 * Schema for list_project_members tool input
 * Returns project/team members for resolving @mentions in comments
 */
export const ListProjectMembersInputSchema = z
  .object({
    project_id: z.coerce.number().int().positive('project_id must be a positive integer'),
  })
  .strict();

export type ListProjectMembersInput = z.infer<typeof ListProjectMembersInputSchema>;

/**
 * Schema for add_project_members tool input
 * Returns member added to project
 */
export const AddProjectMembersInputSchema = z
  .object({
    project_id: z.coerce.number().int().positive('project_id must be a positive integer'),
    user: z.union([
      z.coerce.number().int().positive('user id must be a positive integer'),
      z.string().email('user must be a valid email address'),
    ]),
  })
  .strict();

export type AddProjectMembersInput = z.infer<typeof AddProjectMembersInputSchema>;

/**
 * Schema for create_label tool input (HTPR-3054)
 */
export const CreateLabelInputSchema = z
  .object({
    project_id: z.number().int().positive().describe('Project/board ID'),
    name: z.string().min(1).max(100).describe('Label name'),
  })
  .strict();

export type CreateLabelInput = z.infer<typeof CreateLabelInputSchema>;

/**
 * Schema for list_labels tool input.
 */
export function getListLabelsBaseSchema() {
  return z
    .object({
      project_id: z.coerce
        .number()
        .int()
        .positive('project_id must be a positive integer'),
    })
    .strict();
}

export const ListLabelsInputSchema = getListLabelsBaseSchema();
export type ListLabelsInput = z.infer<typeof ListLabelsInputSchema>;

/**
 * Manifest task for create_board (HTPR-3142). Exactly one of section_index or section_title.
 */
export const CreateBoardTaskManifestSchema = z
  .object({
    title: z.string().min(1).max(500),
    description: z.string().optional(),
    section_index: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        '0-based index into sections[]. For greenfield boards, most tasks belong in early columns (Triage/Scheduled); do not default most work to In development or In review unless sources say work is active (see create_board tool description).'
      ),
    section_title: z
      .string()
      .min(1)
      .max(200)
      .optional()
      .describe('Must match one sections[].title exactly. Use for placement by workflow state, not theme.'),
    label_names: z.array(z.string().min(1)).optional(),
    priority: z
      .number()
      .int()
      .min(0)
      .max(4)
      .optional()
      .describe(
        'Agents SHOULD always set this for board generation: 0=None, 1=Urgent, 2=High, 3=Medium, 4=Low (same as create_task). Omitting leaves priority blank in the UI.'
      ),
    estimate: estimateIndexOptionalSchema.describe(
      'Relative size: 0 = no size, 2 = XS … 6 = XL (see EstimateConstants). Omit if user declined estimates; omitting leaves estimate blank in the UI.'
    ),
    due_date: z
      .string()
      .optional()
      .describe('ISO 8601 date when source material implies a milestone or deadline.'),
  })
  .strict()
  .refine(
    (t) => (t.section_index !== undefined) !== (t.section_title !== undefined),
    {
      message: 'Each task requires exactly one of section_index or section_title',
      path: ['section_index'],
    }
  );

export type CreateBoardTaskManifest = z.infer<typeof CreateBoardTaskManifestSchema>;

/**
 * Schema for create_board tool (HTPR-3142). Agent supplies structure; backend persists atomically.
 */
export function getCreateBoardInputSchema() {
  return z
    .object({
      team_id: z
        .union([z.string().min(1), z.number().int().positive()])
        .describe('Team/workspace id (numeric or UUID string from get_user_context.teams)'),
      title: z.string().min(1).max(200).describe('New board title'),
      description: z.string().optional().describe('Optional board description (HTML if product requires)'),
      sections: z
        .array(z.object({ title: z.string().min(1).max(200) }).strict())
        .min(1)
        .max(50)
        .describe(
          'Delivery workflow columns left-to-right (array order): intake → committed → building → verify → done. Use domain-specific titles (Linear/Jira-style), not phase buckets like Discovery/Foundation unless the user asked for a phased roadmap. Avoid bland generic names as the default choice.'
        ),
      labels: z
        .array(
          z
            .object({
              name: z.string().min(1).max(100),
              color: z.string().optional(),
            })
            .strict()
        )
        .max(100)
        .optional()
        .describe(
          'Optional. Use for area/track/component/risk (e.g. Frontend, Security). Do not encode workflow state in labels—that belongs in sections.'
        ),
      tasks: z
        .array(CreateBoardTaskManifestSchema)
        .max(500)
        .optional()
        .describe(
          'Starter tasks for a realistic delivery board. Large/multi-doc sources may produce many tasks (often 100–250+)—see create_board tool description. Each task: exactly one of section_index or section_title; for new work, bias placement to Triage/Scheduled; avoid parking most cards in In development/In review on a greenfield board. Shipped usually empty unless user said work is done. Each task SHOULD include priority and estimate unless user opted out. tasks[] is flat; use create_task + parent_task_id after board creation for explicit parent/child.'
        ),
      source_summary: z.string().max(32000).optional().describe('Optional audit trail; not used for inference'),
    })
    .strict();
}

export const CreateBoardInputSchema = getCreateBoardInputSchema();
export type CreateBoardInput = z.infer<typeof CreateBoardInputSchema>;

/**
 * Base schema for section CRUD tool - single tool for Create, Read, Update, Delete
 * Action determines which params are required.
 */
export function getSectionCrudBaseSchema() {
  return z
    .object({
      action: z
        .enum(['list', 'get', 'create', 'update', 'delete'])
        .describe(
          "Operation: 'list' = list all columns for a board, 'get' = get one column + its tasks, 'create' = add new column, 'update' = rename/move column, 'delete' = remove column"
        ),
      project_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Project/board ID. Required for list, get, create, update, delete.'),
      section_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Section/column ID. Required for get, update, delete. Use list to find IDs.'),
      title: z
        .string()
        .min(1)
        .max(200)
        .optional()
        .describe('Column title. Required for create. Optional for update (rename).'),
      after_section_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("For create: place new column after this section. For update: use move_after_section_id instead."),
      move_after_section_id: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('For update: move column to appear after this section ID.'),
      is_done: z
        .boolean()
        .nullable()
        .optional()
        .describe(
          'For update: tickets in this column are finished. Reports count them as completed, Inbox Zero clears them, and agents stop treating them as blocking. null clears the flag and falls back to guessing from the column name.'
        ),
      auto_assign: z
        .union([z.number().int().positive(), z.string().trim().min(1)])
        .nullable()
        .optional()
        .describe(
          'For update: numeric user ID or agent UUID to auto-assign tickets entering this column. null clears the rule.'
        ),
      include_hidden: z.boolean().optional().describe('For list: include hidden columns.'),
      include_tasks: z
        .boolean()
        .optional()
        .describe('For get: include tasks in the column. Default true.'),
      limit: z.number().int().positive().optional().describe('For get: max tasks to return. Default 50.'),
      offset: z.number().int().nonnegative().optional().describe('For get: pagination offset.'),
    })
    .strict();
}

/**
 * Section CRUD input with action-based validation
 */
export function getSectionCrudInputSchema() {
  return getSectionCrudBaseSchema().superRefine((data, ctx) => {
    const { action, project_id, section_id, title, move_after_section_id, is_done, auto_assign } = data;

    if (!project_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'project_id is required for all actions', path: ['project_id'] });
    }
    if ((action === 'get' || action === 'update' || action === 'delete') && !section_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'section_id is required for get, update, delete', path: ['section_id'] });
    }
    if (action === 'create' && !title) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'title is required for create', path: ['title'] });
    }
    // is_done can legitimately be null (clear the flag), so check presence, not truthiness.
    if (action === 'update' && !title && !move_after_section_id && is_done === undefined && auto_assign === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one of title, move_after_section_id, is_done or auto_assign is required for update',
        path: ['title'],
      });
    }
  });
}

export const SectionCrudInputSchema = getSectionCrudInputSchema();
export type SectionCrudInput = z.infer<ReturnType<typeof getSectionCrudBaseSchema>>;
