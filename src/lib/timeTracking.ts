import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { elapsedSeconds, resumedStartedAt } from "@/lib/timeDuration";
import { broadcastTimeChange } from "@/lib/realtime/server";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { manualEntryTimes } from "@/lib/timeManualEntry";
import isProjectAdmin from "@/utils/controllers/projects/isProjectAdmin";
import {
  createTimeEntryOnActiveBoard,
  deleteTimeEntryOnActiveBoard,
  pauseTimerOnActiveBoard,
  resumeTimerOnActiveBoard,
  startTimerOnActiveBoard,
  stopTimerOnAccessibleBoard,
  TimeTrackingDisabledError,
  type TimeWriteClient,
  updateTimeEntryOnActiveBoard,
} from "@/lib/timeEntryWriter";

const normalizeNote = (note?: string | null) =>
  note?.trim().slice(0, 500) || null;

export { TimeTrackingDisabledError } from "@/lib/timeEntryWriter";

export { elapsedSeconds, resumedStartedAt, stoppedAt } from "@/lib/timeDuration";

type BoardTimeTotalRow = {
  taskId: number;
  totalSeconds: bigint;
};

export async function boardTimeSummary(userId: number, projectId: number) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      status: "Normal",
      ...getProjectWhere(userId),
    },
    select: { showTimeTotals: true, timeTrackingEnabled: true },
  });
  if (!project) return null;

  const calculatedAt = new Date();
  const [runningEntries, totalRows] = await Promise.all([
    project.timeTrackingEnabled
      ? prisma.timeEntry.findMany({
          where: {
            endedAt: null,
            task: { projectId, status: "Normal" },
          },
          select: {
            taskId: true,
            startedAt: true,
            pausedAt: true,
            user: { select: { displayName: true } },
          },
          orderBy: { startedAt: "asc" },
        })
      : Promise.resolve([]),
    project.timeTrackingEnabled && project.showTimeTotals
      ? prisma.$queryRaw<BoardTimeTotalRow[]>(Prisma.sql`
          SELECT
            entries."taskId" AS "taskId",
            SUM(
              FLOOR(
                GREATEST(
                  0,
                  EXTRACT(
                    EPOCH FROM (
                      COALESCE(entries."endedAt", entries."pausedAt", ${calculatedAt})
                      - entries."startedAt"
                    )
                  )
                )
              )
            )::bigint AS "totalSeconds"
          FROM "TimeEntry" entries
          INNER JOIN "Task" tasks ON tasks."id" = entries."taskId"
          WHERE tasks."projectId" = ${projectId}
            AND tasks."status" = 'Normal'
          GROUP BY entries."taskId"
        `)
      : Promise.resolve([]),
  ]);

  const entriesByTask = new Map<
    number,
    {
      taskId: number;
      totalSeconds: number;
      runningEntries: Array<{
        pausedAt: Date | null;
        startedAt: Date;
        userName: string;
      }>;
    }
  >();

  for (const row of totalRows) {
    entriesByTask.set(row.taskId, {
      taskId: row.taskId,
      totalSeconds: Number(row.totalSeconds),
      runningEntries: [],
    });
  }
  for (const entry of runningEntries) {
    const summary = entriesByTask.get(entry.taskId) ?? {
      taskId: entry.taskId,
      totalSeconds: 0,
      runningEntries: [],
    };
    summary.runningEntries.push({
      pausedAt: entry.pausedAt,
      startedAt: entry.startedAt,
      userName: entry.user.displayName ?? "Unknown user",
    });
    entriesByTask.set(entry.taskId, summary);
  }

  return {
    calculatedAt,
    enabled: project.timeTrackingEnabled,
    showTimeTotals: project.showTimeTotals,
    entries: [...entriesByTask.values()],
  };
}

// Fire-and-forget, like every other broadcast caller: a timer must not fail
// or hang because the pub/sub hop is slow. broadcast() keeps the serverless
// instance alive on its own via waitUntil.
function notifyTimeChange(taskId: number, projectId?: number) {
  void (async () => {
    const project =
      projectId ??
      (
        await prisma.task.findUnique({
          where: { id: taskId },
          select: { projectId: true },
        })
      )?.projectId;
    await broadcastTimeChange(taskId, project);
  })().catch(() => {});
}

const timeWriteClient: TimeWriteClient = {
  $transaction: (operation, options) =>
    prisma.$transaction((tx) => operation(tx), options),
};

export async function startTimer(
  userId: number,
  taskId: number,
  agentId?: string | null
) {
  const started = await startTimerOnActiveBoard(
    timeWriteClient,
    userId,
    taskId,
    getProjectWhere(userId, agentId)
  );
  // Every caller starts through here, so task tabs receive one notification.
  notifyTimeChange(taskId, started.projectId);
  return started.entry;
}

