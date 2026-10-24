import { assertAgentBoardInviteScope, checkAgentBoardDelegation } from "@/lib/mcp/agents/delegatedAccess";
import { requireRole } from "@/lib/mcp/agents/scopes";
import isProjectAdmin from "@/utils/controllers/projects/isProjectAdmin";
import { tool } from "ai";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { isPlanLimitReachedError, planLimitResponse } from "@/lib/planLimits";
import { updateProjectStatus } from "@/utils/controllers/projects/boardQuota";
import { requireCrossMessageConfirmation } from "@/lib/ai/bulkConfirmation";
import { validateProjectAccess } from "@/lib/mcp/tasks/services";
import { addAgentToBoard } from "@/utils/controllers/agents/boardMembers";
import { addMemberController } from "@/pages/api/invite/createInviteLink";
import { PROJECT_ADMIN_MEMBER_UUID_PATTERN } from "@/lib/ai/tools/constants";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createProjectAdminTool(context: ToolContext) {
  const { sendStatus, user, confirmationSessionId, bulkPreviewsIssued, actingAgentId, teamScope } = context;
  return {
    hypertask_project_admin: tool({
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

          let updated;
          try {
            updated = await updateProjectStatus(project.id, status, {
              actorUserId: user.id,
              agentId: actingAgentId,
              entryPoint: "ai.project_admin.restore",
            });
          } catch (error) {
            if (isPlanLimitReachedError(error)) return planLimitResponse(error).body;
            throw error;
          }

          return sanitizeForJson({ success: true, project: updated });
        }

        const access = actingAgentId
          ? await validateProjectAccess(input.project_id, user.id, actingAgentId, teamScope)
          : await validateProjectAccess(input.project_id, user.id);
        if (access.error) {
          return {
            success: false,
            error:
              access.error.status === 403
                ? "User does not have permission to view members of this project"
                : access.error.message,
          };
        }

        if (actingAgentId) {
          if (!(await isProjectAdmin(user.id, input.project_id))) {
            return { success: false, error: "Only the board owner or a project admin can add members" };
          }
          const ctx = { user, agentId: actingAgentId, teamScope };
          const delegationError = typeof input.userToAdd === "string" && PROJECT_ADMIN_MEMBER_UUID_PATTERN.test(input.userToAdd)
            ? await checkAgentBoardDelegation(ctx, input.userToAdd)
            : await requireRole(ctx, "admin");
          if (delegationError) return sanitizeForJson(await delegationError.json());
          await assertAgentBoardInviteScope(prisma.member, input.project_id, user.id, actingAgentId);
        }

        if (
          typeof input.userToAdd === "string" &&
          PROJECT_ADMIN_MEMBER_UUID_PATTERN.test(input.userToAdd)
        ) {
          const result = await addAgentToBoard(
            input.project_id,
            input.userToAdd,
            user.id,
            actingAgentId,
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
        ], actingAgentId);
        if (result.status !== 200) {
          return { success: false, error: result.json };
        }

        return { success: true, projectId: input.project_id };
      }),
    }),
  };
}
