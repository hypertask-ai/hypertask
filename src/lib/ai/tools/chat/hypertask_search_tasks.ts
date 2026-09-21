import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";
import { Prisma } from "@prisma/client";

export function createHypertaskSearchTasksTool(context: ChatToolContext) {
  const { buildSearchTotalMetadata, getAccessibleProjectIds, mapTaskSearchItem, mcpVisibleAgentSelect, normalizePriorityInput, prisma, sanitizeForJson, sendStatus, tool, turbopufferSearchTaskIds, user, z } = context;
  return tool({
      description:
        "Search tasks by keyword, phrase, partial task name, ticket number, or description. Uses Turbopuffer relevance with Prisma fallback. For 'latest/newest/most recent ticket' questions set sort=\"newest\" (query may be omitted); for 'oldest/first' use sort=\"oldest\". Default sort is relevance for keyword/topic search. When total_is_lower_bound is true, report the total as at least N.",
      inputSchema: z.object({
        query: z.string().min(1).max(200).optional(),
        sort: z.enum(["relevance", "newest", "oldest"]).default("relevance"),
        project_id: z.coerce.number().int().positive().optional(),
        board_id: z.coerce.number().int().positive().optional(),
        assigned_to: z.string().optional(),
        priority: z.union([z.string(), z.array(z.string())]).optional(),
        section: z.string().optional(),
        has_due_date: z.boolean().optional(),
        status: z.enum(["Normal", "Archive"]).default("Normal"),
        limit: z.coerce.number().int().min(1).max(50).default(10),
      }),
      execute: async (input) => {
        sendStatus("hypertask_search_tasks");
        const accessibleProjectIds = await getAccessibleProjectIds(user.id);
        if (accessibleProjectIds.length === 0) {
          return {
            success: true,
            tasks: [],
            ...buildSearchTotalMetadata(0, false),
          };
        }
        const targetProjectId = input.project_id ?? input.board_id;
        if (targetProjectId && !accessibleProjectIds.includes(targetProjectId)) {
          return { success: false, error: "Project not found or access denied" };
        }

        const where: Prisma.TaskWhereInput = {
          projectId: targetProjectId
            ? targetProjectId
            : { in: accessibleProjectIds },
          status: input.status,
        };
        if (input.section) where.section = input.section;
        if (input.assigned_to) {
          if (input.assigned_to === "me") {
            where.assignees = { some: { userId: user.id } };
          } else if (input.assigned_to === "unassigned") {
            where.assignees = { none: {} };
          } else {
            const assignedUserId = parseInt(input.assigned_to, 10);
            if (Number.isInteger(assignedUserId)) {
              where.assignees = { some: { userId: assignedUserId } };
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

        // Recency sort ("latest ticket" style) bypasses relevance search: order by createdAt.
        const recency = input.sort === "newest" || input.sort === "oldest";

        const turbopufferIds =
          recency || !input.query
            ? []
            : await turbopufferSearchTaskIds({
                searchQuery: input.query,
                projectIds: accessibleProjectIds,
                status: input.status,
                projectId: targetProjectId,
                perPage: Math.min(input.limit * 5, 100),
              });

        if (turbopufferIds.length > 0) {
          where.id = { in: turbopufferIds };
        } else if (input.query) {
          where.OR = [
            { title: { contains: input.query, mode: "insensitive" } },
            { description: { contains: input.query, mode: "insensitive" } },
            { ticketNumber: { contains: input.query, mode: "insensitive" } },
          ];
        }

        const recencyOrder = {
          orderBy: { createdAt: input.sort === "oldest" ? ("asc" as const) : ("desc" as const) },
          take: input.limit,
        };

        const [total, tasks] = await Promise.all([
          prisma.task.count({ where }),
          prisma.task.findMany({
            where,
            select: {
              id: true,
              ticketNumber: true,
              uniqueIndex: true,
              title: true,
              description: true,
              section: true,
              projectId: true,
              project: { select: { id: true, title: true } },
              dueDate: true,
              createdAt: true,
              agent: { select: mcpVisibleAgentSelect(user.id) },
            },
            ...(recency
              ? recencyOrder
              : turbopufferIds.length > 0
                ? {}
                : { orderBy: { updatedAt: "desc" as const }, take: input.limit }),
          }),
        ]);

        const orderedTasks =
          turbopufferIds.length > 0
            ? turbopufferIds
                .map((id) => tasks.find((task) => task.id === id))
                .filter((task): task is NonNullable<typeof task> => task != null)
                .slice(0, input.limit)
            : tasks;

        return sanitizeForJson({
          success: true,
          tasks: orderedTasks.map((task) => mapTaskSearchItem(task, user.id)),
          ...buildSearchTotalMetadata(total, turbopufferIds.length > 0),
          boardId: targetProjectId || undefined,
        });
      },
    });
}
