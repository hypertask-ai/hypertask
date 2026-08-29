const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { Prisma } = require("@prisma/client");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const {
  createTimeEntryOnActiveBoard,
  deleteTimeEntryOnActiveBoard,
  pauseTimerOnActiveBoard,
  resumeTimerOnActiveBoard,
  startTimerInTransaction,
  startTimerOnActiveBoard,
  stopTimerOnAccessibleBoard,
  TimeTrackingDisabledError,
  updateTimeEntryOnActiveBoard,
} = jiti(path.join(root, "src/lib/timeEntryWriter.ts"));

const writeData = {
  userId: 6,
  taskId: 4329,
  startedAt: new Date("2026-08-22T09:00:00.000Z"),
  endedAt: new Date("2026-08-22T09:30:00.000Z"),
};
const projectWhere = { teamId: { not: null } };

function transactionClient(project) {
  const created = [];
  const tx = {
    task: {
      findFirst: async ({ where }) => {
        assert.deepEqual(where.project, projectWhere);
        return project === null ? null : { projectId: 15, project };
      },
    },
    timeEntry: {
      create: async ({ data }) => {
        const entry = { id: 1, pausedAt: null, ...data };
        created.push(entry);
        return entry;
      },
      findFirst: async () => null,
      update: async () => {
        throw new Error("unexpected update");
      },
    },
  };
  return { created, tx };
}

function clientFor(tx, beforeTransaction) {
  const isolationLevels = [];
  return {
    isolationLevels,
    async $transaction(operation, options) {
      isolationLevels.push(options.isolationLevel);
      await beforeTransaction?.(isolationLevels.length);
      return operation(tx);
    },
  };
}

test("completed entries are created only inside a serializable active-board transaction", async () => {
  const { created, tx } = transactionClient({
    status: "Normal",
    timeTrackingEnabled: true,
  });
  const client = clientFor(tx);

  const entry = await createTimeEntryOnActiveBoard(
    client,
    writeData,
    projectWhere
  );

  assert.deepEqual(client.isolationLevels, ["Serializable"]);
  assert.deepEqual(created, [{ id: 1, pausedAt: null, ...writeData }]);
  assert.deepEqual(entry, created[0]);
});

test("missing, archived, and disabled task boards reject without creating an entry", async () => {
  for (const project of [
    null,
    { status: "Archive", timeTrackingEnabled: true },
    { status: "Normal", timeTrackingEnabled: false },
  ]) {
    const { created, tx } = transactionClient(project);

    await assert.rejects(
      createTimeEntryOnActiveBoard(clientFor(tx), writeData, projectWhere),
      TimeTrackingDisabledError
    );
    assert.deepEqual(created, []);
  }
});

test("serialization conflicts retry, but unrelated Prisma failures do not", async () => {
  const { created, tx } = transactionClient({
    status: "Normal",
    timeTrackingEnabled: true,
  });
  const conflict = new Prisma.PrismaClientKnownRequestError("conflict", {
    code: "P2034",
    clientVersion: "test",
  });
  let authorizationChecks = 0;
  const findFirst = tx.task.findFirst;
  tx.task.findFirst = async (args) => {
    authorizationChecks += 1;
    if (authorizationChecks < 3) throw conflict;
    return findFirst(args);
  };
  const retryingClient = clientFor(tx);

  await createTimeEntryOnActiveBoard(retryingClient, writeData, projectWhere);
  assert.deepEqual(retryingClient.isolationLevels, [
    "Serializable",
    "Serializable",
    "Serializable",
  ]);
  assert.equal(authorizationChecks, 3);
  assert.equal(created.length, 1);

  const unrelated = new Prisma.PrismaClientKnownRequestError("failure", {
    code: "P2002",
    clientVersion: "test",
  });
  tx.task.findFirst = async () => {
    throw unrelated;
  };
  const failingClient = clientFor(tx);
  await assert.rejects(
    createTimeEntryOnActiveBoard(failingClient, writeData, projectWhere),
    (error) => error === unrelated
  );
  assert.equal(failingClient.isolationLevels.length, 1);
});

