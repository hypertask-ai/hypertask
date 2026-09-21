import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";
import type { CreateTaskItemInput } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskCreateTaskTool(context: ChatToolContext) {
  const { MAX_BULK_TOOL_TARGETS, PriorityConstants, actingAgentId, buildBulkOperationKey, buildMcpTaskUrl, bulkPreviewsIssued, confirmationSessionId, createTask, createTaskItemSchema, dropEmptyPadding, errorMessage, getMemberAndOwner, getSectionForTask, mapTaskToDetail, prisma, requireCrossMessageConfirmation, sanitizeForJson, sendStatus, toStoredHtml, tool, user, validateParentTask, validateProjectAccess, withToolErrors, z } = context;
  return tool({
      description:
        "Create one or many tasks, up to 50 per call. For multiple tasks, pass tasks with each task's project_id and fields in one call instead of looping. Returns created tasks and per-task failures.",
      inputSchema: createTaskItemSchema.partial().extend({
        tasks: z
          .array(createTaskItemSchema)
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
        const requestedTasks: Partial<CreateTaskItemInput>[] = bulkTasks?.length
          ? bulkTasks
          : [singleTask];
        if (requestedTasks.length >= 4) {
          const operationKey = buildBulkOperationKey(
            "create-tasks",
            requestedTasks.map((task) => ({
              key: JSON.stringify([
                "project",
                task.project_id ?? null,
                "title",
                task.title ?? null,
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
                title: task.title,
              })),
              message:
                `This would create ${requestedTasks.length} tasks. Nothing has been changed yet. ` +
                "End your turn now: list the tasks for the user and ask them to confirm. Only after they say yes, in a new message, call this tool again with confirmed: true.",
            });
          }
        }

        const createOneTask = async (taskInput: Partial<CreateTaskItemInput>) => {
        const parsed = createTaskItemSchema.safeParse(
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

        const priorityIndex = input.priority
          ? PriorityConstants.find((p) => p.Priority_Value === input.priority)
              ?.priority_index ?? 0
          : 0;

        if (input.due_date && isNaN(new Date(input.due_date).getTime())) {
          return { success: false, error: `Invalid due_date: "${input.due_date}". Use an ISO-8601 date.` };
        }

        // Assignees must be project owner/members — same check hypertask_assign_user does.
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
          const task = await createTask({
            projectId: input.project_id,
            title: input.title,
            description: input.description ? toStoredHtml(input.description) : "",
            sectionId: sectionCheck.section.id,
            sectionTitle: sectionCheck.section.section_title,
            userId: user.id,
            priorityIndex,
            estimateIndex: 0,
            dueDate: input.due_date ? new Date(input.due_date) : undefined,
            projectUniqueIdentifier: projectCheck.project.uniqueIdentifier,
            teamId: projectCheck.project.teamId,
            labels: input.labels || [],
            assigneeIds: input.assignee_ids,
            parentTaskId: input.parent_task_id ?? undefined,
            agentId: actingAgentId,
          });

          return sanitizeForJson({
            success: true,
            task: mapTaskToDetail(task, user.id),
            url: buildMcpTaskUrl(task.projectId, task.uniqueIndex),
          });
        } catch (error) {
          return { success: false, error: errorMessage(error) };
        }
        };

        const results = await Promise.all(
          requestedTasks.map(async (taskInput: Partial<CreateTaskItemInput>) => {
            try {
              return await createOneTask(taskInput);
            } catch (error) {
              return { success: false, error: errorMessage(error) };
            }
          })
        );
        if (!bulkTasks?.length) return results[0];

        const tasks = results.flatMap((result) =>
          result.success && "task" in result ? [result.task] : []
        );
        const failures = results.flatMap((result, index) =>
          result.success
            ? []
            : [{
                project_id: requestedTasks[index].project_id,
                title: requestedTasks[index].title,
                error: "error" in result ? result.error : "Task creation failed",
              }]
        );
        return sanitizeForJson({ success: tasks.length > 0, tasks, failures });
      }),
    });
}
