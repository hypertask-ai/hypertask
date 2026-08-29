import { Prisma, type TimeEntry } from "@prisma/client";
import { resumedStartedAt, stoppedAt } from "@/lib/timeDuration";

export const MAX_TIME_WRITE_ATTEMPTS = 3;

export type CheckedTimeEntryData = {
  userId: number;
  taskId: number;
  note?: string | null;
  startedAt?: Date;
  endedAt?: Date;
};

type TimeWriteTransaction = Pick<
  Prisma.TransactionClient,
  "project" | "task" | "timeEntry"
>;

export type TimeWriteClient = {
  $transaction<T>(
    operation: (tx: TimeWriteTransaction) => Promise<T>,
    options: { isolationLevel: "Serializable" }
  ): Promise<T>;
};

export class TimeTrackingDisabledError extends Error {
  constructor() {
    super("Time tracking is not enabled for this board.");
    this.name = "TimeTrackingDisabledError";
  }
}

type WritableTimeTask = {
  project: { status: string; timeTrackingEnabled: boolean };
};

function assertTimeWriteAllowed<T extends WritableTimeTask>(
  task: T | null
): asserts task is T {
  if (
    !task ||
    task.project.status !== "Normal" ||
    !task.project.timeTrackingEnabled
  ) {
    throw new TimeTrackingDisabledError();
  }
}

async function runSerializableTimeWrite<T>(
  client: TimeWriteClient,
  operation: (tx: TimeWriteTransaction) => Promise<T>
): Promise<T> {
  for (let attempt = 0; attempt < MAX_TIME_WRITE_ATTEMPTS; attempt += 1) {
    try {
      return await client.$transaction(operation, {
        isolationLevel: "Serializable",
      });
    } catch (error: unknown) {
      if (
        !(
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2034"
        ) ||
        attempt === MAX_TIME_WRITE_ATTEMPTS - 1
      ) {
        throw error;
      }
    }
  }

  throw new Error("Unable to complete time entry write");
}

export async function createTimeEntryOnActiveBoard(
  client: TimeWriteClient,
  data: CheckedTimeEntryData,
  projectWhere: Prisma.ProjectWhereInput
): Promise<TimeEntry> {
  return runSerializableTimeWrite(client, async (tx) => {
    const task = await tx.task.findFirst({
      where: { id: data.taskId, project: projectWhere },
      select: {
        project: {
          select: { status: true, timeTrackingEnabled: true },
        },
      },
    });
    assertTimeWriteAllowed(task);

    return tx.timeEntry.create({ data });
  });
}

type MutableTimeEntry = Pick<
  TimeEntry,
  "id" | "taskId" | "userId" | "startedAt"
> & {
  task: { projectId: number };
};

type TimeEntryMutationRequest = {
  userId: number;
  entryId: number;
  projectWhere: Prisma.ProjectWhereInput;
};

function managerProjectWhere(userId: number, projectId: number) {
  return {
    id: projectId,
    status: "Normal" as const,
    OR: [
      { ownerId: userId },
      {
        members: {
          some: {
            userId,
            status: "Accepted" as const,
            agentId: null,
            role: "Admin" as const,
          },
        },
      },
    ],
  } satisfies Prisma.ProjectWhereInput;
}

async function findMutableTimeEntry(
  tx: TimeWriteTransaction,
  request: TimeEntryMutationRequest,
  requireEnded: boolean
): Promise<
  | {
      entry: MutableTimeEntry;
      mutationProjectWhere: Prisma.ProjectWhereInput;
    }
  | undefined
> {
  const entry = await tx.timeEntry.findFirst({
    where: {
      id: request.entryId,
      ...(requireEnded ? { endedAt: { not: null } } : {}),
      task: {
        project: { ...request.projectWhere, status: "Normal" },
      },
    },
    include: { task: { select: { projectId: true } } },
  });
  if (!entry) return undefined;

  if (entry.userId === request.userId) {
    return {
      entry,
      mutationProjectWhere: {
        ...request.projectWhere,
        status: "Normal",
      },
    };
  }

  const mutationProjectWhere = managerProjectWhere(
    request.userId,
    entry.task.projectId
  );
  const manageable = await tx.project.findFirst({
    where: mutationProjectWhere,
    select: { id: true },
  });
  if (!manageable) return undefined;

  return { entry, mutationProjectWhere };
}

export async function updateTimeEntryOnActiveBoard(
  client: TimeWriteClient,
  request: TimeEntryMutationRequest,
  dataForEntry: (
    entry: MutableTimeEntry
  ) => Prisma.TimeEntryUpdateManyMutationInput
) {
  return runSerializableTimeWrite(client, async (tx) => {
    const mutable = await findMutableTimeEntry(tx, request, true);
    if (!mutable) return null;

    const result = await tx.timeEntry.updateMany({
      where: {
        id: mutable.entry.id,
        task: { project: mutable.mutationProjectWhere },
      },
      data: dataForEntry(mutable.entry),
    });
    if (result.count === 0) return null;

    const updated = await tx.timeEntry.findUnique({
      where: { id: mutable.entry.id },
      include: { user: { select: { displayName: true } } },
    });
    if (!updated) return null;

    return {
      entry: updated,
      projectId: mutable.entry.task.projectId,
    };
  });
}

export async function deleteTimeEntryOnActiveBoard(
  client: TimeWriteClient,
  request: TimeEntryMutationRequest
) {
  return runSerializableTimeWrite(client, async (tx) => {
    const mutable = await findMutableTimeEntry(tx, request, false);
    if (!mutable) return null;

    const result = await tx.timeEntry.deleteMany({
      where: {
        id: mutable.entry.id,
        task: { project: mutable.mutationProjectWhere },
      },
    });
    if (result.count === 0) return null;

    return {
      projectId: mutable.entry.task.projectId,
      taskId: mutable.entry.taskId,
    };
  });
}

