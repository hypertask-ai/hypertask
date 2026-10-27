import { isPlanLimitReachedError, planLimitResponse } from "@/lib/planLimits";
import { inlineAgentImagesForUser } from "@/lib/media/inlineAgentImages.server";
import { HTPR_7513_WRITER_PROJECT_LABELS_FLAG } from "@/lib/flags/keys";
import { isFeatureEnabled } from "@/lib/flags";
import type { TaskWriterCustomFieldValue } from "@/lib/ai/taskWriterCustomFields";
import { tool } from "ai";
import { z } from "zod";
import { buildBulkOperationKey } from "@/app/api/ai/chat/stream/bulkTools";
import { requireCrossMessageConfirmation } from "@/lib/ai/bulkConfirmation";
import { validateProjectAccess, getSectionForTask, validateParentTask, createTask } from "@/lib/mcp/tasks/services";
import prisma from "@/lib/prisma";
import { HTPR_7758_PROGRESSIVE_CHAT_CREATE_FLAG } from "@/lib/flags/definitions/htpr-7758-progressive-chat-create";
import { taskTitleFromBrief } from "@/lib/ai/taskWriterDuplicateGuard";
import { escapeHtml } from "@/utils/helperFunctions/escapeHtml";
import { createTaskUpdater } from "./updateOneTask";
import { PriorityConstants } from "@/lib/constants/constants";
import getMemberAndOwner from "@/utils/controllers/getMemberAndOwnerForBoard";
import { toStoredHtml } from "@/utils/helperFunctions/toStoredHtml";
import { buildMcpTaskUrl } from "@/lib/mcp/boards/links";
import { getCreateTaskItemSchema, CreateTaskItemInput } from "@/lib/ai/tools/schemas";
import { MAX_BULK_TOOL_TARGETS } from "@/lib/ai/tools/constants";
import { withToolErrors, dropEmptyPadding } from "@/lib/ai/tools/execution";
import { sanitizeForJson, mapTaskToDetail } from "@/lib/ai/tools/helpers";
import { errorMessage } from "@/lib/ai/chatStream/errors";

import { generateTaskWriterDraft } from "@/app/api/ai/_lib/taskWriterDraft";
import { taskWriterRequestSchema } from "@/app/api/ai/_lib/taskWriterRun";
import { isAgentOnBoard } from "@/utils/controllers/agents/boardMembers";

import type { ToolContext } from "./context";