test("starting a timer applies the same active-board gate before any write", async () => {
  for (const project of [
    null,
    { status: "Archive", timeTrackingEnabled: true },
    { status: "Normal", timeTrackingEnabled: false },
  ]) {
    const { created, tx } = transactionClient(project);

    await assert.rejects(
      startTimerInTransaction(tx, 6, 4329, projectWhere),
      TimeTrackingDisabledError
    );
    assert.deepEqual(created, []);
  }

  const { created, tx } = transactionClient({
    status: "Normal",
    timeTrackingEnabled: true,
  });
  const client = clientFor(tx);
  const result = await startTimerOnActiveBoard(
    client,
    6,
    4329,
    projectWhere
  );
  assert.equal(result.projectId, 15);
  assert.deepEqual(client.isolationLevels, ["Serializable"]);
  assert.deepEqual(created, [
    { id: 1, pausedAt: null, userId: 6, taskId: 4329 },
  ]);
});

test("starting through a paused timer repeats the active-board predicate", async () => {
  const pausedAt = new Date("2026-08-22T09:30:00.000Z");
  const startedAt = new Date("2026-08-22T09:00:00.000Z");
  const now = new Date("2026-08-22T10:00:00.000Z");
  let active = true;
  let updated = null;
  const tx = {
    task: {
      findFirst: async () => ({
        projectId: 15,
        project: { status: "Normal", timeTrackingEnabled: true },
      }),
    },
    timeEntry: {
      findFirst: async () => ({
        id: 4,
        taskId: 4329,
        userId: 6,
        startedAt,
        endedAt: null,
        pausedAt,
        note: null,
        createdAt: startedAt,
      }),
      updateMany: async ({ data, where }) => {
        assert.equal(where.task.project.status, "Normal");
        assert.equal(where.task.project.timeTrackingEnabled, true);
        assert.deepEqual(where.task.project.teamId, { not: null });
        if (!active) return { count: 0 };
        updated = data;
        return { count: 1 };
      },
    },
  };
  const client = clientFor(tx);
  const started = await startTimerOnActiveBoard(
    client,
    6,
    4329,
    projectWhere,
    now
  );
  assert.equal(started.entry.startedAt.toISOString(), "2026-08-22T09:30:00.000Z");
  assert.deepEqual(updated, {
    startedAt: new Date("2026-08-22T09:30:00.000Z"),
    pausedAt: null,
  });

  active = false;
  await assert.rejects(
    startTimerOnActiveBoard(client, 6, 4329, projectWhere, now),
    TimeTrackingDisabledError
  );
});

test("resuming a timer rechecks enabled-board state inside a serializable transaction", async () => {
  const pausedAt = new Date("2026-08-22T09:30:00.000Z");
  const startedAt = new Date("2026-08-22T09:00:00.000Z");
  const now = new Date("2026-08-22T10:00:00.000Z");
  const project = { status: "Normal", timeTrackingEnabled: true };
  let updated = false;
  const tx = {
    task: {
      findFirst: async ({ where }) => {
        assert.deepEqual(where.project, projectWhere);
        return { project };
      },
    },
    timeEntry: {
      findFirst: async () => ({
        id: 2,
        taskId: 4329,
        userId: 6,
        startedAt,
        endedAt: null,
        pausedAt,
        note: null,
        createdAt: startedAt,
      }),
      updateMany: async ({ where }) => {
        assert.equal(where.task.project.status, "Normal");
        assert.equal(where.task.project.timeTrackingEnabled, true);
        assert.deepEqual(where.task.project.teamId, { not: null });
        if (project.status !== "Normal" || !project.timeTrackingEnabled) {
          return { count: 0 };
        }
        updated = true;
        return { count: 1 };
      },
    },
  };
  const client = clientFor(tx);
  const resumed = await resumeTimerOnActiveBoard(
    client,
    6,
    4329,
    projectWhere,
    now
  );
  assert.equal(resumed.startedAt.toISOString(), "2026-08-22T09:30:00.000Z");
  assert.equal(resumed.pausedAt, null);
  assert.equal(updated, true);
  assert.deepEqual(client.isolationLevels, ["Serializable"]);

  project.timeTrackingEnabled = false;
  updated = false;
  await assert.rejects(
    resumeTimerOnActiveBoard(client, 6, 4329, projectWhere, now),
    TimeTrackingDisabledError
  );
  assert.equal(updated, false);
});

