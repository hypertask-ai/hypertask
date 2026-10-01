import { tool } from "ai";
import { z } from "zod";
import { validateProjectAccess } from "@/lib/mcp/tasks/services";
import prisma from "@/lib/prisma";
import { htmlToMarkdown } from "@/utils/controllers/pages/htmlToMarkdown";
import upsertTaskDescription from "@/utils/controllers/description/common-description-create";
import { broadcastBoardChange, broadcastTaskChange } from "@/lib/realtime/server";
import { TOOL_TASK_ID_DESCRIPTION } from "@/lib/ai/tools/constants";
import { withToolErrors, resolveTaskForTool } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";

import type { ToolContext } from "./context";

export function createTaskDescriptionHistoryTool(context: ToolContext) {
  const { sendStatus, user } = context;
  return {
    hypertask_task_description_history: tool({
      description:
        "List a task description's saved versions or restore one. Restore REPLACES the current description with the selected saved version. Always list versions first to get the required version_id.",
      inputSchema: z.object({
        action: z.enum(["versions", "restore"]),
        task_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe(TOOL_TASK_ID_DESCRIPTION),
        ticket_number: z.string().trim().min(1).optional(),
        unique_index: z.coerce.number().int().positive().optional(),
        project_id: z.coerce.number().int().positive().optional(),
        version_id: z.coerce
          .number()
          .int()
          .positive()
          .optional()
          .describe("Required when action is restore."),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_task_description_history");
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

        const access = await validateProjectAccess(task.projectId, user.id);
        if (access.error) {
          return { success: false, error: "Task not found or access denied" };
        }

        if (input.action === "versions") {
          const versions = await prisma.docVersion.findMany({
            where: { entityType: "task_description", entityId: task.id },
            orderBy: [{ version: "desc" }, { createdAt: "desc" }],
            select: {
              id: true,
              version: true,
              contentHtml: true,
              authorId: true,
              agentId: true,
              note: true,
              createdAt: true,
            },
          });

          return sanitizeForJson({
            success: true,
            versions: versions.map((version) => ({
              id: version.id,
              version: version.version,
              content: htmlToMarkdown(version.contentHtml),
              author_id: version.authorId,
              agent_id: version.agentId,
              note: version.note,
              created_at: version.createdAt,
            })),
          });
        }

        if (input.version_id === undefined) {
          return { success: false, error: "version_id is required for restore" };
        }

        const snapshot = await prisma.docVersion.findFirst({
          where: {
            id: input.version_id,
            entityType: "task_description",
            entityId: task.id,
          },
          select: { contentHtml: true, version: true },
        });
        if (!snapshot) {
          return {
            success: false,
            error: "Version not found for this task",
          };
        }

        await upsertTaskDescription({
          taskId: task.id,
          creatorId: user.id,
          content: snapshot.contentHtml,
          actingUserId: user.id,
        });

        void broadcastBoardChange(task.projectId, { originUserId: user.id });
        void broadcastTaskChange(task.id, { originUserId: user.id });

        return {
          success: true,
          restored_from_version: snapshot.version,
        };
      }),
    }),
  };
}
