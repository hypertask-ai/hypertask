import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import type { ArchiveBoardScope } from "@/store";

export const ARCHIVED_TASKS_PAGE_SIZE = 50;

const archivedTasksOrderBy: Prisma.TaskOrderByWithRelationInput[] = [
  { archivedAt: { sort: "desc", nulls: "last" } },
  { id: "desc" },
];

const getArchivedTasksWhere = (
  userId: number,
  projectId?: number | null,
  boardScope: ArchiveBoardScope = "active",
  q?: string
): Prisma.TaskWhereInput => ({
  ...(projectId ? { projectId } : {}),
  ...(q?.trim()
    ? {
        title: {
          contains: q.trim().toLowerCase(),
          mode: "insensitive",
        },
      }
    : {}),
  project: {
    ...(boardScope === "all"
      ? {}
      : { status: boardScope === "active" ? "Normal" : "Archive" }),
    OR: [
      { ownerId: userId },
      {
        members: {
          some: {
            userId,
            agentId: null,
          },
        },
      },
    ],
  },
  status: "Archive",
});

const archivedTaskSelect = {
  id: true,
  uniqueIndex: true,
  title: true,
  status: true,
  archivedAt: true,
  projectId: true,
  project: {
    select: {
      id: true,
      name: true,
      title: true,
    },
  },
} satisfies Prisma.TaskSelect;

const tasksGetArchivedTasks = async (
  userId: number,
  cursor?: number | null,
  projectId?: number | null,
  boardScope: ArchiveBoardScope = "active",
  q?: string
) => {
        try {
            const tasks = await prisma.task.findMany({
                take: ARCHIVED_TASKS_PAGE_SIZE,
                ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
                where: getArchivedTasksWhere(userId, projectId, boardScope, q),
                select: archivedTaskSelect,
                orderBy: archivedTasksOrderBy,
            })
            
                return ({
                    status:200,
                    json:tasks
                })
            

            // res.status(200).json(tasks);
        } catch (error) {
            console.log(error);
            return ({
                status:300,
                json:{message:"No Response", error:error}
            })
            // res.status(200).json([]);
        }
    
};

export const tasksGetArchivedTasksMeta = async (
  userId: number,
  projectId?: number | null,
  boardScope: ArchiveBoardScope = "active"
) => {
  try {
    const where = getArchivedTasksWhere(userId, projectId, boardScope);
    // ponytail: count + a projectId-only scan for the per-project splits; fine at
    // personal-archive scale, swap to a raw GROUP BY if a user's archive gets huge.
    const [total, rows] = await prisma.$transaction([
      prisma.task.count({ where }),
      prisma.task.findMany({
        where,
        select: {
          projectId: true,
          project: { select: { id: true, name: true, title: true } },
        },
      }),
    ]);

    const byProject = new Map<
      number,
      { projectId: number; name: string; count: number }
    >();
    for (const row of rows) {
      const pid = row.projectId;
      const existing = byProject.get(pid);
      if (existing) {
        existing.count += 1;
        continue;
      }
      byProject.set(pid, {
        projectId: pid,
        name: row.project?.title ?? row.project?.name ?? `Project ${pid}`,
        count: 1,
      });
    }

    return {
      status: 200,
      json: {
        total,
        byProject: Array.from(byProject.values()).sort(
          (a, b) => b.count - a.count || a.name.localeCompare(b.name)
        ),
      },
    };
  } catch (error) {
    console.log(error);
    return {
      status: 300,
      json: { message: "No Response", error },
    };
  }
};

export default tasksGetArchivedTasks;
