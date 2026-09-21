import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskCreateBoardTool(context: ChatToolContext) {
  const { FREE_BOARD_LIMIT_MESSAGE, createBoardFromManifest, isBoardLimitReached, prisma, sanitizeForJson, sendStatus, tool, user, validateBoardManifest, withToolErrors, z } = context;
  return tool({
      description:
        "Create a new board/project in a team from a structured manifest. Use team_id from hypertask_get_user_context teams[].id.",
      inputSchema: z.object({
        team_id: z
          .string()
          .uuid()
          .describe(
            "Team UUID from hypertask_get_user_context teams[].id. Do not pass a project id, board id, or team title."
          ),
        manifest: z
          .object({
            title: z
              .string()
              .min(1)
              .max(200)
              .describe(
                "Required board title. Use the user's requested board name; do not invent a team or project identifier here."
              ),
            description: z
              .string()
              .optional()
              .describe(
                "Optional board description. Omit when the user did not provide descriptive board text."
              ),
            sections: z
              .array(
                z.object({
                  title: z
                    .string()
                    .min(1)
                    .max(200)
                    .describe(
                      "Section or column title. Use exact user-provided names when available."
                    ),
                })
              )
              .min(1)
              .max(50)
              .describe(
                "Required ordered board sections. Include at least one section; do not add extra columns unless the user asked for them."
              ),
            labels: z
              .array(
                z.object({
                  name: z
                    .string()
                    .min(1)
                    .max(100)
                    .describe(
                      "Label name to create on this new board. Use only labels requested or clearly implied by the manifest."
                    ),
                  color: z
                    .string()
                    .optional()
                    .describe(
                      "Optional label color accepted for manifest parity but not persisted by Hypertask. Omit unless provided by the user."
                    ),
                })
              )
              .max(100)
              .optional()
              .describe(
                "Optional labels for the new board. Omit when the user did not ask for labels."
              ),
            tasks: z
              .array(
                z.object({
                  title: z
                    .string()
                    .min(1)
                    .max(500)
                    .describe(
                      "Task title to seed into the new board. Do not create seed tasks unless the user asked for them."
                    ),
                  description: z
                    .string()
                    .optional()
                    .describe(
                      "Optional task description. Omit when no description was provided for this task."
                    ),
                  section_index: z
                    .number()
                    .int()
                    .min(0)
                    .optional()
                    .describe(
                      "Zero-based index into manifest.sections. Pass exactly one of section_index or section_title for each task."
                    ),
                  section_title: z
                    .string()
                    .optional()
                    .describe(
                      "Section title from manifest.sections. Pass exactly one of section_title or section_index for each task."
                    ),
                  label_names: z
                    .array(z.string())
                    .optional()
                    .describe(
                      "Optional label names to assign to this seed task. Every name must exist in manifest.labels; omit when none apply."
                    ),
                  priority: z
                    .number()
                    .min(0)
                    .max(4)
                    .optional()
                    .describe(
                      "Optional priority index from 0 to 4. Omit unless the user specified priority."
                    ),
                  estimate: z
                    .number()
                    .min(0)
                    .max(7)
                    .optional()
                    .describe(
                      "Optional estimate index from 0 to 7. Omit unless the user specified an estimate."
                    ),
                  due_date: z
                    .string()
                    .optional()
                    .describe(
                      "Optional ISO 8601 due date or datetime. Omit unless the user specified a due date."
                    ),
                })
              )
              .max(500)
              .optional()
              .describe(
                "Optional seed tasks for the new board. Omit when the user only asked to create the board structure."
              ),
            source_summary: z
              .string()
              .optional()
              .describe(
                "Optional manifest provenance summary for callers. Omit unless useful context was explicitly supplied."
              ),
          })
          .describe(
            "Board manifest accepted by validateBoardManifest. Keep it factual and do not invent sections, labels, or tasks."
          ),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_create_board");

        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: {
            id: true,
            email: true,
            displayName: true,
            accountId: true,
          },
        });
        if (!dbUser) {
          return { success: false, error: "User not found" };
        }

        const team = await prisma.team.findUnique({
          where: { id: input.team_id.trim() },
          select: { id: true, googleAccountId: true },
        });
        if (!team) {
          return {
            success: false,
            error: "Not found",
            message: "Team not found",
            details: { field: "team_id", code: "not_found" },
          };
        }

        const membership = await prisma.member_Team.findFirst({
          where: {
            userId: user.id,
            teamId: team.id,
            status: "Accepted",
          },
          select: { id: true },
        });
        const ownsTeam =
          dbUser.accountId != null && dbUser.accountId === team.googleAccountId;

        if (!membership && !ownsTeam) {
          return {
            success: false,
            error: "Forbidden",
            message: "User cannot create boards on this team",
            details: { field: "team_id", code: "forbidden" },
          };
        }

        const validated = validateBoardManifest(input.manifest);
        if (!validated.ok) {
          return {
            success: false,
            error: "validation_error",
            message: validated.message,
            details: { field: validated.field, code: validated.code },
          };
        }

        // HTPR-4894: createBoardFromManifest enforces the same cap by throwing;
        // check up front so the model gets a readable reason to relay instead.
        if (await isBoardLimitReached(user.id)) {
          return {
            success: false,
            error: "board_limit_reached",
            message: FREE_BOARD_LIMIT_MESSAGE,
            details: { field: "board", code: "board_limit_reached" },
          };
        }

        // Chat tool calls are not retried HTTP requests, so skip the MCP Idempotency-Key/Redis replay layer.
        const { board, sections, labels, tasks } = await createBoardFromManifest({
          teamId: team.id,
          googleAccountId: team.googleAccountId,
          manifest: validated.data,
          userId: user.id,
          userEmail: dbUser.email,
          userDisplayName: dbUser.displayName,
        });

        return sanitizeForJson({
          success: true,
          team_id: team.id,
          board,
          sections,
          labels,
          tasks: tasks.map((task) => ({ ...task, task_id: task.id })),
          message: "Board created successfully",
        });
      }),
    });
}
