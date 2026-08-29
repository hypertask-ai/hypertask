import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { publicAgentSelect } from "@/lib/agents/publicAgent";
import getAllMinimal from "../projects/getAllMinimal";
import { ITask } from "@/models/model";
import {
  DEFAULT_ALL_TASKS_DATE_RANGE,
  type AllTasksDateRange,
} from "@/lib/configs/allTasks.config";
import {
  RECENT_TASKS_ALL_LIMIT,
  RECENT_TASKS_PER_PROJECT_LIMIT,
  groupRecentTasksByDueDate,
  groupRecentTasksByProject,
} from "./recentTasksGrouping";

const PROJECT_QUERY_CONCURRENCY = 6;
const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
const HOUR_IN_MILLISECONDS = 60 * 60 * 1000;

// Range values are labels, not day counts ("24" is 24 hours, not 24 days).
const RANGE_DURATION_MS: Record<Exclude<AllTasksDateRange, "all">, number> = {
  "24": 24 * HOUR_IN_MILLISECONDS,
  "7": 7 * DAY_IN_MILLISECONDS,
  "30": 30 * DAY_IN_MILLISECONDS,
  "90": 90 * DAY_IN_MILLISECONDS,
};

const updatedAtFilterForRange = (dateRange: AllTasksDateRange) =>
  dateRange === "all"
    ? { not: null }
    : { gte: new Date(Date.now() - RANGE_DURATION_MS[dateRange]) };

const emptyResult = () => ({
  All: {
    All: [] as ITask[], // All tasks tab
  },
  tabs: ["All"],
});

const recentTaskInclude = (userId: number) => ({
  project: {
    select: {
      id: true,
      title: true,
    },
  },
  user: true,
  description_: true,
  _count: {
    select: {
      comments: {
        where: {
          creatorId: { not: null },
        },
      },
    },
  },
  savedContent: {
    where: {
      userId,
      commentId: null,
    },
  },
  notifications: {
    where: {
      status: "Normal",
      userId,
    },
    select: {
      seen: true,
      id: true,
      userId: true,
      taskId: true,
      type: true,
    },
    take: 1,
    orderBy: {
      createdAt: "desc",
    },
  },
} satisfies Prisma.TaskInclude);

const personalDueDateTaskInclude = (userId: number) => ({
  ...recentTaskInclude(userId),
  assignees: {
    select: {
      userId: true,
      agentId: true,
      user: {
        select: {
          displayName: true,
        },
      },
    },
  },
} satisfies Prisma.TaskInclude);

const getRecentTasks = async (
  userId: number,
  mode: "All" | "DueDate" | "Calendar" = "All",
  dateRange: AllTasksDateRange = DEFAULT_ALL_TASKS_DATE_RANGE
) => {
  try {
    const { json: projects } = await getAllMinimal(userId, "Calendar");
    const projectIds = projects.map((item) => item.id);
    if (!projectIds || projectIds.length === 0) {
      return emptyResult();
    }

    if (mode === "Calendar") {
      const tasks = await prisma.task.findMany({
        where: {
          projectId: { in: projectIds },
          deletedAt: null,
          updatedAt: { not: null },
          dueDate: { not: null },
        },
        include: {
          project: { select: { id: true, title: true } },
          savedContent: { where: { userId, commentId: null } },
          assignees: {
            include: {
              user: true,
              agent: { select: publicAgentSelect },
            },
          },
          followers: true,
          priority: true,
          estimate: true,
          taskLabels: { include: { label: true } },
          _count: {
            select: {
              comments: { where: { creatorId: { not: null } } },
            },
          },
        },
        orderBy: { priority: { priority_index: "asc" } },
      });

      return {
        All: { All: tasks as unknown as ITask[] },
        tabs: projects,
      };
    }

    // One recent slice PER PROJECT rather than a single global slice. A single
    // global `take` let the busiest board consume the whole budget, which erased
    // quieter boards' splits from the view entirely (HTPR-5539).
    const include = recentTaskInclude(userId);
    // Bounded concurrency: a workspace with many boards would otherwise start
    // one heavy findMany per board at once and exhaust the connection pool.
    const projectBatches: (typeof projects)[] = [];
    for (let i = 0; i < projects.length; i += PROJECT_QUERY_CONCURRENCY) {
      projectBatches.push(projects.slice(i, i + PROJECT_QUERY_CONCURRENCY));
    }

    const buckets: { title: string | null; tasks: ITask[] }[] = [];
    for (const batch of projectBatches) {
      const batchBuckets = await Promise.all(
        batch.map(async (project) => ({
          title: project.title as string | null,
          tasks: (await prisma.task.findMany({
            take: RECENT_TASKS_PER_PROJECT_LIMIT,
            where: {
              projectId: project.id,
              deletedAt: null,
              updatedAt:
                mode === "All"
                  ? updatedAtFilterForRange(dateRange)
                  : { not: null },
              ...(mode !== "All" ? { dueDate: { not: null } } : {}),
            },
            include,
            orderBy:
              mode === "DueDate" ? { dueDate: "desc" } : { updatedAt: "desc" },
          })) as unknown as ITask[],
        }))
      );
      buckets.push(...batchBuckets);
    }

    if (mode === "DueDate") {
      // The global and per-board limits must not hide a due task assigned to
      // this user. One extra bounded query supplies the personal tab directly.
      const myDueDatesTasks = (await prisma.task.findMany({
        take: RECENT_TASKS_ALL_LIMIT,
        where: {
          projectId: { in: projectIds },
          deletedAt: null,
          updatedAt: { not: null },
          dueDate: { not: null },
          OR: [
            { assignees: { some: { userId, agentId: null } } },
            { assignees: { none: {} }, userId },
          ],
        },
        include: personalDueDateTaskInclude(userId),
        orderBy: { dueDate: "desc" },
      })) as unknown as ITask[];

      const { tasksByDueDate, tabs } = groupRecentTasksByDueDate(
        buckets,
        myDueDatesTasks,
        RECENT_TASKS_ALL_LIMIT
      );
      return { All: tasksByDueDate, tabs };
    }

    const { tasksByProject, tabs } = groupRecentTasksByProject(
      buckets,
      RECENT_TASKS_ALL_LIMIT
    );
    return { All: tasksByProject, tabs };
  } catch (error) {
    console.log("🚀 ~ getRecentTasks ~ error:", error);
    return emptyResult();
  }
};

export default getRecentTasks;
