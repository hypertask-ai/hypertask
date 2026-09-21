import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";
import { Prisma } from "@prisma/client";

export function createHypertaskListTasksTool(context: ChatToolContext) {
  const { body, getAccessibleProjectIds, mapTaskDescriptionContent, mapVisibleMcpAgent, mcpTaskUserCommentCount, mcpVisibleAgentSelect, normalizePriorityInput, prisma, resolveLiveTaskListProjectId, sanitizeForJson, sendStatus, sortOrderSchema, statusSchema, tool, user, z } = context;
  return tool({
      description:
        "List tasks using structured filters such as project, section, assignee, priority, labels, due dates, status, and search text.",
      inputSchema: z.object({
        project_id: z.coerce.number().int().positive().optional(),
        board_id: z.coerce.number().int().positive().optional(),
        section: z.string().optional(),
        assigned_to: z.string().optional(),
        priority: z.union([z.string(), z.array(z.string())]).optional(),
        has_due_date: z.boolean().optional(),
        due_date_before: z.string().optional(),
        due_date_after: z.string().optional(),
        status: statusSchema.default("Normal"),
        labels: z.array(z.string()).default([]),
        created_by: z.coerce.number().int().positive().optional(),
        updated_since: z.string().optional(),
        created_since: z.string().optional(),
        has_comments: z.boolean().optional(),
        has_attachments: z.boolean().optional(),
        search: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        sort_by: z
          .enum(["createdAt", "updatedAt", "dueDate", "priority", "title"])
          .default("updatedAt"),
        sort_order: sortOrderSchema.default("desc"),
      }),
      execute: async (input) => {
        sendStatus("hypertask_list_tasks");
        const accessibleProjectIds = await getAccessibleProjectIds(user.id);
        if (accessibleProjectIds.length === 0) {
          return { success: true, tasks: [], total: 0, limit: input.limit, offset: input.offset };
        }

        const where: Prisma.TaskWhereInput = {
          projectId: { in: accessibleProjectIds },
          status: input.status,
        };
        const targetProjectId = resolveLiveTaskListProjectId({
          message: body.message,
          projectId: input.project_id,
          boardId: input.board_id,
          defaultProjectId: body.default_context?.project_id,
        });
        if (targetProjectId) {
          if (!accessibleProjectIds.includes(targetProjectId)) {
            return { success: false, error: "Project not found or access denied" };
          }
          where.projectId = targetProjectId;
        }
        if (input.section) where.section = input.section;
        if (input.assigned_to) {
          if (input.assigned_to === "me") {
            where.assignees = { some: { userId: user.id } };
          } else if (input.assigned_to === "unassigned") {
            where.assignees = { none: {} };
          } else {
            const userIds = input.assigned_to
              .split(",")
              .map((id) => parseInt(id.trim(), 10))
              .filter(Number.isInteger);
            if (userIds.length > 0) {
              where.assignees = { some: { userId: { in: userIds } } };
            }
          }
        }
        const priorities = normalizePriorityInput(input.priority);
        if (priorities?.length) {
          where.priority = { Priority_Value: { in: priorities } };
        }
        if (input.has_due_date !== undefined) {
          where.dueDate = input.has_due_date ? { not: null } : null;
        }
        if (input.due_date_before) {
          where.dueDate = {
            ...(typeof where.dueDate === "object" && where.dueDate != null
              ? where.dueDate
              : {}),
            lte: new Date(input.due_date_before),
          };
        }
        if (input.due_date_after) {
          where.dueDate = {
            ...(typeof where.dueDate === "object" && where.dueDate != null
              ? where.dueDate
              : {}),
            gte: new Date(input.due_date_after),
          };
        }
        if (input.labels.length > 0) {
          where.taskLabels = {
            some: {
              OR: [
                { labelId: { in: input.labels } },
                { label: { value: { in: input.labels } } },
              ],
            },
          };
        }
        if (input.created_by) where.userId = input.created_by;
        if (input.updated_since) where.updatedAt = { gte: new Date(input.updated_since) };
        if (input.created_since) where.createdAt = { gte: new Date(input.created_since) };
        // Only filter when explicitly TRUE. The chat model reflexively fills every
        // optional param with a default `false`, which under `!== undefined` became a
        // restrictive "has NONE" filter and silently dropped tasks that do have
        // comments/attachments (e.g. it reported 0 due dates on boards that had them).
        if (input.has_comments === true) {
          where.comments = { some: {} };
        }
        if (input.has_attachments === true) {
          where.attachments = { some: {} };
        }
        if (input.search) {
          where.OR = [
            { title: { contains: input.search, mode: "insensitive" } },
            {
              description_: {
                content: { contains: input.search, mode: "insensitive" },
              },
            },
            { ticketNumber: { contains: input.search, mode: "insensitive" } },
          ];
        }

        const orderBy: Prisma.TaskOrderByWithRelationInput =
          input.sort_by === "createdAt"
            ? { createdAt: input.sort_order }
            : input.sort_by === "dueDate"
              ? { dueDate: input.sort_order }
              : input.sort_by === "priority"
                ? { priority: { Priority_Value: input.sort_order } }
                : input.sort_by === "title"
                  ? { title: input.sort_order }
                  : { updatedAt: input.sort_order };

        const [total, tasks] = await Promise.all([
          prisma.task.count({ where }),
          prisma.task.findMany({
            where,
            select: {
              id: true,
              ticketNumber: true,
              uniqueIndex: true,
              title: true,
              section: true,
              description_: true,
              sectionId: true,
              parentTaskId: true,
              projectId: true,
              project: { select: { id: true, title: true } },
              parentTask: {
                select: { id: true, ticketNumber: true, title: true, uniqueIndex: true },
              },
              status: true,
              priority: { select: { Priority_Value: true } },
              dueDate: true,
              createdAt: true,
              updatedAt: true,
              agent: { select: mcpVisibleAgentSelect(user.id) },
              assignees: {
                select: {
                  agent: { select: mcpVisibleAgentSelect(user.id) },
                },
              },
              _count: {
                select: {
                  taskLabels: true,
                  comments: mcpTaskUserCommentCount,
                },
              },
              subTasks: {
                where: { status: { not: "Deleted" } },
                select: { id: true, ticketNumber: true, title: true, uniqueIndex: true },
                orderBy: { createdAt: "asc" },
              },
            },
            orderBy,
            take: input.limit,
            skip: input.offset,
          }),
        ]);

        return sanitizeForJson({
          success: true,
          tasks: tasks.map((task) => {
            const agent = mapVisibleMcpAgent(task.agent, user.id, task.projectId);
            const assigneeCount = task.assignees.filter(
              (assignee) =>
                !assignee.agent ||
                Boolean(
                  mapVisibleMcpAgent(assignee.agent, user.id, task.projectId)
                )
            ).length;
            return {
              id: task.id,
              task_id: task.id,
              ticketNumber: task.ticketNumber || undefined,
              uniqueIndex: task.uniqueIndex,
              // Use this verbatim for links; never build the path from `id`.
              url: `/detail/project-${task.projectId}/${task.uniqueIndex}`,
              title: task.title,
              description: mapTaskDescriptionContent(task),
              section: task.section,
              sectionId: task.sectionId || undefined,
              boardId: task.projectId,
              boardTitle: task.project.title || "",
              parent_id: task.parentTaskId || undefined,
              parent_task: task.parentTask
                ? {
                    id: task.parentTask.id,
                    task_id: task.parentTask.id,
                    ticketNumber: task.parentTask.ticketNumber || undefined,
                    title: task.parentTask.title,
                    uniqueIndex: task.parentTask.uniqueIndex,
                  }
                : undefined,
              sub_tasks: task.subTasks.map((subTask) => ({
                id: subTask.id,
                task_id: subTask.id,
                ticketNumber: subTask.ticketNumber || undefined,
                title: subTask.title,
                uniqueIndex: subTask.uniqueIndex,
              })),
              projectId: task.projectId,
              status: task.status,
              priority: task.priority?.Priority_Value || undefined,
              dueDate: task.dueDate?.toISOString() || undefined,
              assigneeCount,
              labelCount: task._count.taskLabels,
              commentCount: task._count.comments,
              createdAt: task.createdAt.toISOString(),
              updatedAt: task.updatedAt?.toISOString() || undefined,
              ...(agent ? { agent } : {}),
            };
          }),
          total,
          limit: input.limit,
          offset: input.offset,
        });
      },
    });
}
