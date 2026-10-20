import type { TaskWriterCustomFieldValue } from "@/lib/ai/taskWriterCustomFields";
import { tool } from "ai";
import { z } from "zod";
import { buildBulkOperationKey } from "@/app/api/ai/chat/stream/bulkTools";
import { requireCrossMessageConfirmation } from "@/lib/ai/bulkConfirmation";
import { validateProjectAccess, getSectionForTask, validateParentTask, createTask } from "@/lib/mcp/tasks/services";
import prisma from "@/lib/prisma";
import { PriorityConstants } from "@/lib/constants/constants";
import getMemberAndOwner from "@/utils/controllers/getMemberAndOwnerForBoard";
import { toStoredHtml } from "@/utils/helperFunctions/toStoredHtml";
import { buildMcpTaskUrl } from "@/lib/mcp/boards/links";
import { createTaskItemSchema, CreateTaskItemInput } from "@/lib/ai/tools/schemas";
import { MAX_BULK_TOOL_TARGETS } from "@/lib/ai/tools/constants";
import { withToolErrors, dropEmptyPadding } from "@/lib/ai/tools/execution";
import { sanitizeForJson, mapTaskToDetail } from "@/lib/ai/tools/helpers";
import { errorMessage } from "@/lib/ai/chatStream/errors";

import { generateTaskWriterDraft } from "@/app/api/ai/_lib/taskWriterDraft";
import { taskWriterRequestSchema } from "@/app/api/ai/_lib/taskWriterRun";
import { isAgentOnBoard } from "@/utils/controllers/agents/boardMembers";

import type { ToolContext } from "./context";

