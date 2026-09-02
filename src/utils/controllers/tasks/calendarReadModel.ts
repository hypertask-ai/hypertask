import prisma from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { buildCalendarAuthorizationRevision } from "@/lib/calendarSync/access";
import type {
  CalendarProjectV1,
  CalendarTaskV1,
} from "@/lib/calendarSync/contract";
import { attachWaitingOnUsers } from "./attachWaitingOnUsers";
import { attachOpenBlockingTasks } from "./attachOpenBlockingTasks";
import {
  buildCalendarTaskOverlapWhere,
  calendarTaskOverlapsRange,
} from "@/lib/calendarSync/taskRange";

const safeUserSelect = {
  id: true,
  displayName: true,
  photoURL: true,
} as const;

const safeAgentSelect = {
  id: true,
  displayName: true,
  photoURL: true,
} as const;

const calendarAccessibleProjectWhere = (
  userId: number,
): Prisma.ProjectWhereInput => ({
  status: "Normal",
  teamId: { not: null },
  googleAccount: { isNot: null },
  OR: [
    { ownerId: userId },
    { members: { some: { userId, status: "Accepted" } } },
  ],
});

export const getCalendarAccessibleProjectIds = async (
  userId: number,
): Promise<number[]> => {
  const projects = await prisma.project.findMany({
    where: calendarAccessibleProjectWhere(userId),
    orderBy: { id: "asc" },
    select: { id: true },
  });
  return projects.map((project) => project.id);
};

export const getCalendarReadModel = async ({
  userId,
  start,
  endExclusive,
}: {
  userId: number;
  start: Date;
  endExclusive: Date;
}): Promise<{
  tasks: CalendarTaskV1[];
  projects: CalendarProjectV1[];
  authorizationRevision: string;
}> => {
  // Projects and tasks are independent reads (the task query already scopes
  // access via its own `project: { is: ... } }` filter below, so it doesn't
  // need the projects query's ids first) — run them concurrently rather than
  // paying two round trips back to back.
  const [projects, tasks] = await Promise.all([
    prisma.project.findMany({
      where: calendarAccessibleProjectWhere(userId),
      orderBy: { id: "asc" },
      select: {
        id: true,
        name: true,
        title: true,
        owner: { select: safeUserSelect },
        members: {
          where: { status: "Accepted" },
          select: {
            user: { select: safeUserSelect },
          },
        },
        labels: {
          select: {
            id: true,
            value: true,
            projectId: true,
          },
        },
        _count: {
          select: {
            tasks: {
              where: {
                status: "Normal",
                deletedAt: null,
                updatedAt: { not: null },
                dueDate: { not: null },
              },
            },
          },
        },
      },
    }),
    prisma.task.findMany({
      where: {
        project: { is: calendarAccessibleProjectWhere(userId) },
        status: "Normal",
        deletedAt: null,
        updatedAt: { not: null },
        ...buildCalendarTaskOverlapWhere(start, endExclusive),
      },
      select: {
        id: true,
        uniqueIndex: true,
        ticketNumber: true,
        ranking: true,
        section: true,
        sectionId: true,
        title: true,
        projectId: true,
        status: true,
        userId: true,
        createdAt: true,
        updatedAt: true,
        dueDate: true,
        startDate: true,
        recurrence: true,
        deletedAt: true,
        waitingOnUserId: true,
        agentId: true,
        updatedByUserIds: true,
        project: { select: { id: true, title: true, name: true } },
        assignees: {
          select: {
            id: true,
            userId: true,
            agentId: true,
            user: { select: safeUserSelect },
            agent: { select: safeAgentSelect },
          },
        },
        priority: {
          select: {
            id: true,
            priority_index: true,
            Priority_Value: true,
          },
        },
        estimate: {
          select: {
            id: true,
            estimate_index: true,
            estimate_value: true,
          },
        },
        taskLabels: {
          select: {
            id: true,
            taskId: true,
            labelId: true,
            label: { select: { id: true, value: true, projectId: true } },
          },
        },
        relatedFromTasks: {
          where: {
            relationType: "BlockedBy",
            targetTask: {
              project: { is: calendarAccessibleProjectWhere(userId) },
            },
          },
          select: {
            targetTask: {
              select: {
                id: true,
                projectId: true,
                uniqueIndex: true,
                ticketNumber: true,
                title: true,
                status: true,
                section: true,
              },
            },
          },
        },
        _count: {
          select: {
            comments: {
              where: {
                OR: [{ creatorId: { not: null } }, { agentId: { not: null } }],
              },
            },
            savedContent: { where: { userId, commentId: null } },
          },
        },
      },
      orderBy: { priority: { priority_index: "asc" } },
    }),
  ]);
  const authorizationRevision = buildCalendarAuthorizationRevision(
    projects.map((project) => project.id),
  );

  // The two reads run without a shared snapshot, so an access change between
  // them could yield tasks for a project absent from `projects`. The projects
  // read is authoritative: drop any task outside its id set.
  const authorizedProjectIds = new Set(projects.map((project) => project.id));
  const authorizedTasks = tasks
    .filter(
      (task) =>
        authorizedProjectIds.has(task.projectId) &&
        calendarTaskOverlapsRange(task, start, endExclusive),
    )
    .map((task) => ({
      ...task,
      relatedFromTasks: task.relatedFromTasks.filter(({ targetTask }) =>
        authorizedProjectIds.has(targetTask.projectId),
      ),
    }));
  const tasksWithOpenBlockers = await attachOpenBlockingTasks(authorizedTasks);
  const calendarTasks = await attachWaitingOnUsers(tasksWithOpenBlockers);

  const calendarProjects: CalendarProjectV1[] = projects.map((project) => ({
    id: project.id,
    name: project.name,
    title: project.title,
    members: [
      { user: project.owner },
      ...project.members
        .filter(({ user }) => user.id !== project.owner.id)
        .map(({ user }) => ({ user })),
    ],
    labels: project.labels.flatMap((label) =>
      label.projectId == null || label.value == null
        ? []
        : [
            {
              id: label.id,
              value: label.value,
              projectId: label.projectId,
            },
          ],
    ),
    _count: project._count,
  }));

  return {
    tasks: calendarTasks as unknown as CalendarTaskV1[],
    projects: calendarProjects,
    authorizationRevision,
  };
};