export async function startTimerInTransaction(
  tx: TimeWriteTransaction,
  userId: number,
  taskId: number,
  projectWhere: Prisma.ProjectWhereInput,
  now = new Date()
) {
  const task = await tx.task.findFirst({
    where: { id: taskId, project: projectWhere },
    select: {
      projectId: true,
      project: { select: { status: true, timeTrackingEnabled: true } },
    },
  });
  assertTimeWriteAllowed(task);

  const runningEntry = await tx.timeEntry.findFirst({
    where: { userId, taskId, endedAt: null },
    orderBy: { id: "asc" },
  });

  if (runningEntry?.pausedAt) {
    const startedAt = resumedStartedAt(
      runningEntry.startedAt,
      runningEntry.pausedAt,
      now
    );
    const result = await tx.timeEntry.updateMany({
      where: {
        id: runningEntry.id,
        endedAt: null,
        pausedAt: runningEntry.pausedAt,
        task: {
          project: {
            ...projectWhere,
            status: "Normal",
            timeTrackingEnabled: true,
          },
        },
      },
      data: { startedAt, pausedAt: null },
    });
    if (result.count === 0) throw new TimeTrackingDisabledError();

    return {
      entry: { ...runningEntry, startedAt, pausedAt: null },
      projectId: task.projectId,
    };
  }

  return {
    entry:
      runningEntry ??
      (await tx.timeEntry.create({ data: { userId, taskId } })),
    projectId: task.projectId,
  };
}

export async function startTimerOnActiveBoard(
  client: TimeWriteClient,
  userId: number,
  taskId: number,
  projectWhere: Prisma.ProjectWhereInput,
  now = new Date()
) {
  return runSerializableTimeWrite(client, (tx) =>
    startTimerInTransaction(tx, userId, taskId, projectWhere, now)
  );
}

export async function resumeTimerOnActiveBoard(
  client: TimeWriteClient,
  userId: number,
  taskId: number,
  projectWhere: Prisma.ProjectWhereInput,
  now = new Date()
) {
  return runSerializableTimeWrite(client, async (tx) => {
    const task = await tx.task.findFirst({
      where: { id: taskId, project: projectWhere },
      select: {
        project: { select: { status: true, timeTrackingEnabled: true } },
      },
    });
    assertTimeWriteAllowed(task);

    const pausedEntry = await tx.timeEntry.findFirst({
      where: {
        userId,
        taskId,
        endedAt: null,
        pausedAt: { not: null },
      },
      orderBy: { id: "asc" },
    });
    if (!pausedEntry?.pausedAt) return null;

    const startedAt = resumedStartedAt(
      pausedEntry.startedAt,
      pausedEntry.pausedAt,
      now
    );
    const result = await tx.timeEntry.updateMany({
      where: {
        id: pausedEntry.id,
        endedAt: null,
        pausedAt: pausedEntry.pausedAt,
        task: {
          project: {
            ...projectWhere,
            status: "Normal",
            timeTrackingEnabled: true,
          },
        },
      },
      data: { startedAt, pausedAt: null },
    });
    if (result.count === 0) return null;

    return { ...pausedEntry, startedAt, pausedAt: null };
  });
}

export async function stopTimerOnAccessibleBoard(
  client: TimeWriteClient,
  userId: number,
  taskId: number,
  projectWhere: Prisma.ProjectWhereInput,
  now = new Date()
) {
  return runSerializableTimeWrite(client, async (tx) => {
    const task = await tx.task.findFirst({
      where: {
        id: taskId,
        project: {
          ...projectWhere,
          status: { in: ["Normal", "Archive"] },
        },
      },
      select: { id: true },
    });
    if (!task) throw new TimeTrackingDisabledError();

    const runningEntry = await tx.timeEntry.findFirst({
      where: { userId, taskId, endedAt: null },
      orderBy: { id: "asc" },
    });
    if (!runningEntry) return null;

    const endedAt = stoppedAt(runningEntry.pausedAt, now);
    const result = await tx.timeEntry.updateMany({
      where: {
        id: runningEntry.id,
        endedAt: null,
        pausedAt: runningEntry.pausedAt,
        task: {
          project: {
            ...projectWhere,
            status: { in: ["Normal", "Archive"] },
          },
        },
      },
      data: { endedAt },
    });
    if (result.count === 0) return null;

    return { ...runningEntry, endedAt };
  });
}

export async function pauseTimerOnActiveBoard(
  client: TimeWriteClient,
  userId: number,
  taskId: number,
  projectWhere: Prisma.ProjectWhereInput,
  now = new Date()
) {
  return runSerializableTimeWrite(client, async (tx) => {
    const task = await tx.task.findFirst({
      where: {
        id: taskId,
        project: { ...projectWhere, status: "Normal" },
      },
      select: { id: true },
    });
    if (!task) throw new TimeTrackingDisabledError();

    const runningEntry = await tx.timeEntry.findFirst({
      where: { userId, taskId, endedAt: null, pausedAt: null },
      orderBy: { id: "asc" },
    });
    if (!runningEntry) return null;

    const result = await tx.timeEntry.updateMany({
      where: {
        id: runningEntry.id,
        endedAt: null,
        pausedAt: null,
        task: { project: { ...projectWhere, status: "Normal" } },
      },
      data: { pausedAt: now },
    });
    if (result.count === 0) return null;

    return { ...runningEntry, pausedAt: now };
  });
}
