import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskUpdateViewTool(context: ChatToolContext) {
  const { SORTING_MODES, SUBTASK_SETTINGS, sanitizeForJson, sendStatus, tool, updateView, user, viewSortingStackSchema, withToolErrors, z } = context;
  return tool({
      description:
        "Edit an existing saved board view: rename it, change its filters (label names / assignee ids), visibility, or sorting. Find the id with hypertask_list_views first. Only provide the fields you want to change. Cannot edit someone else's private view. Returns the view's id, slug, title, and shareable url.",
      inputSchema: z.object({
        view_id: z.string().min(1),
        title: z.string().min(1).max(200).optional(),
        visibility: z.enum(["Public", "Private"]).optional(),
        label_names: z
          .array(z.string())
          .optional()
          .describe(
            "Replace the view's label filter with these labels. Pass [] to clear it."
          ),
        assignee_ids: z
          .array(z.union([z.coerce.number().int().positive(), z.string().uuid()]))
          .optional()
          .describe(
            "Replace the view's assignee filter with these user ids (numeric) or agent ids (uuid). Pass [] to clear it."
          ),
        match: z
          .enum(["ALL", "ANY"])
          .optional()
          .describe("ALL = a task must satisfy every filter; ANY = at least one."),
        sorting_mode: z
          .enum(SORTING_MODES)
          .optional(),
        sorting_order: z.enum(["Ascending", "Descending"]).optional(),
        sorting_stack: viewSortingStackSchema
          .optional()
          .describe(
            "Replace the view's tie-break sorting levels. Pass [] to clear them."
          ),
        subtask_setting: z
          .enum(SUBTASK_SETTINGS)
          .optional()
          .describe(
            "Subtask display: None hides subtasks and their count; Parent shows parent tasks with a subtask count; Flattened shows subtasks as rows; Card shows subtasks on parent cards; Flattened_Card does both."
          ),
        set_as_default: z
          .boolean()
          .optional()
          .describe("Make this the board's default view for everyone. Ask first."),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_update_view");
        const filtersProvided =
          input.label_names !== undefined ||
          input.assignee_ids !== undefined ||
          input.match !== undefined;
        const updated = await updateView({
          viewId: input.view_id,
          userId: user.id,
          title: input.title,
          visibility: input.visibility,
          filters: filtersProvided
            ? {
                label_names: input.label_names,
                assignee_ids: input.assignee_ids,
                match: input.match,
              }
            : undefined,
          sorting_mode: input.sorting_mode,
          sorting_order: input.sorting_order,
          sorting_stack: input.sorting_stack,
          subtask_setting: input.subtask_setting,
          setAsDefault: input.set_as_default,
        });
        return sanitizeForJson({ success: true, view: updated });
      }),
    });
}
