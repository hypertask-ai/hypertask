import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskTimeReportTool(context: ChatToolContext) {
  const { TOOL_TASK_ID_DESCRIPTION, listReport, resolveTaskForTool, sanitizeForJson, sendStatus, tool, user, withToolErrors, z } = context;
  return tool({
      description:
        "Query up to 1,000 time entries across work the signed-in user can access. Optional filters match the MCP/API report: team, board, task, user, date range, and running-only.",
      inputSchema: z
        .object({
          team_id: z.string().trim().min(1).optional(),
          board_id: z.coerce.number().int().positive().optional(),
          task_id: z.coerce
            .number()
            .int()
            .positive()
            .optional()
            .describe(TOOL_TASK_ID_DESCRIPTION),
          ticket_number: z.string().trim().min(1).optional(),
          unique_index: z.coerce.number().int().positive().optional(),
          project_id: z.coerce.number().int().positive().optional(),
          user: z
            .union([z.literal("me"), z.coerce.number().int().positive()])
            .optional(),
          from: z.string().datetime({ offset: true }).optional(),
          to: z.string().datetime({ offset: true }).optional(),
          running_only: z.boolean().optional().default(false),
        })
        .strict()
        .superRefine((input, ctx) => {
          if (input.unique_index !== undefined && input.project_id === undefined) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["project_id"],
              message: "project_id is required with unique_index",
            });
          }
          if (
            input.project_id !== undefined &&
            input.unique_index === undefined &&
            input.ticket_number === undefined &&
            input.task_id === undefined
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["project_id"],
              message:
                "project_id must scope a task identifier; use board_id to filter a whole board",
            });
          }
          if (
            input.from &&
            input.to &&
            new Date(input.from).getTime() > new Date(input.to).getTime()
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["to"],
              message: "to must be on or after from",
            });
          }
        }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_time_report");
        let taskId: number | undefined;
        if (
          input.task_id !== undefined ||
          input.ticket_number !== undefined ||
          input.unique_index !== undefined
        ) {
          const resolved = await resolveTaskForTool(user, input);
          if (resolved.error || !resolved.task) {
            return {
              success: false,
              error: resolved.error ?? "Task not found or access denied",
            };
          }
          taskId = resolved.task.id;
        }

        const entries = await listReport(user.id, {
          teamId: input.team_id,
          boardId: input.board_id,
          taskId,
          filterUserId:
            input.user === "me"
              ? user.id
              : typeof input.user === "number"
                ? input.user
                : undefined,
          from: input.from ? new Date(input.from) : undefined,
          to: input.to ? new Date(input.to) : undefined,
          runningOnly: input.running_only,
        });
        return sanitizeForJson({ success: true, entries });
      }),
    });
}
