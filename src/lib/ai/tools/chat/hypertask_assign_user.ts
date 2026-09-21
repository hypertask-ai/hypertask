import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskAssignUserTool(context: ChatToolContext) {
  const { MAX_BULK_TOOL_TARGETS, TOOL_TASK_ID_DESCRIPTION, bulkTaskTargetCount, bulkUserTargetCount, mutateTaskAssignees, sendStatus, tool, withToolErrors, z } = context;
  return tool({
      description:
        "Assign one or more people or board agents to one or many tasks, up to 50 task/assignee pairs per call. For multiple tasks, pass task_ids or ticket_numbers in one call instead of looping. Pass users with user ids, \"me\", people's display names or emails, or agents' display names or UUIDs; user_ids remains supported for people. Additive and idempotent.",
      inputSchema: z
        .object({
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        task_ids: z
          .array(z.coerce.number().int().positive())
          .max(MAX_BULK_TOOL_TARGETS)
          .optional(),
        ticket_number: z.string().optional(),
        ticket_numbers: z
          .array(z.string())
          .max(MAX_BULK_TOOL_TARGETS)
          .optional(),
        unique_index: z.coerce.number().int().positive().optional(),
        project_id: z.coerce.number().int().positive().optional(),
        user_ids: z
          .array(z.coerce.number().int().positive())
          .max(MAX_BULK_TOOL_TARGETS)
          .optional(),
        users: z
          .array(z.union([z.number().int().positive(), z.string().min(1)]))
          .max(MAX_BULK_TOOL_TARGETS)
          .optional(),
        confirmed: z
          .boolean()
          .optional()
          .describe(
            "Set true ONLY after the user has explicitly approved assigning users to 4 or more tasks in their own message. Never set it to confirm your own proposal."
          ),
        })
        .refine(
          (input) => bulkTaskTargetCount(input) <= MAX_BULK_TOOL_TARGETS,
          {
            message: `Pass no more than ${MAX_BULK_TOOL_TARGETS} combined task_ids and ticket_numbers`,
            path: ["task_ids"],
          }
        )
        .refine(
          (input) => bulkUserTargetCount(input) <= MAX_BULK_TOOL_TARGETS,
          {
            message: `Pass no more than ${MAX_BULK_TOOL_TARGETS} combined user_ids and users`,
            path: ["user_ids"],
          }
        )
        .refine(
          (input) =>
            Math.max(1, bulkTaskTargetCount(input)) *
              bulkUserTargetCount(input) <=
            MAX_BULK_TOOL_TARGETS,
          {
            message: `Pass no more than ${MAX_BULK_TOOL_TARGETS} task/user pairs per call`,
            path: ["users"],
          }
        ),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_assign_user");
        return mutateTaskAssignees(input, "assign");
      }),
    });
}
