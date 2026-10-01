import { tool } from "ai";
import { z } from "zod";
import prisma from "@/lib/prisma";
import { deleteCommentService } from "@/utils/controllers/comments/deleteCommentService";
import { broadcastTaskComment } from "@/lib/realtime/server";
import { withToolErrors } from "@/lib/ai/tools/execution";
import { userHasProjectAccess, sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createDeleteCommentTool(context: ToolContext) {
  const { sendStatus, user } = context;
  return {
    hypertask_delete_comment: tool({
      description:
        "Delete one of your comments. HyperAI-authored comments may also be deleted when accessible.",
      inputSchema: z.object({
        comment_id: z.coerce.number().int().positive(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_delete_comment");
        const comment = await prisma.comment.findUnique({
          where: { id: input.comment_id },
          include: {
            task: {
              select: {
                id: true,
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

        const hyperAiId = parseInt(
          process.env.NEXT_PUBLIC_HYPERAI_ID || "332",
          10
        );
        const canDelete =
          comment.creatorId === user.id || comment.creatorId === hyperAiId;
        if (!canDelete) {
          return {
            success: false,
            error: "Permission denied",
            message: "You can only delete your own comments",
          };
        }

        await deleteCommentService({ commentId: input.comment_id });

        void broadcastTaskComment(comment.task.id, { originUserId: user.id });

        return sanitizeForJson({
          success: true,
          message: "Comment deleted",
        });
      }),
    }),
  };
}
