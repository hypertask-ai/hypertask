import { inlineAgentImagesForUser } from "@/lib/media/inlineAgentImages.server";
import { tool } from "ai";
import { inlineAgentImageFields } from "./schemas";
import { z } from "zod";
import { resolveBulkTaskTargets, buildBulkOperationKey, bulkOperationSubjectKeys } from "@/app/api/ai/chat/stream/bulkTools";
import { requireCrossMessageConfirmation } from "@/lib/ai/bulkConfirmation";
import prisma from "@/lib/prisma";
import { buildMcpTaskUrl } from "@/lib/mcp/boards/links";
import { convertPlainTextMentionsToHtml, resolveTextMentions } from "@/utils/controllers/comments/processMentions";
import { toStoredHtml } from "@/utils/helperFunctions/toStoredHtml";
import { linkifyTicketRefs } from "@/utils/controllers/comments/linkifyTicketRefs";
import { createCommentService } from "@/utils/controllers/comments/createCommentService";
import { buildMcpImageUrls, persistUrlsForComment } from "@/utils/controllers/urls/extractUrlsFromContent";
import { broadcastTaskComment } from "@/lib/realtime/server";
import { COMMENT_TASK_LINK_RULE } from "@/lib/ai/chatStream/prompt";
import { TOOL_TASK_ID_DESCRIPTION, MAX_BULK_TOOL_TARGETS, bulkTaskTargetCount } from "@/lib/ai/tools/constants";
import { withToolErrors, resolveTaskForTool } from "@/lib/ai/tools/execution";
import { sanitizeForJson, commentInclude, mapCommentToResponse, applyDurableCommentAttribution } from "@/lib/ai/tools/helpers";
import { errorMessage } from "@/lib/ai/chatStream/errors";

import type { ToolContext } from "./context";

