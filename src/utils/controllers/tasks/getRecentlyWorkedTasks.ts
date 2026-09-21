import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

type RecentlyWorkedTasksInput = {
  userId: number;
  projectIds?: unknown;
  currentTaskId?: number;
};

const taskPickerSelect = {
  id: true,
  projectId: true,
  project: { select: { title: true } },
  title: true,
  uniqueIndex: true,
  ticketNumber: true,
  updatedAt: true,
} as const;

const getRecentlyWorkedTasks = async ({
  userId,
  projectIds,
  currentTaskId,
}: RecentlyWorkedTasksInput) => {
  const requestedProjectIds = Array.isArray(projectIds)
    ? projectIds.filter(
        (projectId): projectId is number =>
          Number.isInteger(projectId) && projectId > 0
      )
    : [];

  if (requestedProjectIds.length === 0) {
    return { status: 200, json: [] };
  }

  try {
    const tasks = await prisma.task.findMany({
      take: 10,
      where: {
        projectId: { in: requestedProjectIds },
        project: getProjectWhere(userId),
        deletedAt: null,
        archivedAt: null,
        status: "Normal",
        updatedAt: { not: null },
        ...(Number.isInteger(currentTaskId) && currentTaskId! > 0
          ? { id: { not: currentTaskId } }
          : {}),
        OR: [{ userId }, { updatedByUserIds: { has: userId } }],
      },
      select: taskPickerSelect,
      orderBy: { updatedAt: "desc" },
    });

    return { status: 200, json: tasks };
  } catch (error) {
    console.error("Unable to load recently worked tasks", error);
    return { status: 500, json: [] };
  }
};

export default getRecentlyWorkedTasks;
