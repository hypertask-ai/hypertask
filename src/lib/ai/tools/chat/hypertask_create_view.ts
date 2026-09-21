import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskCreateViewTool(context: ChatToolContext) {
  const { SORTING_MODES, SUBTASK_SETTINGS, createView, sanitizeForJson, sendStatus, tool, user, validateProjectAccess, viewSortingStackSchema, withToolErrors, z } = context;
  return tool({
      description:
        "Create a saved board view: a named, filtered lens on one board (e.g. 'Overdue and mine', 'Bugs'). Filters can be label names and/or assignee user ids. Public = visible to the whole team, Private = only the caller. Returns the view's id, slug, title, and shareable url.",
      inputSchema: z.object({
        project_id: z.coerce.number().int().positive(),
        title: z.string().min(1).max(200),
        visibility: z.enum(["Public", "Private"]).default("Public"),
        label_names: z
          .array(z.string())
          .optional()
          .describe("Only show tasks carrying these labels."),
        assignee_ids: z
          .array(z.union([z.coerce.number().int().positive(), z.string().uuid()]))
          .optional()
          .describe("Only show tasks assigned to these users (numeric id) or agents (uuid)."),
        match: z
          .enum(["ALL", "ANY"])
          .default("ANY")
          .describe("ALL = a task must satisfy every filter; ANY = at least one."),
        sorting_mode: z
          .enum(SORTING_MODES)
          .optional(),
        sorting_order: z.enum(["Ascending", "Descending"]).optional(),
        sorting_stack: viewSortingStackSchema
          .optional()
          .describe("Up to two tie-break sorting levels after sorting_mode."),
        subtask_setting: z
          .enum(SUBTASK_SETTINGS)
          .optional()
          .describe(
            "Subtask display: None hides subtasks and their count; Parent shows parent tasks with a subtask count; Flattened shows subtasks as rows; Card shows subtasks on parent cards; Flattened_Card does both."
          ),
        set_as_default: z
          .boolean()
          .default(false)
          .describe("Make this the board's default view for everyone. Ask first."),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_create_view");

        const access = await validateProjectAccess(input.project_id, user.id);
        if (access.error) {
          return { success: false, error: access.error.message };
        }

        const view = await createView({
          projectId: input.project_id,
          userId: user.id,
          title: input.title,
          visibility: input.visibility,
          filters: {
            label_names: input.label_names,
            assignee_ids: input.assignee_ids,
            match: input.match,
          },
          sorting_mode: input.sorting_mode,
          sorting_order: input.sorting_order,
          sorting_stack: input.sorting_stack,
          subtask_setting: input.subtask_setting,
          setAsDefault: input.set_as_default,
        });

        return sanitizeForJson({ success: true, view });
      }),
    });
}