function timerMutationClient({
  archiveBeforeMutation = false,
  pausedAt = null,
  projectStatus = "Normal",
  timeTrackingEnabled = true,
} = {}) {
  const startedAt = new Date("2026-08-22T09:00:00.000Z");
  const state = { projectStatus, timeTrackingEnabled, updated: null };
  const matchesStatus = (status) =>
    typeof status === "string"
      ? state.projectStatus === status
      : status.in.includes(state.projectStatus);
  const matchesProject = (where) =>
    matchesStatus(where.status) &&
    (where.timeTrackingEnabled === undefined ||
      state.timeTrackingEnabled === where.timeTrackingEnabled);
  const entry = {
    id: 3,
    taskId: 4329,
    userId: 6,
    startedAt,
    endedAt: null,
    pausedAt,
    note: null,
    createdAt: startedAt,
  };
  const tx = {
    task: {
      findFirst: async ({ where }) => {
        assert.equal(where.id, 4329);
        assert.equal(where.project.timeTrackingEnabled, undefined);
        assert.deepEqual(where.project.teamId, { not: null });
        return matchesProject(where.project) ? { id: 4329 } : null;
      },
    },
    timeEntry: {
      findFirst: async () => entry,
      updateMany: async ({ data, where }) => {
        assert.equal(where.task.project.timeTrackingEnabled, undefined);
        assert.deepEqual(where.task.project.teamId, { not: null });
        if (archiveBeforeMutation) state.projectStatus = "Archive";
        if (!matchesProject(where.task.project)) return { count: 0 };
        state.updated = data;
        return { count: 1 };
      },
    },
  };
  return { client: clientFor(tx), state };
}

test("pause and stop allow disabled tracking but recheck active-board access", async () => {
  const now = new Date("2026-08-22T10:00:00.000Z");
  const activePause = timerMutationClient({ timeTrackingEnabled: false });
  const paused = await pauseTimerOnActiveBoard(
    activePause.client,
    6,
    4329,
    projectWhere,
    now
  );
  assert.equal(paused.pausedAt, now);
  assert.deepEqual(activePause.state.updated, { pausedAt: now });

  const pausedAt = new Date("2026-08-22T09:30:00.000Z");
  const activeStop = timerMutationClient({
    pausedAt,
    timeTrackingEnabled: false,
  });
  const stopped = await stopTimerOnAccessibleBoard(
    activeStop.client,
    6,
    4329,
    projectWhere,
    now
  );
  assert.equal(stopped.endedAt, pausedAt);
  assert.deepEqual(activeStop.state.updated, { endedAt: pausedAt });

  const archivedRace = timerMutationClient({ archiveBeforeMutation: true });
  assert.equal(
    await pauseTimerOnActiveBoard(
      archivedRace.client,
      6,
      4329,
      projectWhere,
      now
    ),
    null
  );
  assert.equal(archivedRace.state.updated, null);

  const archived = timerMutationClient({ projectStatus: "Archive" });
  const archivedStop = await stopTimerOnAccessibleBoard(
    archived.client,
    6,
    4329,
    projectWhere,
    now
  );
  assert.equal(archivedStop.endedAt, now);
  assert.deepEqual(archived.state.updated, { endedAt: now });

  const archivedPause = timerMutationClient({ projectStatus: "Archive" });
  await assert.rejects(
    pauseTimerOnActiveBoard(
      archivedPause.client,
      6,
      4329,
      projectWhere,
      now
    ),
    TimeTrackingDisabledError
  );
});

