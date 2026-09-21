import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";
import type { ResolveTaskForToolResult } from "@/app/api/ai/chat/stream/buildTools";
import type { ToolTaskIdentifierInput } from "@/app/api/ai/chat/stream/buildTools";

export function createHypertaskUpdateTaskTool(context: ChatToolContext) {
  const { MAX_BULK_TOOL_TARGETS, TOOL_TASK_ID_DESCRIPTION, actingAgentId, applyEstimateUpdate, applyPriorityUpdate, broadcastBoardChange, broadcastTaskChange, buildActivityUser, buildBulkOperationKey, buildMcpTaskUrl, bulkPreviewsIssued, bulkTaskTargetCount, cancelDueDateJob, confirmationSessionId, createArchiveActivity, createTaskDueDateActivity, dropEmptyPadding, errorMessage, generateRank, mapTaskToDetail, mutateTaskLabels, prisma, requireCrossMessageConfirmation, resolveBulkTaskTargets, resolveTaskForTool, sanitizeForJson, scheduleDueDateJob, sendNotificationForTask, sendStatus, setTaskLabels, taskDetailInclude, toStoredHtml, tool, updateTaskSingle, updateTasksNeedConfirmation, user, withToolErrors, z } = context;
  return tool({
      description:
        "Update one or many tasks' titles, descriptions, priorities, estimates, due dates, labels, parents, or statuses (Normal/Archive/Deleted), or move them within their own boards. Use task_ids or ticket_numbers to update up to 50 tasks in one call instead of looping. Provide whichever task identifier you know; extra identifiers are tolerated.",
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
        title: z.string().min(1).max(500).optional(),
        description: z.string().max(20000).optional(),
        priority: z
          .enum(["No Priority", "Urgent", "High", "Medium", "Low"])
          .optional(),
        estimate: z.coerce
          .number()
          .int()
          .refine((value) => [0, 2, 3, 4, 5, 6].includes(value), {
            message: "estimate must be one of 0, 2, 3, 4, 5, 6",
          })
          .optional()
          .describe(
            "Story-point estimate. Allowed values: 0 (none), 2, 3, 4, 5, 6."
          ),
        due_date: z.string().nullable().optional(),
        status: z.enum(["Normal", "Archive", "Deleted"]).optional(),
        parent_task_id: z.coerce.number().int().positive().nullable().optional(),
        section: z
          .union([z.coerce.number().int().positive(), z.string().min(1)])
          .optional()
          .describe(
            "Only pass section when the user explicitly asks to move the task to a different section/column. Never infer it."
          ),
        labels: z
          .array(z.union([z.string(), z.number()]))
          .optional()
          .describe(
            "Label names or ids. This REPLACES every label on the task, so any label not listed here is removed. To add or remove a single tag while keeping the others, use add_labels/remove_labels instead."
          ),
        add_labels: z
          .array(z.union([z.string(), z.number()]))
          .optional()
          .describe(
            "Label names or ids to add, leaving the task's other labels untouched."
          ),
        remove_labels: z
          .array(z.union([z.string(), z.number()]))
          .optional()
          .describe(
            "Label names or ids to remove, leaving the task's other labels untouched."
          ),
        confirmed: z
          .boolean()
          .optional()
          .describe(
            "Set true ONLY after the user has explicitly approved this exact wide/destructive write in their own message. Never set it to confirm your own proposal."
          ),
        })
        .refine(
          (input) => bulkTaskTargetCount(input) <= MAX_BULK_TOOL_TARGETS,
          {
            message: `Pass no more than ${MAX_BULK_TOOL_TARGETS} combined task_ids and ticket_numbers`,
            path: ["task_ids"],
          }
        ),
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
        const updateOneTask = async (
          identifier: ToolTaskIdentifierInput,
          taskResult?: ResolveTaskForToolResult
        ) => {
          taskResult ??= await resolveTaskForTool(user, identifier);
        if (taskResult.error) {
          return { success: false, error: taskResult.error };
        }

        const hasNonSectionUpdate =
          input.title !== undefined ||
          input.description !== undefined ||
          input.priority !== undefined ||
          input.estimate !== undefined ||
          input.due_date !== undefined ||
          input.status !== undefined ||
          input.parent_task_id !== undefined ||
          input.labels !== undefined ||
          input.add_labels !== undefined ||
          input.remove_labels !== undefined;
        const hasUpdate = hasNonSectionUpdate || input.section !== undefined;
        if (!hasUpdate) {
          return { success: false, error: "Provide at least one field to update" };
        }

        const task = taskResult.task;
        if (!task) {
          return { success: false, error: "Task not found or access denied" };
        }

        let sectionTarget: { id: number; section_title: string } | null = null;
        let sectionWarning: string | undefined;
        if (input.section !== undefined) {
          const sectionWhere =
            typeof input.section === "number"
              ? { id: input.section, projectId: task.projectId, deleted: false }
              : {
                  projectId: task.projectId,
                  section_title: input.section,
                  deleted: false,
                };
          sectionTarget = await prisma.section.findFirst({
            where: sectionWhere,
            select: { id: true, section_title: true },
          });
          if (!sectionTarget) {
            if (hasNonSectionUpdate) {
              sectionWarning = `Section "${input.section}" not found on this board -- section unchanged; other fields updated.`;
            } else {
              return {
                success: false,
                error: `Section "${input.section}" not found in this task's board. Cross-board moves aren't supported here.`,
              };
            }
          }
        }

        const userObj = await prisma.user.findUnique({
          where: { id: user.id },
          select: { id: true, email: true, displayName: true, photoURL: true },
        });
        if (!userObj) return { success: false, error: "User not found" };
        const activityUser = buildActivityUser(userObj);

        const oldTask = await prisma.task.findUnique({
          where: { id: task.id },
          select: { section: true, sectionId: true, status: true, dueDate: true },
        });
        if (!oldTask) return { success: false, error: "Task not found" };

        const patch: Record<string, unknown> = { id: task.id };
        if (input.title !== undefined) patch.title = input.title;
        if (input.description !== undefined)
          patch.description = toStoredHtml(input.description);
        if (input.parent_task_id !== undefined) patch.parentTaskId = input.parent_task_id;
        const dueDateValue =
          input.due_date === undefined
            ? undefined
            : input.due_date === null
              ? null
              : new Date(input.due_date);
        if (dueDateValue instanceof Date && isNaN(dueDateValue.getTime())) {
          return { success: false, error: `Invalid due_date: "${input.due_date}". Use an ISO-8601 date.` };
        }
        if (dueDateValue !== undefined) patch.dueDate = dueDateValue;
        if (input.status !== undefined) {
          patch.status = input.status;
          patch.archivedAt = input.status === "Archive" ? new Date() : null;
        }
        if (sectionTarget) {
          const lastTask = await prisma.task.findFirst({
            where: {
              sectionId: sectionTarget.id,
              projectId: task.projectId,
              status: "Normal",
            },
            orderBy: { ranking: "desc" },
            select: { ranking: true },
          });
          patch.sectionId = sectionTarget.id;
          patch.section = sectionTarget.section_title;
          patch.ranking = generateRank(lastTask?.ranking, undefined);
        }

        if (Object.keys(patch).length > 1) {
          const result = await updateTaskSingle(
            patch,
            activityUser,
            actingAgentId,
            sectionTarget
              ? {
                  taskMovedActivity: {
                    sendNotification: () =>
                      sendNotificationForTask(
                        user.id,
                        "TaskMoved",
                        task.id,
                        task.projectId,
                        actingAgentId ?? undefined,
                      ),
                  },
                }
              : {},
          );
          if (result.status !== 200) {
            return {
              success: false,
              error:
                (result.json as { message?: string })?.message ||
                "Failed to update task",
            };
          }
        }

        if (input.status !== undefined && oldTask.status !== input.status) {
          await createArchiveActivity({
            taskId: task.id,
            fromUserId: user.id,
            fromUserDisplayName: userObj.displayName ?? "",
            fromUser: activityUser,
            newStatus: input.status,
          });
          if (input.status === "Archive") {
            await cancelDueDateJob(task.id, task.projectId);
          }
          await sendNotificationForTask(
            user.id,
            "TaskArchived",
            task.id,
            task.projectId,
            undefined
          );
        }

        if (dueDateValue !== undefined) {
          const dueDateChanged =
            (oldTask.dueDate?.getTime() ?? null) !== (dueDateValue?.getTime() ?? null);
          if (dueDateChanged) {
            await createTaskDueDateActivity({
              userObj: activityUser,
              taskId: task.id,
              toDueDate: dueDateValue ?? undefined,
              fromDueDate: oldTask.dueDate ?? undefined,
            });
            await cancelDueDateJob(task.id, task.projectId);
            if (dueDateValue) {
              await scheduleDueDateJob(
                { taskId: task.id, projectId: task.projectId },
                dueDateValue
              );
            }
            await sendNotificationForTask(
              user.id,
              "TaskDueDate",
              task.id,
              task.projectId,
              undefined
            );
          }
        }

        if (input.priority !== undefined) {
          const priorityResult = await applyPriorityUpdate(
            task.id,
            input.priority,
            user.id,
            activityUser
          );
          if (priorityResult.error) {
            return { success: false, error: priorityResult.error };
          }
        }

        if (input.estimate !== undefined) {
          const estimateResult = await applyEstimateUpdate(
            task.id,
            input.estimate,
            user.id,
            activityUser
          );
          if (estimateResult.error) {
            return { success: false, error: estimateResult.error };
          }
        }

        const labelActor = {
          id: userObj.id,
          email: userObj.email ?? "",
          displayName: userObj.displayName,
          photoURL: userObj.photoURL,
        };
        if (input.labels !== undefined) {
          await setTaskLabels(task.id, task.projectId, input.labels, labelActor);
        }
        if (input.add_labels !== undefined || input.remove_labels !== undefined) {
          await mutateTaskLabels(
            task.id,
            task.projectId,
            { add: input.add_labels, remove: input.remove_labels },
            labelActor
          );
        }

        const finalTask = await prisma.task.findUnique({
          where: { id: task.id },
          include: taskDetailInclude(user.id),
        });
        if (!finalTask) {
          return { success: false, error: "Task updated but could not be retrieved" };
        }

        void broadcastBoardChange(finalTask.projectId, { originUserId: user.id });
        void broadcastTaskChange(finalTask.id, { originUserId: user.id });

        return sanitizeForJson({
          success: true,
          task: mapTaskToDetail(finalTask, user.id),
          url: buildMcpTaskUrl(finalTask.projectId, finalTask.uniqueIndex),
          ...(sectionWarning ? { warning: sectionWarning } : {}),
        });
        };

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
    });
}
