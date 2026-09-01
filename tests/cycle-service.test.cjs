const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
let entryId = 0;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function loadService({ cycles = [], enabled = false, sections = [], tasks = [] } = {}) {
  const state = {
    broadcasts: [],
    cycles: cycles.map((cycle) => ({ createdAt: new Date(), rolledOverAt: null, ...cycle })),
    enabled,
    nextId: Math.max(0, ...cycles.map(({ id }) => id)) + 1,
    rolloverSources: [],
    sections,
    tasks: tasks.map((task) => ({ ...task })),
  };

  const cycleMatches = (cycle, where) => {
    if (where.id !== undefined && cycle.id !== where.id) return false;
    if (where.projectId !== undefined && cycle.projectId !== where.projectId) return false;
    if (where.rolledOverAt === null && cycle.rolledOverAt !== null) return false;
    if (where.startDate?.lte && cycle.startDate > where.startDate.lte) return false;
    if (where.startDate?.gt && cycle.startDate <= where.startDate.gt) return false;
    if (where.endDate?.gt && cycle.endDate <= where.endDate.gt) return false;
    if (where.endDate?.lte && cycle.endDate > where.endDate.lte) return false;
    return true;
  };
  const db = {
    $queryRaw: async () => undefined,
    cycle: {
      aggregate: async ({ where }) => ({
        _max: {
          number: Math.max(
            0,
            ...state.cycles
              .filter((cycle) => cycle.projectId === where.projectId)
              .map((cycle) => cycle.number),
          ),
        },
      }),
      create: async ({ data }) => {
        const cycle = { id: state.nextId++, createdAt: new Date(), rolledOverAt: null, ...data };
        state.cycles.push(cycle);
        return cycle;
      },
      findFirst: async ({ where, orderBy }) => {
        const found = state.cycles.filter((cycle) => cycleMatches(cycle, where));
        const [field, direction] = Object.entries(orderBy)[0];
        found.sort((left, right) =>
          direction === "asc" ? left[field] - right[field] : right[field] - left[field],
        );
        return found[0] ?? null;
      },
      findMany: async ({ where, orderBy, take }) =>
        state.cycles
          .filter((cycle) => cycleMatches(cycle, where))
          .sort((left, right) => left.startDate - right.startDate)
          .slice(0, take),
      findUnique: async ({ where }) => {
        if (where.projectId_startDate) {
          const key = where.projectId_startDate;
          return (
            state.cycles.find(
              (cycle) => cycle.projectId === key.projectId && +cycle.startDate === +key.startDate,
            ) ?? null
          );
        }
        return state.cycles.find((cycle) => cycle.id === where.id) ?? null;
      },
      updateMany: async ({ where, data }) => {
        const found = state.cycles.filter((cycle) => cycleMatches(cycle, where));
        for (const cycle of found) Object.assign(cycle, data);
        return { count: found.length };
      },
    },
    project: {
      findUnique: async () => ({ id: 15, cyclesEnabled: state.enabled }),
      update: async ({ data }) => {
        state.enabled = data.cyclesEnabled;
        return { id: 15, cyclesEnabled: state.enabled };
      },
    },
    section: { findMany: async () => state.sections },
    task: {
      updateMany: async ({ where, data }) => {
        state.rolloverSources.push(where.cycleId);
        if (state.raceTaskId) {
          const raced = state.tasks.find(({ id }) => id === state.raceTaskId);
          if (raced) raced.cycleId = 999;
          state.raceTaskId = null;
        }
        const found = state.tasks.filter(
          (task) =>
            task.projectId === where.projectId &&
            task.cycleId === where.cycleId &&
            task.status === where.status &&
            task.assignees.length > 0 &&
            (!where.sectionId || !where.sectionId.notIn.includes(task.sectionId)) &&
            (!where.section || !where.section.notIn.includes(task.section)),
        );
        for (const task of found) Object.assign(task, data);
        return { count: found.length };
      },
    },
  };
  db.$transaction = async (callback) => callback(db);

  state.queryNow = new Date("1970-01-01T00:00:00Z");
  db.$queryRaw = async (parts, ...values) => {
    if (typeof parts === "object" && "raw" in parts && String(parts.raw).includes("pg_advisory")) {
      return undefined;
    }
    const dateValue = values.find((value) => value instanceof Date);
    if (dateValue) state.queryNow = dateValue;
    return state.enabled
      ? state.cycles
          .filter((cycle) => cycle.rolledOverAt === null && cycle.endDate <= state.queryNow)
          .sort((left, right) => left.endDate - right.endDate)
          .map(({ projectId }) => ({ projectId }))
      : [];
  };

  for (const relativePath of [
    "src/lib/cycleService.ts",
    "src/lib/prisma.ts",
    "src/lib/realtime/server.ts",
  ]) {
    delete require.cache[path.join(root, relativePath)];
  }
  stubModule("src/lib/prisma.ts", { default: db });
  stubModule("src/lib/realtime/server.ts", {
    broadcastBoardChange: (projectId) => state.broadcasts.push(projectId),
  });
  const jiti = require("jiti")(
    path.join(root, `tests/jiti-cycle-service-${++entryId}.cjs`),
    { alias: { "@": path.join(root, "src") }, cache: false, interopDefault: true },
  );
  return { ...jiti(path.join(root, "src/lib/cycleService.ts")), db, state };
}

