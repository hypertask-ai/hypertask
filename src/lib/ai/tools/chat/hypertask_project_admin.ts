import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskProjectAdminTool(context: ChatToolContext) {
  const { PROJECT_ADMIN_MEMBER_UUID_PATTERN, addAgentToBoard, addMemberController, bulkPreviewsIssued, confirmationSessionId, prisma, requireCrossMessageConfirmation, sanitizeForJson, sendStatus, tool, user, validateProjectAccess, withToolErrors, z } = context;
  return tool({
      description:
        "Archive or restore an owned board, or invite a human user or agent to an accessible board. project_id must be used verbatim as a board ID returned by a tool or explicitly identified as an ID by the user. Never infer a board from a name or from a number appearing in a board title. If the user names a board ambiguously, ask which board they mean instead of guessing. Archiving requires the board's exact title in expected_title as a safety check. Read that title from a tool result; never invent it. Archiving hides the board for everyone. Inviting grants the person or agent access to the board. Use action archive with status Archive to archive or Normal to restore; use invite_member with userToAdd set to a user ID, email, or agent UUID.",
      inputSchema: z
        .object({
          action: z.enum(["archive", "invite_member"]),
          project_id: z.coerce.number().int().positive(),
          status: z.enum(["Archive", "Normal"]).optional(),
          expected_title: z
            .string()
            .optional()
            .describe(
              "Required for archive. Use the board's exact title from a tool result; do not invent it."
            ),
          confirmed: z
            .boolean()
            .optional()
            .describe(
              "Set true ONLY after the user has explicitly approved this exact archive or restore in their own message. Never set it to confirm your own proposal."
            ),
          userToAdd: z
            .union([
              z.number().int().positive(),
              z
                .string()
                .trim()
                .min(1)
                .refine(
                  (value) =>
                    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ||
                    PROJECT_ADMIN_MEMBER_UUID_PATTERN.test(value),
                  "userToAdd must be an email address or agent UUID"
                ),
            ])
            .optional()
            .describe("Required when action is invite_member."),
        })
        .strict()
        .superRefine((input, ctx) => {
          if (
            input.action === "archive" &&
            (!input.expected_title || input.expected_title.trim().length === 0)
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "expected_title is required for archive",
              path: ["expected_title"],
            });
          }
          if (input.action === "invite_member" && input.userToAdd === undefined) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "userToAdd is required for invite_member",
              path: ["userToAdd"],
            });
          }
        }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_project_admin");

        if (input.action === "archive") {
          const status = input.status ?? "Archive";
          const project = await prisma.project.findFirst({
            where: {
              id: input.project_id,
              ownerId: user.id,
              status: { not: "Deleted" },
            },
            select: { id: true, name: true, title: true, status: true },
          });
          if (!project) {
            return {
              success: false,
              error: "Board not found, or you do not own it",
            };
          }

          const boardTitle = project.title || project.name || "Untitled board";
          const expectedTitle = input.expected_title!.trim();
          if (expectedTitle.toLowerCase() !== boardTitle.trim().toLowerCase()) {
            return sanitizeForJson({
              success: false,
              error: `Board title mismatch: supplied "${expectedTitle}", but board ${project.id}'s actual title is "${boardTitle}". Nothing has been changed.`,
            });
          }

          const operationKey = `project-admin-archive:${project.id}:${status}`;
          if (
            await requireCrossMessageConfirmation({
              userId: user.id,
              sessionId: confirmationSessionId,
              operationKey,
              confirmed: input.confirmed,
              previewsIssuedThisRequest: bulkPreviewsIssued,
            }) === "preview"
          ) {
            // success:false matches the bulk-assign preview, so a model cannot
            // read the preview as "done" and tell the user the board is archived.
            return sanitizeForJson({
              success: false,
              confirmation_required: true,
              affected: [
                {
                  project_id: project.id,
                  title: boardTitle,
                },
              ],
              message:
                `This would ${status === "Archive" ? "archive" : "restore"} board ${project.id}, "${boardTitle}". Nothing has been changed yet. ` +
                "End your turn now: list the affected board for the user and ask them to confirm. Only after they say yes, in a new message, call this tool again with confirmed: true.",
            });
          }

          const updated = await prisma.project.update({
            where: { id: project.id },
            data: { status },
            select: { id: true, name: true, title: true, status: true },
          });

          return sanitizeForJson({ success: true, project: updated });
        }

        const access = await validateProjectAccess(input.project_id, user.id);
        if (access.error) {
          return {
            success: false,
            error:
              access.error.status === 403
                ? "User does not have permission to view members of this project"
                : access.error.message,
          };
        }

        if (
          typeof input.userToAdd === "string" &&
          PROJECT_ADMIN_MEMBER_UUID_PATTERN.test(input.userToAdd)
        ) {
          const result = await addAgentToBoard(
            input.project_id,
            input.userToAdd,
            user.id
          );
          if (!result.ok) {
            return { success: false, error: result.message };
          }

          return {
            success: true,
            projectId: input.project_id,
            agent: {
              id: result.member.agent.id,
              displayName: result.member.agent.displayName,
            },
          };
        }

        let emailToAdd: string | null = null;
        if (typeof input.userToAdd === "string") {
          emailToAdd = input.userToAdd;
        } else if (typeof input.userToAdd === "number") {
          const foundUser = await prisma.user.findUnique({
            where: { id: input.userToAdd },
            select: { email: true },
          });
          if (!foundUser?.email) {
            return {
              success: false,
              error: "User ID does not exist or does not have a valid email",
              details: { field: "userToAdd", code: "user_not_found" },
            };
          }
          emailToAdd = foundUser.email;
        }

        if (!emailToAdd) {
          return {
            success: false,
            error: "Could not resolve a valid email address to add",
            details: { field: "userToAdd", code: "missing_email" },
          };
        }

        const result = await addMemberController(user.id, input.project_id, [
          emailToAdd,
        ]);
        if (result.status !== 200) {
          return { success: false, error: result.json };
        }

        return { success: true, projectId: input.project_id };
      }),
    });
}
