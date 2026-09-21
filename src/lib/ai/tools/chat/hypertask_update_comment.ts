import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskUpdateCommentTool(context: ChatToolContext) {
  const { COMMENT_TASK_LINK_RULE, HTPR_6516_AGENT_ATTRIBUTION_FLAG, actingAgentId, applyDurableCommentAttribution, broadcastTaskComment, commentInclude, convertPlainTextMentionsToHtml, isFeatureEnabled, linkifyTicketRefs, mapCommentToResponse, persistUrlsForComment, prisma, sanitizeForJson, sendStatus, toStoredHtml, tool, updateCommentService, user, userHasProjectAccess, validateMentionUsers, withToolErrors, z } = context;
  return tool({
      description:
        `Update one of your comments. Supports plain-text @mentions; mentioned users must belong to the task project. ${COMMENT_TASK_LINK_RULE}`,
      inputSchema: z.object({
        comment_id: z.coerce.number().int().positive(),
        text: z.string().min(1).max(5000),
        mentions: z
          .array(
            z.object({
              user_id: z.coerce.number().int().positive(),
              display_name: z.string(),
            })
          )
          .optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_update_comment");
        const comment = await prisma.comment.findUnique({
          where: { id: input.comment_id },
          include: {
            task: {
              select: {
                id: true,
                projectId: true,
                project: {
                  select: {
                    ownerId: true,
                    members: { select: { userId: true } },
                  },
                },
              },
            },
          },
        });

        if (!comment) {
          return { success: false, error: "Comment not found" };
        }
        if (!comment.task) {
          return { success: false, error: "Comment is not attached to a task" };
        }
        if (!userHasProjectAccess(comment.task.project, user.id)) {
          return {
            success: false,
            error: "Permission denied",
            message: "You do not have access to this task",
          };
        }
        if (comment.creatorId !== user.id) {
          return {
            success: false,
            error: "Permission denied",
            message: "You can only edit your own comments",
          };
        }

        const mentionError = await validateMentionUsers(
          comment.task.projectId,
          input.mentions
        );
        if (mentionError) {
          return { success: false, error: mentionError };
        }

        // Mentions first, then convert — see hypertask_add_comment for why.
        let sanitizedText = input.text.trim();
        if (input.mentions?.length) {
          sanitizedText = convertPlainTextMentionsToHtml(
            sanitizedText,
            input.mentions
          );
        }
        sanitizedText = toStoredHtml(sanitizedText);
        sanitizedText = await linkifyTicketRefs(
          sanitizedText,
          user.id,
          actingAgentId
        );

        await updateCommentService({
          commentId: input.comment_id,
          text: sanitizedText,
          userId: user.id,
        });

        await persistUrlsForComment(
          sanitizedText,
          comment.task.id,
          input.comment_id,
          "PUT"
        );

        const updatedComment = await prisma.comment.findUnique({
          where: { id: input.comment_id },
          include: commentInclude(user.id, comment.task.projectId),
        });

        void broadcastTaskComment(comment.task.id, { originUserId: user.id });

        const updatedCommentPayload = {
          success: true,
          comment: updatedComment
            ? mapCommentToResponse(
                updatedComment,
                user.id,
                comment.task.projectId
              )
            : { id: input.comment_id, text: sanitizedText },
        };
        if (updatedComment) {
          updatedCommentPayload.comment = applyDurableCommentAttribution(
            updatedCommentPayload.comment,
            updatedComment,
            user.id,
            comment.task.projectId,
            await isFeatureEnabled(HTPR_6516_AGENT_ATTRIBUTION_FLAG, user.id)
          );
        }
        return sanitizeForJson(updatedCommentPayload);
      }),
    });
}
