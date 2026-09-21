import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskDraftTool(context: ChatToolContext) {
  const { COMMENT_TASK_LINK_RULE, TOOL_TASK_ID_DESCRIPTION, actingAgentId, broadcastBoardChange, broadcastTaskComment, buildActivityUser, createCommentService, extractTipTapContent, findDraftWithAccess, linkifyTicketRefs, mapDraftToResponse, persistUrlsForComment, persistUrlsForDescription, prisma, resolveTaskForTool, sanitizeForJson, sendStatus, toStoredHtml, tool, updateTaskSingle, user, userHasProjectAccess, validateMentionUserIds, withToolErrors, z } = context;
  return tool({
      description:
        `Create, list, update, publish, or delete task drafts. Draft types are description or comment. Provide whichever task identifier you know; extra identifiers are tolerated. For comment drafts: ${COMMENT_TASK_LINK_RULE}`,
      inputSchema: z.object({
        action: z.enum(["create", "list", "update", "publish", "delete"]),
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        ticket_number: z.string().optional(),
        unique_index: z.coerce.number().int().positive().optional(),
        project_id: z.coerce.number().int().positive().optional(),
        draft_id: z.coerce.number().int().positive().optional(),
        draft_type: z.enum(["description", "comment"]).optional(),
        text: z.string().max(20000).optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_draft");

        if (input.action === "create" || input.action === "list") {
          const taskResult = await resolveTaskForTool(user, {
            task_id: input.task_id,
            ticket_number: input.ticket_number,
            unique_index: input.unique_index,
            project_id: input.project_id,
          });
          if (taskResult.error) {
            return { success: false, error: taskResult.error };
          }

          const task = taskResult.task;
          if (!task) {
            return { success: false, error: "Task not found or access denied" };
          }

          if (input.action === "list") {
            const drafts = await prisma.drafts.findMany({
              where: { taskId: task.id, content: { not: "<p></p>" } },
              include: {
                task: { select: { ticketNumber: true } },
                user: { select: { id: true, email: true, displayName: true } },
              },
              orderBy: { updatedAt: "desc" },
            });

            return sanitizeForJson({
              success: true,
              drafts: drafts.map(mapDraftToResponse),
            });
          }

          if (!input.draft_type) {
            return { success: false, error: "draft_type is required to create a draft" };
          }
          let text = input.text?.trim() ? toStoredHtml(input.text) : undefined;
          if (!text) {
            return { success: false, error: "text is required to create a draft" };
          }

          const draftTypeEnum =
            input.draft_type === "comment" ? "Comment" : "Description";
          if (draftTypeEnum === "Comment") {
            text = await linkifyTicketRefs(text, user.id, actingAgentId);
            const mentionUserIds = extractTipTapContent(text).mentions
              .map((id) => parseInt(id, 10))
              .filter(Number.isInteger);
            const mentionError = await validateMentionUserIds(
              task.projectId,
              mentionUserIds
            );
            if (mentionError) {
              return { success: false, error: mentionError };
            }
          }
          const existing = await prisma.drafts.findFirst({
            where: {
              taskId: task.id,
              type: draftTypeEnum,
              userId: user.id,
            },
          });

          const draft = existing
            ? await prisma.drafts.update({
                where: { id: existing.id },
                data: { content: text },
                include: {
                  task: { select: { ticketNumber: true } },
                  user: { select: { id: true, email: true, displayName: true } },
                },
              })
            : await prisma.drafts.create({
                data: {
                  taskId: task.id,
                  projectId: task.projectId,
                  type: draftTypeEnum,
                  content: text,
                  userId: user.id,
                  saved: true,
                },
                include: {
                  task: { select: { ticketNumber: true } },
                  user: { select: { id: true, email: true, displayName: true } },
                },
              });

          return sanitizeForJson({
            success: true,
            draft: mapDraftToResponse(draft),
            message: "Draft created successfully",
          });
        }

        if (!input.draft_id) {
          return { success: false, error: "draft_id is required for this draft action" };
        }

        const draft = await findDraftWithAccess(input.draft_id);
        if (!draft) {
          return { success: false, error: "Draft not found" };
        }
        if (!draft.task) {
          return { success: false, error: "Draft task not found" };
        }
        if (!userHasProjectAccess(draft.task.project, user.id)) {
          return {
            success: false,
            error: "Permission denied",
            message: "You do not have access to this task",
          };
        }
        if (draft.userId !== user.id) {
          const verb =
            input.action === "publish"
              ? "publish"
              : input.action === "delete"
                ? "delete"
                : "update";
          return {
            success: false,
            error: "Permission denied",
            message: `You can only ${verb} your own drafts`,
          };
        }

        if (input.action === "update") {
          let text = input.text?.trim() ? toStoredHtml(input.text) : undefined;
          if (!text) {
            return { success: false, error: "text is required to update a draft" };
          }
          if (draft.type === "Comment") {
            text = await linkifyTicketRefs(text, user.id, actingAgentId);
            const mentionUserIds = extractTipTapContent(text).mentions
              .map((id) => parseInt(id, 10))
              .filter(Number.isInteger);
            const mentionError = await validateMentionUserIds(
              draft.task.projectId,
              mentionUserIds
            );
            if (mentionError) {
              return { success: false, error: mentionError };
            }
          }
          const updatedDraft = await prisma.drafts.update({
            where: { id: input.draft_id },
            data: {
              content: text,
              updatedAt: new Date(),
            },
            include: {
              task: { select: { ticketNumber: true } },
              user: { select: { id: true, email: true, displayName: true } },
            },
          });

          return sanitizeForJson({
            success: true,
            draft: mapDraftToResponse(updatedDraft),
            message: "Draft updated successfully",
          });
        }

        if (input.action === "delete") {
          await prisma.drafts.delete({ where: { id: input.draft_id } });
          return sanitizeForJson({
            success: true,
            message: "Draft deleted successfully",
          });
        }

        const taskId = draft.taskId;
        const taskTicketNumber = draft.task.ticketNumber || `Task #${taskId}`;

        if (draft.type === "Comment") {
          const commentText = await linkifyTicketRefs(
            draft.content || "",
            user.id,
            actingAgentId
          );
          const mentionUserIds = extractTipTapContent(commentText).mentions
            .map((id) => parseInt(id, 10))
            .filter(Number.isInteger);
          const mentionError = await validateMentionUserIds(
            draft.task.projectId,
            mentionUserIds
          );
          if (mentionError) {
            return { success: false, error: mentionError };
          }

          const taskWithOwner = await prisma.task.findUnique({
            where: { id: taskId },
            select: { userId: true },
          });
          if (!taskWithOwner) {
            return { success: false, error: "Task not found" };
          }

          const userObj = await prisma.user.findUnique({
            where: { id: user.id },
            select: { id: true, email: true, displayName: true, photoURL: true },
          });
          if (!userObj) {
            return { success: false, error: "User not found" };
          }

          const comment = await createCommentService({
            text: commentText,
            creatorId: user.id,
            taskId,
            ownerId: taskWithOwner.userId,
            currentUser: userObj,
            agentId: actingAgentId,
          });

          await persistUrlsForComment(commentText, taskId, comment.id, "POST");
          void broadcastTaskComment(taskId, { originUserId: user.id });

          return sanitizeForJson({
            success: true,
            message: `Draft published — comment added to ${taskTicketNumber}`,
          });
        }

        if (draft.type === "Description") {
          const userObj = await prisma.user.findUnique({
            where: { id: user.id },
            select: { id: true, email: true, displayName: true, photoURL: true },
          });
          if (!userObj) {
            return { success: false, error: "User not found" };
          }

          const result = await updateTaskSingle(
            { id: taskId, description: draft.content },
            buildActivityUser(userObj),
            actingAgentId
          );
          if (result.status !== 200) {
            return {
              success: false,
              error:
                (result.json as { message?: string })?.message ||
                "Failed to publish draft",
            };
          }

          await persistUrlsForDescription(draft.content, taskId);
          void broadcastBoardChange(draft.projectId, { originUserId: user.id });

          return sanitizeForJson({
            success: true,
            message: `Draft published — description updated for ${taskTicketNumber}`,
          });
        }

        return { success: false, error: "Unknown draft type" };
      }),
    });
}