export function createCreateTaskTool(context: ToolContext) {
  const { sendStatus, send, user, confirmationSessionId, bulkPreviewsIssued, actingAgentId, body } = context;
  const { chatTaskWriterEnabled = false, abortSignal } = context;
  const createTaskItemSchema = getCreateTaskItemSchema(context.inlineAgentImagesEnabled);
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
                ...(task.image_urls !== undefined ? [["image_urls", task.image_urls]] : []),
                ...(task.inline_images !== undefined ? [["inline_images", task.inline_images]] : []),
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
                ...(task.image_urls !== undefined ? { image_urls: task.image_urls } : {}),
                ...(task.inline_images !== undefined ? { inline_images: task.inline_images } : {}),
              })),
              message:
                `This would create ${requestedTasks.length} tasks. Nothing has been changed yet. ` +
                "End your turn now: list the tasks for the user and ask them to confirm. Only after they say yes, in a new message, call this tool again with confirmed: true.",
            });
          }
        }

        const createOneTask = async (taskInput: TaskInput) => {
          const creationStartedAt = Date.now();
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
          let labels = input.labels || [];
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

          let earlyTask: Awaited<ReturnType<typeof createTask>> | undefined;
          const savedResult = (task: Awaited<ReturnType<typeof createTask>>, warning?: string) => sanitizeForJson({
            success: true,
            task: mapTaskToDetail(task, user.id),
            url: buildMcpTaskUrl(task.projectId, task.uniqueIndex),
            ...(warning ? { warning } : {}),
          });
          const save = async (taskTitle: string, taskDescription?: string, titleOnly = false) => createTask({
            creationChannel: "agent",
            projectId: input.project_id,
            title: taskTitle,
            description: titleOnly ? "" : await inlineAgentImagesForUser(taskDescription ? toStoredHtml(taskDescription) : "", user.id, { instructions: body?.message, inlineImages: input.inline_images, attachments: [...(input.image_urls?.map((url) => ({ url })) ?? []), ...[...(body?.images64 ?? []), ...(body?.attachments ?? [])].flatMap((file) => file.url && (input.image_urls?.includes(file.url) || taskDescription?.includes(file.url)) ? [{ url: file.url, fileName: file.fileName, mimeType: file.mimeType }] : [])] }),
            sectionId: sectionCheck.section.id,
            sectionTitle: sectionCheck.section.section_title,
            userId: user.id,
            priorityIndex,
            estimateIndex,
            dueDate: input.due_date ? new Date(input.due_date) : undefined,
            projectUniqueIdentifier: projectCheck.project.uniqueIdentifier,
            teamId: projectCheck.project.teamId,
            labels,
            assigneeIds: input.assignee_ids,
            parentTaskId: input.parent_task_id ?? undefined,
            agentId: actingAgentId,
          });
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
              const createBeforeWriting = await isFeatureEnabled(HTPR_7758_PROGRESSIVE_CHAT_CREATE_FLAG, user.id);
              const publishTicket = async () => {
                abortSignal?.throwIfAborted();
                const initialTitle = taskTitleFromBrief(input.brief);
                if (!initialTitle) throw new Error("Provide a task brief with a usable title.");
                earlyTask = await save(initialTitle, undefined, true);
                const propertyDefaults = {
                  taskId: earlyTask.id,
                  sectionId: sectionCheck.section.id,
                  projectId: input.project_id,
                  addedByUserId: user.id,
                };
                await prisma.$transaction([
                  prisma.priority.createMany({ data: { ...propertyDefaults, priority_index: 0, Priority_Value: "No Priority" }, skipDuplicates: true }),
                  prisma.estimate.createMany({ data: { ...propertyDefaults, estimate_index: 0, estimate_value: "No size" }, skipDuplicates: true }),
                ]);
                send("task_created", {
                  content: `<p><a href="${escapeHtml(buildMcpTaskUrl(earlyTask.projectId, earlyTask.uniqueIndex))}">${escapeHtml(earlyTask.ticketNumber || initialTitle)}</a></p>`,
                });
                send("status", { content: "Ticket created. Writing its description…" });
              };
              const draft = await generateTaskWriterDraft(taskWriterRequestSchema.parse({
                projectId: input.project_id,
                aiMode: "AiTaskWriter",
                requestKind: "manual",
                PROMPT: input.brief,
                userRetrievalTexts: [input.brief],
              }), user.id, actingAgentId, abortSignal, undefined, createBeforeWriting ? publishTicket : undefined);
              if (!draft.success) throw new Error(draft.error);
              if (!draft.title?.trim()) throw new Error("Task Writer returned an empty title. Try again.");
              if (!labels.length && draft.labelIds?.length &&
                  await isFeatureEnabled(HTPR_7513_WRITER_PROJECT_LABELS_FLAG, user.id)) {
                labels = draft.labelIds;
              }
              customFields = draft.customFields;
              title = draft.title;
              description = draft.html;
              priorityIndex = draft.priority ?? 0;
              estimateIndex = draft.estimate ?? 0;
              abortSignal?.throwIfAborted();
            }
            const saveStartedAt = Date.now();
            let task;
            let updatedResult;
            if (earlyTask) {
              const update = await createTaskUpdater(context, {
                title,
                description,
                priority: z.enum(["No Priority", "Urgent", "High", "Medium", "Low"]).parse(PriorityConstants.find((p) => p.priority_index === priorityIndex)?.Priority_Value ?? "No Priority"),
                estimate: estimateIndex,
                ...(labels.length ? { add_labels: labels } : {}),
                image_urls: input.image_urls,
                inline_images: input.inline_images,
              }, {
                expectedTitle: earlyTask.title,
                expectedDescription: "",
                expectedProjectId: earlyTask.projectId,
                expectedStatus: "Normal",
              })({ task_id: earlyTask.id, project_id: earlyTask.projectId });
              if (!update.success) throw new Error("error" in update ? update.error : "Failed to finish the description");
              task = earlyTask;
              updatedResult = update;
            } else {
              task = await save(title, description);
            }

            if (customFields?.length) {
              const { saveWriterCustomFieldValues } = await import("@/utils/controllers/customFields");
              await saveWriterCustomFieldValues(task.id, customFields);
            }

            if (earlyTask) send("task_updated", { taskId: task.id });

            console.info(`[ai/chat-task-create] stages ${JSON.stringify({
              projectId: input.project_id,
              writer: chatTaskWriterEnabled && "brief" in input,
              saveMs: Date.now() - saveStartedAt,
              toolMs: Date.now() - creationStartedAt,
            })}`);

            return updatedResult ?? savedResult(task);
          } catch (error) {
            if (earlyTask) {
              const warning = "Ticket created; description unfinished. Any saved edits remain. Open this ticket to finish it. Do not create another.";
              send("task_created", { content: `<p>${warning}</p>` });
              return savedResult(earlyTask, warning);
            }
            if (isPlanLimitReachedError(error)) return planLimitResponse(error).body;
            return { success: false, error: errorMessage(error) };
          }
        };

        const runOne = async (taskInput: TaskInput) => {
          try {
            return await createOneTask(taskInput);
          } catch (error) {
            if (isPlanLimitReachedError(error)) return planLimitResponse(error).body;
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
              ...(isPlanLimitReachedError(result) ? planLimitResponse(result).body : {}),
            }]
        );
        return sanitizeForJson({ success: tasks.length > 0, tasks, failures });
      }),
    }),
  };
}
