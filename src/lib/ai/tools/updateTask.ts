import { updateTaskSchema } from "./updateTaskSchema";
import { createTaskUpdater } from "./updateOneTask";
import { tool } from "ai";

import { resolveBulkTaskTargets, updateTasksNeedConfirmation, buildBulkOperationKey } from "@/app/api/ai/chat/stream/bulkTools";
import prisma from "@/lib/prisma";

import { buildMcpTaskUrl } from "@/lib/mcp/boards/links";
import { requireCrossMessageConfirmation } from "@/lib/ai/bulkConfirmation";

import { withToolErrors, dropEmptyPadding, resolveTaskForTool } from "@/lib/ai/tools/execution";
import { sanitizeForJson } from "@/lib/ai/tools/helpers";
import { errorMessage } from "@/lib/ai/chatStream/errors";

import type { ToolContext } from "./context";

export function createUpdateTaskTool(context: ToolContext) {
  const { sendStatus, user, confirmationSessionId, bulkPreviewsIssued } = context;
  return {
    hypertask_update_task: tool({
      description:
        "Update one or many tasks' titles, descriptions, priorities, estimates, due dates, labels, parents, or statuses (Normal/Archive/Deleted), or move them within their own boards. Use task_ids or ticket_numbers to update up to 50 tasks in one call instead of looping. Provide whichever task identifier you know; extra identifiers are tolerated.",
      inputSchema: updateTaskSchema,
      execute: withToolErrors(async (rawInput) => {
        sendStatus("hypertask_update_task");
        const input = dropEmptyPadding(rawInput, [
          "title",
          "description",
          "labels",
          "add_labels",
          "remove_labels",
          "ticket_number",
          "task_ids",
          "ticket_numbers",
          "due_date",
        ]);
        const updateOneTask = createTaskUpdater(context, input);

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
        // HTPR-4218: wide or destructive writes get shown to the user first.
        const destructive =
          input.status === "Deleted" || input.status === "Archive";
        // HTPR-5536: a tag change is reversible, so it never confirms.
        const needsConfirmation = updateTasksNeedConfirmation({
          targetCount: targets.length,
          update: input,
        });
        if (needsConfirmation) {
          const operationChanges: unknown[] = [];
          if (input.title !== undefined) {
            operationChanges.push(["title", input.title]);
          }
          if (input.description !== undefined) {
            operationChanges.push(["description", input.description]);
          }
          if (input.priority !== undefined) {
            operationChanges.push(["priority", input.priority]);
          }
          if (input.estimate !== undefined) {
            operationChanges.push(["estimate", input.estimate]);
          }
          if (input.due_date !== undefined) {
            operationChanges.push(["due_date", input.due_date]);
          }
          if (input.status !== undefined) {
            operationChanges.push(["status", input.status]);
          }
          if (input.parent_task_id !== undefined) {
            operationChanges.push(["parent_task_id", input.parent_task_id]);
          }
          if (input.section !== undefined) {
            operationChanges.push(["section", input.section]);
          }
          if (input.labels !== undefined) {
            operationChanges.push([
              "labels",
              [...input.labels].sort((left, right) =>
                JSON.stringify(left).localeCompare(JSON.stringify(right))
              ),
            ]);
          }
          if (input.add_labels !== undefined) {
            operationChanges.push([
              "add_labels",
              [...input.add_labels].sort((left, right) =>
                JSON.stringify(left).localeCompare(JSON.stringify(right))
              ),
            ]);
          }
          if (input.remove_labels !== undefined) {
            operationChanges.push([
              "remove_labels",
              [...input.remove_labels].sort((left, right) =>
                JSON.stringify(left).localeCompare(JSON.stringify(right))
              ),
            ]);
          }
          const operationKey = buildBulkOperationKey(
            "update-tasks",
            operationTargets.map(({ identifier, resolution }) => ({
              identifier,
              resolvedTaskId: resolution.task?.id ?? null,
            })),
            operationChanges
          );
          if (
            await requireCrossMessageConfirmation({
              userId: user.id,
              sessionId: confirmationSessionId,
              operationKey,
              confirmed: input.confirmed,
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
                if (!details) {
                  return { ...identifier, error: "Not found" };
                }
                return {
                  task_id: details.id,
                  title: details.title,
                  url: buildMcpTaskUrl(details.projectId, details.uniqueIndex),
                };
              })
            );
            return sanitizeForJson({
              success: false,
              confirmation_required: true,
              affected,
              message:
                `This would change ${targets.length} tasks` +
                (destructive ? ` (status: ${input.status})` : "") +
                ". Nothing has been changed yet. End your turn now: list the affected tasks for the user and ask them to confirm. Only after they say yes, in a new message, call this tool again with confirmed: true.",
            });
          }
        }

        const results = await Promise.all(
          operationTargets.map(async ({ identifier, resolution }) => {
            try {
              return await updateOneTask(identifier, resolution);
            } catch (error) {
              return { success: false, error: errorMessage(error) };
            }
          })
        );

        if (results.length === 1) return results[0];

        const tasks = results.flatMap((result) =>
          result.success && "task" in result ? [result.task] : []
        );
        const failures = results.flatMap((result, index) =>
          "task" in result
            ? []
            : [{
              ...operationTargets[index].identifier,
              error: "error" in result ? result.error : "Task update failed",
            }]
        );
        return sanitizeForJson({
          success: tasks.length > 0,
          partial: tasks.length > 0 && failures.length > 0,
          succeeded_count: tasks.length,
          failed_count: failures.length,
          tasks,
          failures,
        });
      }),
    }),
  };
}