const cycle = (id, number, startDate, endDate) => ({
  id,
  number,
  projectId: 15,
  startDate: new Date(`${startDate}T00:00:00Z`),
  endDate: new Date(`${endDate}T00:00:00Z`),
});

test("enabling creates the current and next Monday cycles while preserving history", async () => {
  const service = loadService({
    cycles: [cycle(1, 1, "2026-08-03", "2026-08-17")],
    tasks: [{ id: 1, cycleId: 1, projectId: 15 }],
  });
  const now = new Date("2026-09-02T18:30:00Z");

  const overview = await service.setProjectCyclesEnabled(15, true, now);
  assert.equal(service.state.enabled, true);
  assert.deepEqual(
    service.state.cycles.map(({ number, startDate, endDate }) => [
      number,
      startDate.toISOString().slice(0, 10),
      endDate.toISOString().slice(0, 10),
    ]),
    [
      [1, "2026-08-03", "2026-08-17"],
      [2, "2026-08-31", "2026-09-14"],
      [3, "2026-09-14", "2026-09-28"],
    ],
  );
  assert.equal(service.state.cycles[0].rolledOverAt, now);
  assert.equal(service.state.tasks[0].cycleId, 1);
  assert.equal(overview.current.number, 2);
  assert.equal(overview.next.number, 3);

  await service.setProjectCyclesEnabled(15, false, now);
  assert.equal(service.state.enabled, false);
  assert.equal(service.state.cycles.length, 3);
  assert.equal(service.state.tasks[0].cycleId, 1);
});

test("assignment validation is serialized with enablement and current-cycle state", async () => {
  const current = cycle(1, 1, "2026-08-31", "2026-09-14");
  const next = cycle(2, 2, "2026-09-14", "2026-09-28");
  const service = loadService({ cycles: [current, next], enabled: true });
  const now = new Date("2026-09-02T09:00:00Z");

  await service.assertCycleAssignable(service.db, 15, 1, now);
  await assert.rejects(
    service.assertCycleAssignable(service.db, 15, 3, now),
    (error) => error.status === 400,
  );
  service.state.enabled = false;
  await assert.rejects(
    service.assertCycleAssignable(service.db, 15, 1, now),
    (error) => error.status === 409,
  );
});

test("rollover catches up oldest-first and moves only assigned unfinished normal tasks", async () => {
  const service = loadService({
    enabled: true,
    cycles: [
      cycle(1, 1, "2026-08-04", "2026-08-18"),
      cycle(2, 2, "2026-08-18", "2026-09-01"),
      cycle(3, 3, "2026-09-01", "2026-09-15"),
      cycle(4, 4, "2026-09-15", "2026-09-29"),
    ],
    sections: [
      { deleted: false, id: 10, isDone: false, projectId: 15, section_title: "Todo" },
      { deleted: false, id: 20, isDone: true, projectId: 15, section_title: "Released" },
    ],
    tasks: [
      { id: 1, assignees: [{}], cycleId: 1, projectId: 15, section: "Todo", sectionId: 10, status: "Normal" },
      { id: 2, assignees: [], cycleId: 1, projectId: 15, section: "Todo", sectionId: 10, status: "Normal" },
      { id: 3, assignees: [{}], cycleId: 1, projectId: 15, section: "Todo", sectionId: 10, status: "Archive" },
      { id: 4, assignees: [{}], cycleId: 1, projectId: 15, section: "Released", sectionId: 20, status: "Normal" },
      { id: 5, assignees: [{}], cycleId: 2, projectId: 15, section: "Todo", sectionId: 10, status: "Normal" },
      { id: 6, assignees: [{}], cycleId: 1, projectId: 15, section: "Todo", sectionId: 10, status: "Normal" },
    ],
  });
  service.state.raceTaskId = 6;
  const now = new Date("2026-09-02T09:00:00Z");

  assert.equal(await service.sweepCycleRollovers(now), 3);
  assert.deepEqual(service.state.rolloverSources, [1, 2]);
  assert.deepEqual(
    service.state.tasks.map(({ id, cycleId }) => [id, cycleId]),
    [
      [1, 3],
      [2, 1],
      [3, 1],
      [4, 1],
      [5, 3],
      [6, 999],
    ],
  );
  assert.equal(service.state.cycles[0].rolledOverAt, now);
  assert.equal(service.state.cycles[1].rolledOverAt, now);
  assert.deepEqual(service.state.broadcasts, [15]);

  assert.equal(await service.sweepCycleRollovers(now), 0);
  assert.deepEqual(service.state.rolloverSources, [1, 2]);
});
