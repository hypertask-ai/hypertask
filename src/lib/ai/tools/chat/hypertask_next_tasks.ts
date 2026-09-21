import type { ChatToolContext } from "@/app/api/ai/chat/stream/buildTools";
import { Prisma } from "@prisma/client";

export function createHypertaskNextTasksTool(context: ChatToolContext) {
  const { blockerStillOpen, buildLimitedScanMetadata, columnRole, getProjectWhere, loadDoneTitlesByProject, priorityScore, prisma, sanitizeForJson, sendStatus, tool, user, withToolErrors, z } = context;
  return tool({
      description:
        "Get the highest-priority unleased tasks from one accessible board, optionally filtered by section, blocked status, and comma-separated label names or IDs. A truncated response may have more matching tasks beyond its reported total.",
      inputSchema: z.object({
        project_id: z.coerce.number().int().positive(),
        limit: z.coerce.number().int().positive().default(10),
        section: z.string().trim().min(1).optional(),
        exclude_blocked: z.boolean().default(false),
        labels: z.string().trim().min(1).optional(),
      }),
      execute: withToolErrors(async (input) => {
        sendStatus("hypertask_next_tasks");
        const projectAccessWhere = getProjectWhere(user.id);
        const project = await prisma.project.findFirst({
          where: {
            id: input.project_id,
            status: "Normal",
            ...projectAccessWhere,
          },
          select: {
            id: true,
            section: {
              where: { deleted: false },
              select: { section_title: true, isDone: true },
            },
          },
        });
        if (!project) {
          return { success: false, error: "Project not found or access denied" };
        }

        const labelFilters = (input.labels ?? "")
          .split(",")
          .map((label: string) => label.trim())
          .filter(Boolean);
        const labelIdPattern =
          /^(?:\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
        const labelIds = labelFilters.filter((label: string) => labelIdPattern.test(label));
        const labelNames = labelFilters.filter((label: string) => !labelIdPattern.test(label));
        const now = new Date();
        const where: Prisma.TaskWhereInput = {
          projectId: input.project_id,
          project: projectAccessWhere,
          status: "Normal",
          ...(input.section ? { section: input.section } : {}),
          ...(labelFilters.length > 0
            ? {
                taskLabels: {
                  some: {
                    OR: [
                      ...(labelIds.length > 0
                        ? [{ labelId: { in: labelIds } }]
                        : []),
                      ...(labelNames.length > 0
                        ? [{ label: { value: { in: labelNames } } }]
                        : []),
                    ],
                  },
                },
              }
            : {}),
          taskLease: {
            isNot: { expiresAt: { gt: now } },
          },
        };

        const scanLimit = 500;
        const scannedTasks = await prisma.task.findMany({
          where,
          select: {
            id: true,
            ticketNumber: true,
            title: true,
            section: true,
            priority: { select: { Priority_Value: true } },
            dueDate: true,
            createdAt: true,
            taskLabels: {
              select: {
                label: { select: { id: true, value: true } },
              },
              orderBy: { labelId: "asc" },
            },
            relatedFromTasks: {
              where: { relationType: "BlockedBy" },
              select: {
                targetTask: {
                  select: { status: true, section: true, projectId: true },
                },
              },
            },
            relatedToTasks: {
              where: { relationType: "BlockedTo" },
              select: {
                sourceTask: {
                  select: { status: true, section: true, projectId: true },
                },
              },
            },
          },
          orderBy: [
            { priority: { priority_index: "asc" } },
            { dueDate: { sort: "asc", nulls: "last" } },
            { createdAt: "asc" },
          ],
          take: scanLimit + 1,
        });
        const scanMetadata = buildLimitedScanMetadata(
          scannedTasks.length,
          scanLimit
        );
        const tasks = scannedTasks.slice(0, scanLimit);

        // A blocker can live on a different board, so each one is resolved
        // against its OWN project's finished columns. Applying the requesting
        // board's flags to a foreign blocker is worse than applying none.
        const blockersOf = (task: (typeof tasks)[number]) => [
          ...task.relatedFromTasks.map((relation) => relation.targetTask),
          ...task.relatedToTasks.map((relation) => relation.sourceTask),
        ];
        const doneTitlesByProject = input.exclude_blocked
          ? await loadDoneTitlesByProject(
              tasks.flatMap((task) =>
                blockersOf(task).map((blocker) => blocker.projectId)
              ),
              (title) => columnRole(title) === "done"
            )
          : new Map<number, Set<string>>();
        const candidates = input.exclude_blocked
          ? tasks.filter(
              (task) =>
                !blockersOf(task).some((blocker) =>
                  blockerStillOpen(
                    blocker,
                    doneTitlesByProject.get(blocker.projectId)
                  )
                )
            )
          : tasks;
        const rankedTasks = candidates
          .map((task) => ({
            task,
            score: priorityScore(
              task.priority?.Priority_Value,
              task.dueDate,
              now
            ),
          }))
          .sort(
            (left, right) =>
              right.score - left.score ||
              left.task.createdAt.getTime() - right.task.createdAt.getTime()
          );
        const limit = Math.min(input.limit, 50);

        return sanitizeForJson({
          success: true,
          tasks: rankedTasks.slice(0, limit).map(({ task, score }) => ({
            id: task.id,
            ticketNumber: task.ticketNumber || undefined,
            title: task.title,
            section: task.section,
            priority: task.priority?.Priority_Value || undefined,
            dueDate: task.dueDate?.toISOString() || undefined,
            score,
            labels: task.taskLabels.map(({ label }) => ({
              id: label.id,
              name: label.value || "",
            })),
          })),
          total: rankedTasks.length,
          truncated: scanMetadata.truncated,
        });
      }),
    });
}