export function createCreateTaskTool(context: ToolContext) {
  const { sendStatus, user, confirmationSessionId, bulkPreviewsIssued, actingAgentId } = context;
  const { chatTaskWriterEnabled = false, abortSignal } = context;
  const writerItemSchema = createTaskItemSchema.omit({ title: true, description: true, priority: true }).extend({
    brief: z.string().min(1).refine((value) => value.trim().length > 0, "Brief cannot be empty").describe("The user's request in their own words, unabridged, including relevant refinements. Do not pre-write a title or description."),
  });
  const itemSchema = chatTaskWriterEnabled ? writerItemSchema : createTaskItemSchema;
  type TaskInput = Partial<CreateTaskItemInput> & { brief?: string };
  return {
    hypertask_create_task: tool({
      description: chatTaskWriterEnabled
        ? "Create one or many tasks through Task Writer, up to 50 per call. Pass each user request verbatim and unabridged as brief; Task Writer supplies title, description, priority and size. For multiple tasks, use tasks in one call. Returns created tasks and per-task failures."
        : "Create one or many tasks, up to 50 per call. For multiple tasks, pass tasks with each task's project_id and fields in one call instead of looping. Returns created tasks and per-task failures.",
      inputSchema: itemSchema.partial().extend({
        tasks: z
          .array(itemSchema)
          .max(MAX_BULK_TOOL_TARGETS)
          .optional()
          .describe("Tasks to create in one call. Prefer this over repeated tool calls."),
        confirmed: z
          .boolean()
          .optional()
          .describe(
            "Set true ONLY after the user has explicitly approved creating 4 or more tasks in their own message. Never set it to confirm your own proposal."
          ),
      }),
      execute: withToolErrors(async (rawInput) => {
        sendStatus("hypertask_create_task");
        const { tasks: bulkTasks, confirmed, ...singleTask } = rawInput;
        const requestedTasks: TaskInput[] = bulkTasks?.length
          ? bulkTasks
          : [singleTask];
        if (requestedTasks.length >= 4) {
          const operationKey = buildBulkOperationKey(
            "create-tasks",
            requestedTasks.map((task) => ({
              key: JSON.stringify([
                "project",
                task.project_id ?? null,
                chatTaskWriterEnabled ? "brief" : "title",
                (chatTaskWriterEnabled ? task.brief : task.title) ?? null,
              ]),
            }))
          );
          if (
            await requireCrossMessageConfirmation({
              userId: user.id,
              sessionId: confirmationSessionId,
              operationKey,
              confirmed,
              previewsIssuedThisRequest: bulkPreviewsIssued,
            }) === "preview"
          ) {
            return sanitizeForJson({
              success: false,
              confirmation_required: true,
              affected: requestedTasks.map((task) => ({
                project_id: task.project_id,
                ...(chatTaskWriterEnabled ? { brief: task.brief } : { title: task.title }),
              })),
              message:
                `This would create ${requestedTasks.length} tasks. Nothing has been changed yet. ` +
                "End your turn now: list the tasks for the user and ask them to confirm. Only after they say yes, in a new message, call this tool again with confirmed: true.",
            });
          }
        }

        const createOneTask = async (taskInput: TaskInput) => {
          const parsed = itemSchema.safeParse(
            dropEmptyPadding(taskInput, [
              "description",
              "labels",
              "assignee_ids",
              "due_date",
              "section",
            ])
          );
          if (!parsed.success) {
            return { success: false, error: parsed.error.issues[0]?.message ?? "Invalid task" };
          }
          const input = parsed.data;
          let customFields: TaskWriterCustomFieldValue[] | undefined;
          let title = "title" in input ? input.title : "";
          let description = "description" in input ? input.description : undefined;
          let estimateIndex = 0;
          const projectCheck = await validateProjectAccess(input.project_id, user.id);
          if (projectCheck.error) {
            return { success: false, error: projectCheck.error.message };
          }

          let sectionId: number | undefined;
          if (input.section !== undefined) {
            const sectionWhere =
              typeof input.section === "number"
                ? { id: input.section, projectId: input.project_id, deleted: false }
                : {
                  projectId: input.project_id,
                  section_title: input.section,
                  deleted: false,
                };
            const found = await prisma.section.findFirst({
              where: sectionWhere,
              select: { id: true },
            });
            if (!found) {
              return {
                success: false,
                error: `Section "${input.section}" not found in this project`,
              };
            }
            sectionId = found.id;
          }
          const sectionCheck = await getSectionForTask(input.project_id, sectionId);
          if (sectionCheck.error) {
            return { success: false, error: sectionCheck.error.message };
          }
          const parentCheck = await validateParentTask(
            input.project_id,
            input.parent_task_id ?? undefined
          );
          if (parentCheck.error) {
            return { success: false, error: parentCheck.error.message };
          }

          let priorityIndex = "priority" in input && input.priority
            ? PriorityConstants.find((p) => p.Priority_Value === input.priority)
              ?.priority_index ?? 0
            : 0;

          if (input.due_date && isNaN(new Date(input.due_date).getTime())) {
            return { success: false, error: `Invalid due_date: "${input.due_date}". Use an ISO-8601 date.` };
          }

          if (input.assignee_ids?.length) {
            const allowedMemberIds = await getMemberAndOwner(input.project_id);
            if (typeof allowedMemberIds === "string") {
              return { success: false, error: "Could not resolve project members" };
            }
            const allowedSet = new Set<number>(allowedMemberIds);
            const invalidIds = input.assignee_ids.filter((id: number) => !allowedSet.has(id));
            if (invalidIds.length > 0) {
              return {
                success: false,
                error: `User(s) ${invalidIds.join(", ")} are not members of this project and cannot be assigned.`,
              };
            }
          }

          try {
            if (chatTaskWriterEnabled && "brief" in input) {
              if (actingAgentId) {
                const agent = await prisma.agent.findFirst({
                  where: { id: actingAgentId, userId: user.id, revokedAt: null },
                  select: { id: true },
                });
                if (!agent || !(await isAgentOnBoard(input.project_id, actingAgentId))) {
                  return { success: false, error: "This agent is not an active owned member of this board." };
                }
              }
              abortSignal?.throwIfAborted();
              const draft = await generateTaskWriterDraft(taskWriterRequestSchema.parse({
                projectId: input.project_id,
                aiMode: "AiTaskWriter",
                requestKind: "manual",
                PROMPT: input.brief,
                userRetrievalTexts: [input.brief],
              }), user.id, actingAgentId, abortSignal);
              if (!draft.success) return { success: false, error: draft.error };
              if (!draft.title?.trim()) return { success: false, error: "Task Writer returned an empty title. Try again." };
              customFields = draft.customFields;
              title = draft.title;
              description = draft.html;
              priorityIndex = draft.priority ?? 0;
              estimateIndex = draft.estimate ?? 0;
              abortSignal?.throwIfAborted();
            }
            const task = await createTask({
              creationChannel: "agent",
              projectId: input.project_id,
              title,
              description: description ? toStoredHtml(description) : "",
              sectionId: sectionCheck.section.id,
              sectionTitle: sectionCheck.section.section_title,
              userId: user.id,
              priorityIndex,
              estimateIndex,
              dueDate: input.due_date ? new Date(input.due_date) : undefined,
              projectUniqueIdentifier: projectCheck.project.uniqueIdentifier,
              teamId: projectCheck.project.teamId,
              labels: input.labels || [],
              assigneeIds: input.assignee_ids,
              parentTaskId: input.parent_task_id ?? undefined,
              agentId: actingAgentId,
            });

            if (customFields?.length) {
              const { saveWriterCustomFieldValues } = await import("@/utils/controllers/customFields");
              await saveWriterCustomFieldValues(task.id, customFields);
            }

            return sanitizeForJson({
              success: true,
              task: mapTaskToDetail(task, user.id),
              url: buildMcpTaskUrl(task.projectId, task.uniqueIndex),
            });
          } catch (error) {
            return { success: false, error: errorMessage(error) };
          }
        };

        const runOne = async (taskInput: TaskInput) => {
          try {
            return await createOneTask(taskInput);
          } catch (error) {
            return { success: false, error: errorMessage(error) };
          }
        };
        const results: Awaited<ReturnType<typeof runOne>>[] = [];
        const batchSize = chatTaskWriterEnabled ? 3 : requestedTasks.length;
        for (let offset = 0; offset < requestedTasks.length; offset += batchSize) {
          results.push(...await Promise.all(requestedTasks.slice(offset, offset + batchSize).map(runOne)));
        }
        if (!bulkTasks?.length) return results[0];

        const tasks = results.flatMap((result) =>
          result.success && "task" in result ? [result.task] : []
        );
        const failures = results.flatMap((result, index) =>
          result.success
            ? []
            : [{
              project_id: requestedTasks[index].project_id,
              ...(chatTaskWriterEnabled ? { brief: requestedTasks[index].brief } : { title: requestedTasks[index].title }),
              error: "error" in result ? result.error : "Task creation failed",
            }]
        );
        return sanitizeForJson({ success: tasks.length > 0, tasks, failures });
      }),
    }),
  };
}