export async function stopTimer(
  userId: number,
  taskId: number,
  agentId?: string | null
) {
  const entry = await stopTimerOnAccessibleBoard(
    timeWriteClient,
    userId,
    taskId,
    getProjectWhere(userId, agentId)
  );
  if (!entry) return null;
  notifyTimeChange(taskId);
  return entry;
}

export async function pauseTimer(
  userId: number,
  taskId: number,
  agentId?: string | null
) {
  const entry = await pauseTimerOnActiveBoard(
    timeWriteClient,
    userId,
    taskId,
    getProjectWhere(userId, agentId)
  );
  if (!entry) return null;
  notifyTimeChange(taskId);
  return entry;
}

export async function resumeTimer(
  userId: number,
  taskId: number,
  agentId?: string | null
) {
  const entry = await resumeTimerOnActiveBoard(
    timeWriteClient,
    userId,
    taskId,
    getProjectWhere(userId, agentId)
  );
  if (!entry) return null;
  notifyTimeChange(taskId);
  return entry;
}

export async function logMinutes(
  userId: number,
  taskId: number,
  minutes: number,
  agentId?: string | null
) {
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 1440) {
    throw new RangeError("Minutes must be an integer from 1 to 1440");
  }

  const endedAt = new Date();
  const startedAt = new Date(endedAt.getTime() - minutes * 60 * 1000);

  const entry = await createTimeEntryOnActiveBoard(
    timeWriteClient,
    {
      userId,
      taskId,
      startedAt,
      endedAt,
    },
    getProjectWhere(userId, agentId)
  );
  notifyTimeChange(taskId);
  return entry;
}

export async function createManualEntry(
  userId: number,
  taskId: number,
  date: string,
  minutes: number,
  timezoneOffsetMinutes?: number,
  note?: string | null
) {
  const { startedAt, endedAt } = manualEntryTimes(
    date,
    minutes,
    timezoneOffsetMinutes
  );

  const entry = await createTimeEntryOnActiveBoard(
    timeWriteClient,
    {
      userId,
      taskId,
      note: normalizeNote(note),
      startedAt,
      endedAt,
    },
    getProjectWhere(userId)
  );
  notifyTimeChange(taskId);
  return entry;
}

export async function listRunning(userId: number) {
  const entries = await prisma.timeEntry.findMany({
    where: {
      userId,
      endedAt: null,
      task: {
        status: { not: "Deleted" },
        project: {
          ...getProjectWhere(userId),
          status: { in: ["Normal", "Archive"] },
        },
      },
    },
    orderBy: { startedAt: "asc" },
    include: {
      task: {
        select: {
          id: true,
          uniqueIndex: true,
          title: true,
          projectId: true,
          ticketNumber: true,
          project: { select: { title: true } },
        },
      },
    },
  });

  return entries.map(({ task, ...entry }) => ({
    ...entry,
    task: {
      ...task,
      project: { name: task.project.title },
    },
  }));
}

export async function listEntries(userId: number, taskId: number) {
  const task = await prisma.task.findFirst({
    where: {
      id: taskId,
      project: { ...getProjectWhere(userId), status: "Normal" },
    },
    select: { id: true, projectId: true },
  });

  if (!task) return null;

  const [entries, canManage] = await Promise.all([
    prisma.timeEntry.findMany({
      where: { taskId },
      orderBy: { startedAt: "desc" },
      include: {
        user: { select: { displayName: true } },
      },
    }),
    isProjectAdmin(userId, task.projectId),
  ]);

  return {
    canManage,
    entries: entries.map(({ user, ...entry }) => ({
      ...entry,
      userName: user.displayName ?? "Unknown user",
    })),
  };
}