function mutableEntryClient({
  archiveBeforeMutation = false,
  entryUserId = 6,
  endedAt = new Date("2026-08-22T09:30:00.000Z"),
  manager = false,
  timeTrackingEnabled = true,
} = {}) {
  const state = {
    deleted: false,
    projectStatus: "Normal",
    timeTrackingEnabled,
    entry: {
      id: 9,
      taskId: 4329,
      userId: entryUserId,
      startedAt: new Date("2026-08-22T09:00:00.000Z"),
      endedAt,
      pausedAt: null,
      note: null,
      createdAt: new Date("2026-08-22T09:00:00.000Z"),
      task: { projectId: 15 },
    },
  };
  const activeAtMutation = () => {
    if (archiveBeforeMutation) state.projectStatus = "Archive";
    return state.projectStatus === "Normal";
  };
  const matchesProject = (where) =>
    state.projectStatus === where.status &&
    (where.timeTrackingEnabled === undefined ||
      state.timeTrackingEnabled === where.timeTrackingEnabled);
  const tx = {
    project: {
      findFirst: async ({ where }) => {
        assert.equal(where.id, 15);
        assert.equal(where.status, "Normal");
        assert.equal(where.OR[1].members.some.userId, 6);
        assert.equal(where.OR[1].members.some.role, "Admin");
        return manager && state.projectStatus === "Normal" ? { id: 15 } : null;
      },
    },
    timeEntry: {
      findFirst: async ({ where }) => {
        assert.equal(where.id, 9);
        assert.equal(where.task.project.status, "Normal");
        assert.equal(where.task.project.timeTrackingEnabled, undefined);
        assert.deepEqual(where.task.project.teamId, { not: null });
        const endedStateMatches = !where.endedAt || state.entry.endedAt !== null;
        return !state.deleted &&
          matchesProject(where.task.project) &&
          endedStateMatches
          ? state.entry
          : null;
      },
      updateMany: async ({ data, where }) => {
        assert.equal(where.id, 9);
        assert.equal(where.task.project.status, "Normal");
        assert.equal(where.task.project.timeTrackingEnabled, undefined);
        activeAtMutation();
        if (!matchesProject(where.task.project)) return { count: 0 };
        state.entry = { ...state.entry, ...data };
        return { count: 1 };
      },
      findUnique: async () =>
        state.deleted
          ? null
          : { ...state.entry, user: { displayName: "Owner" } },
      deleteMany: async ({ where }) => {
        assert.equal(where.id, 9);
        assert.equal(where.task.project.status, "Normal");
        assert.equal(where.task.project.timeTrackingEnabled, undefined);
        activeAtMutation();
        if (!matchesProject(where.task.project)) return { count: 0 };
        state.deleted = true;
        return { count: 1 };
      },
    },
  };
  return { client: clientFor(tx), state };
}

test("entry updates recheck the active board inside the write transaction", async () => {
  const active = mutableEntryClient();
  const updated = await updateTimeEntryOnActiveBoard(
    active.client,
    { userId: 6, entryId: 9, projectWhere },
    () => ({ note: "reviewed" })
  );
  assert.equal(updated.entry.note, "reviewed");
  assert.equal(updated.projectId, 15);
  assert.deepEqual(active.client.isolationLevels, ["Serializable"]);

  const archived = mutableEntryClient({ archiveBeforeMutation: true });
  assert.equal(
    await updateTimeEntryOnActiveBoard(
      archived.client,
      { userId: 6, entryId: 9, projectWhere },
      () => ({ note: "must not persist" })
    ),
    null
  );
  assert.equal(archived.state.entry.note, null);
});

test("only an entry owner or active-board manager can update another user's entry", async () => {
  const denied = mutableEntryClient({ entryUserId: 7 });
  assert.equal(
    await updateTimeEntryOnActiveBoard(
      denied.client,
      { userId: 6, entryId: 9, projectWhere },
      () => ({ note: "denied" })
    ),
    null
  );
  assert.equal(denied.state.entry.note, null);

  const allowed = mutableEntryClient({ entryUserId: 7, manager: true });
  const updated = await updateTimeEntryOnActiveBoard(
    allowed.client,
    { userId: 6, entryId: 9, projectWhere },
    () => ({ note: "managed" })
  );
  assert.equal(updated.entry.note, "managed");
});

test("existing entries stay editable when time tracking is disabled", async () => {
  const disabled = mutableEntryClient({ timeTrackingEnabled: false });
  const updated = await updateTimeEntryOnActiveBoard(
    disabled.client,
    { userId: 6, entryId: 9, projectWhere },
    () => ({ note: "corrected" })
  );

  assert.equal(disabled.state.timeTrackingEnabled, false);
  assert.equal(updated.entry.note, "corrected");
});

test("entry deletion rechecks the active board inside the write transaction", async () => {
  const active = mutableEntryClient();
  assert.deepEqual(
    await deleteTimeEntryOnActiveBoard(active.client, {
      userId: 6,
      entryId: 9,
      projectWhere,
    }),
    { projectId: 15, taskId: 4329 }
  );
  assert.equal(active.state.deleted, true);

  const archived = mutableEntryClient({ archiveBeforeMutation: true });
  assert.equal(
    await deleteTimeEntryOnActiveBoard(archived.client, {
      userId: 6,
      entryId: 9,
      projectWhere,
    }),
    null
  );
  assert.equal(archived.state.deleted, false);
});

test("running entries can be deleted when the caller removes a mistaken timer", async () => {
  const running = mutableEntryClient({ endedAt: null });
  assert.deepEqual(
    await deleteTimeEntryOnActiveBoard(running.client, {
      userId: 6,
      entryId: 9,
      projectWhere,
    }),
    { projectId: 15, taskId: 4329 }
  );
  assert.equal(running.state.deleted, true);
});
