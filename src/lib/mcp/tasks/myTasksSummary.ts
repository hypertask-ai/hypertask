import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { buildMcpTaskUrl } from "@/lib/mcp/boards/links";
import { columnRole } from "@/lib/mcp/boards/columnRole";

export const MY_TASKS_MAX_LIMIT = 100;
export const MY_TASKS_DEFAULT_LIMIT = 50;

const doneNameFallback = (title: string) => columnRole(title) === "done";

export interface MyTasksSummaryOptions {
  userId: number;
  agentId?: string | null;
  projectId?: number | null;
  overdueOnly?: boolean;
  includeTasks?: boolean;
  limit?: number;
  now?: Date;
  /** Injectable for tests, same convention as the inboxZero helpers. */
  db?: typeof prisma;
}

export interface MyTasksSummaryBoard {
  project_id: number;
  board: string;
  total: number;
  overdue: number;
  tasks?: Array<{
    task_id: number;
    ticket_number: string | null;
    title: string;
    section: string | null;
    due_date: string | null;
    priority: string | null;
    overdue: boolean;
    url: string;
  }>;
}

export interface MyTasksSummary {
  total: number;
  overdue_total: number;
  board_count: number;
  returned: number;
  truncated: boolean;
  boards: MyTasksSummaryBoard[];
}

/**
 * Everything assigned to a person across every board they can see, grouped per
 * board. Counts are always the TRUE totals (a groupBy, not a page), so a 300
 * task workload never reads as "you have 50" just because the row cap is 50.
 * This is the same set the /my-tasks page shows.
 */
export async function getMyTasksSummary({
  userId,
  agentId = null,
  projectId = null,
  overdueOnly = false,
  includeTasks = true,
  limit = MY_TASKS_DEFAULT_LIMIT,
  now = new Date(),
  db = prisma,
}: MyTasksSummaryOptions): Promise<
  { success: true } & MyTasksSummary | { success: false; error: string }
> {
  const projects = await db.project.findMany({
    where: { status: "Normal", ...getProjectWhere(userId, agentId) },
    select: { id: true, title: true, name: true },
  });

  if (projectId && !projects.some((project) => project.id === projectId)) {
    return { success: false, error: "Project not found or access denied" };
  }

  const scopedProjects = projectId
    ? projects.filter((project) => project.id === projectId)
    : projects;
  const projectIds = scopedProjects.map((project) => project.id);

  const empty = {
    success: true as const,
    total: 0,
    overdue_total: 0,
    board_count: 0,
    returned: 0,
    truncated: false,
    boards: [],
  };
  if (projectIds.length === 0) return empty;

  // Tasks store a denormalized section TITLE, not an id, so done columns are
  // matched by their exact stored title. doneColumnTitles() lowercases, which
  // would never match Task.section, hence the local pass over the real rows.
  const sections = await db.section.findMany({
    where: { projectId: { in: projectIds }, deleted: false },
    select: { projectId: true, section_title: true, isDone: true },
  });
  const doneByProject = new Map<number, string[]>();
  for (const section of sections) {
    if (!(section.isDone ?? doneNameFallback(section.section_title))) continue;
    const titles = doneByProject.get(section.projectId) ?? [];
    titles.push(section.section_title);
    doneByProject.set(section.projectId, titles);
  }
  const inDoneColumn: Prisma.TaskWhereInput[] = [];
  for (const [id, titles] of doneByProject) {
    inDoneColumn.push({ projectId: id, section: { in: titles } });
  }

  // total counts every assigned task, exactly what the /my-tasks page shows.
  // Overdue additionally drops finished work: a task sitting in a Done column
  // is not late, and the app's Overdue split excludes it the same way.
  const overdueClause: Prisma.TaskWhereInput = {
    dueDate: { lt: now },
    ...(inDoneColumn.length ? { NOT: { OR: inDoneColumn } } : {}),
  };
  const where: Prisma.TaskWhereInput = {
    projectId: { in: projectIds },
    status: "Normal",
    deletedAt: null,
    assignees: { some: { userId, agentId: null } },
    ...(overdueOnly ? overdueClause : {}),
  };

  const [totals, overdueTotals] = await Promise.all([
    db.task.groupBy({
      by: ["projectId"],
      where,
      _count: { _all: true },
    }),
    db.task.groupBy({
      by: ["projectId"],
      where: { ...where, ...overdueClause },
      _count: { _all: true },
    }),
  ]);

  const totalByProject = new Map(
    totals.map((row) => [row.projectId, row._count._all])
  );
  const overdueByProject = new Map(
    overdueTotals.map((row) => [row.projectId, row._count._all])
  );
  const total = totals.reduce((sum, row) => sum + row._count._all, 0);
  const overdueTotal = overdueTotals.reduce(
    (sum, row) => sum + row._count._all,
    0
  );
  if (total === 0) return empty;

  const capped = Math.min(Math.max(limit, 1), MY_TASKS_MAX_LIMIT);
  const rows = includeTasks
    ? await db.task.findMany({
        where,
        select: {
          id: true,
          title: true,
          ticketNumber: true,
          section: true,
          dueDate: true,
          uniqueIndex: true,
          projectId: true,
          priority: { select: { Priority_Value: true } },
        },
        // Overdue and dated work first so the cap drops undated tasks rather
        // than the ones with a deadline.
        orderBy: [
          { dueDate: { sort: "asc", nulls: "last" } },
          { updatedAt: "desc" },
        ],
        take: capped,
      })
    : [];

  const boards: MyTasksSummaryBoard[] = scopedProjects
    .filter((project) => totalByProject.has(project.id))
    .map((project) => ({
      project_id: project.id,
      board: project.title ?? project.name,
      total: totalByProject.get(project.id) ?? 0,
      overdue: overdueByProject.get(project.id) ?? 0,
      ...(includeTasks
        ? {
            tasks: rows
              .filter((row) => row.projectId === project.id)
              .map((row) => ({
                task_id: row.id,
                ticket_number: row.ticketNumber,
                title: row.title,
                section: row.section,
                due_date: row.dueDate ? row.dueDate.toISOString() : null,
                priority: row.priority?.Priority_Value ?? null,
                overdue:
                  row.dueDate != null &&
                  row.dueDate < now &&
                  !(doneByProject.get(row.projectId) ?? []).includes(
                    row.section ?? ""
                  ),
                url: buildMcpTaskUrl(row.projectId, row.uniqueIndex),
              })),
          }
        : {}),
    }))
    // Boards carrying overdue work first, then the biggest piles.
    .sort((a, b) => b.overdue - a.overdue || b.total - a.total);

  return {
    success: true,
    total,
    overdue_total: overdueTotal,
    board_count: boards.length,
    returned: rows.length,
    truncated: rows.length < total,
    boards,
  };
}