export async function listReport(
  userId: number,
  options: {
    teamId?: string;
    boardId?: number;
    boardIds?: number[];
    taskId?: number;
    filterUserId?: number;
    filterUserIds?: number[];
    from?: Date;
    to?: Date;
    runningOnly?: boolean;
  } = {}
) {
  const entries = await prisma.timeEntry.findMany({
    where: {
      ...(options.taskId ? { taskId: options.taskId } : {}),
      ...(options.filterUserIds?.length
        ? { userId: { in: options.filterUserIds } }
        : options.filterUserId
          ? { userId: options.filterUserId }
          : {}),
      ...(options.from || options.to
        ? {
            startedAt: {
              ...(options.from ? { gte: options.from } : {}),
              ...(options.to ? { lte: options.to } : {}),
            },
          }
        : {}),
      ...(options.runningOnly ? { endedAt: null } : {}),
      task: {
        status: { not: "Deleted" },
        ...(options.boardIds?.length
          ? { projectId: { in: options.boardIds } }
          : options.boardId
            ? { projectId: options.boardId }
            : {}),
        project: {
          ...getProjectWhere(userId),
          status: { in: ["Normal", "Archive"] },
          ...(options.teamId ? { teamId: options.teamId } : {}),
        },
      },
    },
    include: {
      task: {
        select: {
          id: true,
          uniqueIndex: true,
          ticketNumber: true,
          title: true,
          projectId: true,
          project: { select: { title: true } },
        },
      },
      user: { select: { displayName: true } },
    },
    // Pin every running timer ahead of completed entries before applying the
    // report cap, including timers that started more than 1000 entries ago.
    orderBy: [
      { endedAt: { sort: "asc", nulls: "first" } },
      { startedAt: "desc" },
    ],
    take: 1000,
  });

  entries.sort((a, b) => {
    const runningDifference = Number(a.endedAt !== null) - Number(b.endedAt !== null);
    return runningDifference || b.startedAt.getTime() - a.startedAt.getTime();
  });

  const projectIds = [...new Set(entries.map((entry) => entry.task.projectId))];
  const manageableProjectIds = new Set(
    (
      await Promise.all(
        projectIds.map(async (projectId) => ({
          canManage: await isProjectAdmin(userId, projectId),
          projectId,
        }))
      )
    )
      .filter(({ canManage }) => canManage)
      .map(({ projectId }) => projectId)
  );

  return entries.map(({ task, user, ...entry }) => ({
    id: entry.id,
    taskId: entry.taskId,
    userId: entry.userId,
    userName: user.displayName ?? "Unknown user",
    note: entry.note,
    task: {
      uniqueIndex: task.uniqueIndex,
      ticketNumber: task.ticketNumber,
      title: task.title,
      projectId: task.projectId,
      projectName: task.project.title,
    },
    startedAt: entry.startedAt,
    endedAt: entry.endedAt,
    pausedAt: entry.pausedAt,
    createdAt: entry.createdAt,
    seconds: elapsedSeconds(entry.startedAt, entry.endedAt, entry.pausedAt),
    canManage: manageableProjectIds.has(task.projectId),
  }));
}

export async function updateEntry(
  userId: number,
  entryId: number,
  minutes: number,
  date?: string,
  timezoneOffsetMinutes?: number,
  note?: string | null,
  agentId?: string | null
) {
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 1440) {
    throw new RangeError("Minutes must be an integer from 1 to 1440");
  }

  const result = await updateTimeEntryOnActiveBoard(
    timeWriteClient,
    { userId, entryId, projectWhere: getProjectWhere(userId, agentId) },
    (entry) => ({
      ...(date === undefined
        ? {
            startedAt: entry.startedAt,
            endedAt: new Date(entry.startedAt.getTime() + minutes * 60 * 1000),
          }
        : manualEntryTimes(date, minutes, timezoneOffsetMinutes)),
      ...(note !== undefined ? { note: normalizeNote(note) } : {}),
    })
  );
  if (!result) return null;

  notifyTimeChange(result.entry.taskId, result.projectId);
  const { user, ...updated } = result.entry;
  return {
    ...updated,
    userName: user.displayName ?? "Unknown user",
  };
}

export async function deleteEntry(
  userId: number,
  entryId: number,
  agentId?: string | null
) {
  const result = await deleteTimeEntryOnActiveBoard(timeWriteClient, {
    userId,
    entryId,
    projectWhere: getProjectWhere(userId, agentId),
  });
  if (!result) return null;

  notifyTimeChange(result.taskId, result.projectId);
  return true;
}

export async function taskSummary(userId: number, taskId: number) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: {
      project: { select: { status: true, timeTrackingEnabled: true } },
    },
  });
  const entries = await prisma.timeEntry.findMany({
    where: {
      taskId,
      ...(task?.project.status === "Normal" ? {} : { endedAt: null }),
    },
    orderBy: { startedAt: "asc" },
  });
  const now = new Date();
  const runningEntry =
    entries.find((entry) => entry.userId === userId && entry.endedAt === null) ?? null;
  const activeRunningEntryCount = entries.filter(
    (entry) => entry.endedAt === null && entry.pausedAt === null
  ).length;

  return {
    enabled:
      task?.project.status === "Normal" && task.project.timeTrackingEnabled,
    runningEntry,
    activeRunningEntryCount,
    myTotalSeconds: entries
      .filter((entry) => entry.userId === userId)
      .reduce(
        (total, entry) =>
          total + elapsedSeconds(entry.startedAt, entry.endedAt, entry.pausedAt, now),
        0
      ),
    taskTotalSeconds: entries.reduce(
      (total, entry) =>
        total + elapsedSeconds(entry.startedAt, entry.endedAt, entry.pausedAt, now),
      0
    ),
    // Every entry except the caller's own running one, so a client can tell
    // "this run" from everything else without subtracting a server timestamp
    // from a browser clock (HTPR-4701). Includes other users' running timers.
    otherEntriesSeconds: entries.reduce(
      (total, entry) =>
        entry.id === runningEntry?.id
          ? total
          : total + elapsedSeconds(entry.startedAt, entry.endedAt, entry.pausedAt, now),
      0
    ),
  };
}