export function createAddCommentTool(context: ToolContext) {
  const { sendStatus, user, confirmationSessionId, bulkPreviewsIssued, actingAgentId, body } = context;
  return {
    hypertask_add_comment: tool({
      description:
        `Add the same comment to one or many tasks. For multiple tasks, pass up to 50 combined task_ids or ticket_numbers in one call instead of looping. Supports plain-text @mentions and image attachment URLs. ${COMMENT_TASK_LINK_RULE}`,
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
          text: z.string().min(1).max(5000),
          ...inlineAgentImageFields(context.inlineAgentImagesEnabled),
          images: z.array(z.string()).optional(),
          mentions: z
            .array(
              z.object({
                user_id: z.coerce.number().int().positive(),
                display_name: z.string(),
              })
            )
            .optional(),
          confirmed: z
            .boolean()
            .optional()
            .describe(
              "Set true ONLY after the user has explicitly approved commenting on 4 or more tasks in their own message. Never set it to confirm your own proposal."
            ),
        })
        .refine(
          (input) => bulkTaskTargetCount(input) <= MAX_BULK_TOOL_TARGETS,
          {
            message: `Pass no more than ${MAX_BULK_TOOL_TARGETS} combined task_ids and ticket_numbers`,
            path: ["task_ids"],
          }
        ),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_add_comment");
        const targets = resolveBulkTaskTargets(input);
        const resolvedTargets = await Promise.all(
          targets.map(async (identifier) => ({
            identifier,
            resolution: await resolveTaskForTool(user, identifier),
          }))
        );
        const seenTaskIds = new Set<number>();
        const operationTargets = resolvedTargets.filter(({ resolution }) => {
          const taskId = resolution.task?.id;
          if (!taskId) return true;
          if (seenTaskIds.has(taskId)) return false;
          seenTaskIds.add(taskId);
          return true;
        });
        const operationKey = buildBulkOperationKey(
          "comment-on-tasks",
          [],
          [
            ["text", input.text.trim()],
            ...(input.images !== undefined ? [["images", input.images]] : []),
            ...(input.mentions !== undefined ? [["mentions", input.mentions]] : []),
            ...(input.image_urls !== undefined ? [["image_urls", input.image_urls]] : []),
            ...(input.inline_images !== undefined ? [["inline_images", input.inline_images]] : []),
          ]
        );
        if (targets.length >= 4 || input.confirmed !== undefined || bulkPreviewsIssued.has(operationKey)) {
          const operationSubjects = operationTargets.map(({ identifier, resolution }) => ({
            identifier,
            resolvedTaskId: resolution.task?.id ?? null,
          }));
          if (
            await requireCrossMessageConfirmation({
              userId: user.id,
              sessionId: confirmationSessionId,
              operationKey,
              subjectKeys: bulkOperationSubjectKeys(operationSubjects),
              confirmed: input.confirmed,
              ...(context.bulkScopeConfirmationEnabled ? { scopePreviewsThisRequest: context.bulkScopePreviews } : {}),
              previewsIssuedThisRequest: bulkPreviewsIssued,
            }) === "preview"
          ) {
            const affected = await Promise.all(
              resolvedTargets.map(async ({ identifier, resolution }) => {
                if (!resolution.task) {
                  return { ...identifier, error: resolution.error ?? "Not found" };
                }
                const details = await prisma.task.findUnique({
                  where: { id: resolution.task.id },
                  select: { id: true, title: true, projectId: true, uniqueIndex: true },
                });
                return details
                  ? {
                    task_id: details.id,
                    title: details.title,
                    url: buildMcpTaskUrl(details.projectId, details.uniqueIndex),
                  }
                  : { ...identifier, error: "Not found" };
              })
            );
            return sanitizeForJson({
              success: false,
              confirmation_required: true,
              affected,
              ...(input.image_urls !== undefined ? { image_urls: input.image_urls } : {}),
              ...(input.inline_images !== undefined ? { inline_images: input.inline_images } : {}),
              message:
                `This would comment on ${targets.length} tasks. Nothing has been changed yet. ` +
                "If there are more comments in the requested scope, preview them now with confirmed: false too. Then end your turn: list the full scope for the user and ask them to confirm once. Only after they say yes, in a new message, call this tool again with confirmed: true for each batch; the yes covers only previewed tasks with the same comment and attachments.",
            });
          }
        }

        const userObj = await prisma.user.findUnique({
          where: { id: user.id },
          select: { id: true, email: true, displayName: true, photoURL: true },
        });
        if (!userObj) return { success: false, error: "User not found" };

        const addCommentToTask = async ({
          identifier,
          resolution: taskResult,
        }: (typeof operationTargets)[number]) => {
          if (taskResult.error) {
            return { success: false, error: taskResult.error };
          }

          const task = taskResult.task;
          if (!task) {
            return { success: false, error: "Task not found or access denied" };
          }

          const taskWithOwner = await prisma.task.findUnique({
            where: { id: task.id },
            select: { id: true, title: true, userId: true, projectId: true, uniqueIndex: true },
          });
          if (!taskWithOwner) return { success: false, error: "Task not found" };

          let sanitizedText = input.text.trim();
          if (input.mentions?.length) {
            sanitizedText = convertPlainTextMentionsToHtml(sanitizedText, input.mentions);
          }
          sanitizedText = await resolveTextMentions(
            sanitizedText,
            taskWithOwner.projectId,
            user.id,
          );
          sanitizedText = await inlineAgentImagesForUser(toStoredHtml(sanitizedText), user.id, { instructions: body?.message, inlineImages: input.inline_images, attachments: [...(input.images?.map((url: string) => ({ url })) ?? []), ...(input.image_urls?.map((url: string) => ({ url })) ?? []), ...[...(body?.images64 ?? []), ...(body?.attachments ?? [])].flatMap((file) => file.url && (input.image_urls?.includes(file.url) || input.text?.includes(file.url)) ? [{ url: file.url, fileName: file.fileName, mimeType: file.mimeType }] : [])] });
          sanitizedText = await linkifyTicketRefs(
            sanitizedText,
            user.id,
            actingAgentId
          );

          const comment = await createCommentService({
            text: sanitizedText,
            creatorId: user.id,
            taskId: task.id,
            ownerId: taskWithOwner.userId,
            currentUser: userObj,
            agentId: actingAgentId,
          });

          const imageUrls = input.images?.length
            ? buildMcpImageUrls(input.images, task.id)
            : [];
          await persistUrlsForComment(sanitizedText, task.id, comment.id, "POST", imageUrls, { userId: user.id, agentId: actingAgentId, teamScope: context.teamScope });

          const commentWithAttachments = await prisma.comment.findUnique({
            where: { id: comment.id },
            include: commentInclude(user.id, taskWithOwner.projectId),
          });

          void broadcastTaskComment(task.id, { originUserId: user.id });

          const createdCommentPayload = {
            success: true,
            task: {
              id: taskWithOwner.id,
              title: taskWithOwner.title,
              url: buildMcpTaskUrl(taskWithOwner.projectId, taskWithOwner.uniqueIndex),
            },
            comment: commentWithAttachments
              ? mapCommentToResponse(
                commentWithAttachments,
                user.id,
                taskWithOwner.projectId
              )
              : { id: comment.id, text: sanitizedText },
            url: buildMcpTaskUrl(taskWithOwner.projectId, taskWithOwner.uniqueIndex),
          };
          if (commentWithAttachments) {
            createdCommentPayload.comment = applyDurableCommentAttribution(
              createdCommentPayload.comment,
              commentWithAttachments,
              user.id,
              taskWithOwner.projectId
            );
          }
          return sanitizeForJson(createdCommentPayload);
        };

        const results = await Promise.all(
          operationTargets.map(async (target) => {
            try {
              return await addCommentToTask(target);
            } catch (error) {
              return { success: false, error: errorMessage(error) };
            }
          })
        );
        if (results.length === 1) return results[0];

        const tasks = results.flatMap((result) =>
          result.success && "task" in result
            ? [{ ...result.task, comment: result.comment }]
            : []
        );
        const failures = results.flatMap((result, index) =>
          result.success
            ? []
            : [{
              ...operationTargets[index].identifier,
              error: "error" in result ? result.error : "Comment failed",
            }]
        );
        return sanitizeForJson({ success: tasks.length > 0, tasks, failures });
      }),
    }),
  };
}
