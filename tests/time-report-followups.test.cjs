const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const {
  shouldHydrateTimeQuickLog,
  timeQuickLogRequestKey,
  timeQuickLogTaskUrl,
  timeQuickLogUrl,
} = jiti(path.join(root, "src/lib/timeQuickLog.ts"));
const { manualEntryTimes, parseTimeMinutes } = jiti(
  path.join(root, "src/lib/timeManualEntry.ts")
);
const { parseTimeReportFilters } = jiti(
  path.join(root, "src/lib/timeReportFilters.ts")
);

test("quick-log URL carries the board, task, and add intent", () => {
  assert.equal(timeQuickLogUrl(15, 23988), "/time?board=15&task=23988&add=1");
});

test("quick-log prefers the focused task's board over the ambient board", () => {
  assert.equal(
    timeQuickLogTaskUrl(23988, 339, 15),
    "/time?board=339&task=23988&add=1"
  );
  assert.equal(
    timeQuickLogTaskUrl(23988, undefined, 15),
    "/time?board=15&task=23988&add=1"
  );
  assert.equal(timeQuickLogTaskUrl(23988, undefined, undefined), null);
});

test("both Ctrl+K task-time commands use quick-log navigation", () => {
  const source = read("src/components/commands.tsx");
  const start = source.indexOf("case CommandMode.GoToTimeThisTask:");
  const end = source.indexOf("case CommandMode.GoToTimeThisBoard:", start);
  const taskTimeCommands = source.slice(start, end);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(taskTimeCommands, /case CommandMode\.GoToTimeThisTask:/);
  assert.match(taskTimeCommands, /case CommandMode\.LogTimeOnTask:/);
  assert.equal(
    [...taskTimeCommands.matchAll(/timeQuickLogTaskUrl\(/g)].length,
    2
  );
  assert.match(taskTimeCommands, /GoToHandler\(url \?\? "\/time"\)/);
});

test("changing a quick-log URL creates a new hydration request", () => {
  assert.equal(timeQuickLogRequestKey(15, "100", true), "15:100");
  assert.equal(timeQuickLogRequestKey(15, "101", true), "15:101");
  assert.equal(timeQuickLogRequestKey(16, "101", true), "16:101");
  assert.equal(timeQuickLogRequestKey(15, "101", false), null);
  assert.equal(shouldHydrateTimeQuickLog("15:101", null), true);
  assert.equal(shouldHydrateTimeQuickLog("15:101", "15:101"), false);
  assert.equal(shouldHydrateTimeQuickLog("15:102", "15:101"), true);
  assert.equal(shouldHydrateTimeQuickLog(null, "15:101"), false);
});

test("manual entries preserve the selected calendar day in UTC+14", () => {
  const { startedAt, endedAt } = manualEntryTimes("2026-08-17", 30, -14 * 60);

  assert.equal(startedAt.toISOString(), "2026-08-16T22:00:00.000Z");
  assert.equal(endedAt.toISOString(), "2026-08-16T22:30:00.000Z");
});

test("manual entries preserve the selected calendar day in UTC-12", () => {
  const { startedAt } = manualEntryTimes("2026-08-17", 30, 12 * 60);

  assert.equal(startedAt.toISOString(), "2026-08-18T00:00:00.000Z");
});

test("time report quick-add opens and preselects the requested task", () => {
  const source = read("src/app/time/TimeComp.tsx");

  assert.match(source, /searchParams\?\.get\("add"\) === "1"/);
  assert.match(source, /setAddEntryOpen\(true\)/);
  assert.match(source, /String\(candidate\.id\) === task/);
  assert.match(source, /setSelectedTask\(matchingTask\)/);
});

test("scope changes remove stale task and quick-add filters", () => {
  const source = read("src/app/time/TimeComp.tsx");

  assert.ok(
    [...source.matchAll(/task: null,\s+add: null,/g)].length >= 2,
    "team and board changes must both clear task and add",
  );
});

test("JSON minute routes reject values that only coerce to numbers", () => {
  for (const value of ["1", true, [1], 1.5, 0, 1441, null]) {
    assert.equal(parseTimeMinutes(value), null);
  }
  for (const file of [
    "src/app/api/time/entries/route.ts",
    "src/app/api/time/log/route.ts",
  ]) {
    assert.match(read(file), /parseTimeMinutes\(body\?\.minutes\)/);
  }
  assert.match(
    read("src/app/api/mcp/time/log/route.ts"),
    /parseTimeMinutes\(resolved\.body\?\.minutes\)/
  );
  assert.match(
    read("src/app/api/ai/chat/stream/route.ts"),
    /minutes: z\.number\(\)\.int\(\)\.min\(1\)\.max\(1440\)/
  );
  assert.equal(parseTimeMinutes(1), 1);
  assert.equal(parseTimeMinutes(1440), 1440);
});

test("report filters reject empty comma-separated board and user values", () => {
  for (const query of [
    "board=1,,2",
    "board=1,",
    "board=",
    "user=me,,5",
    "user=me,",
    "user=",
  ]) {
    assert.equal(
      parseTimeReportFilters(new URLSearchParams(query), 6).success,
      false,
      query
    );
  }
});

test("report filters preserve valid lists, dates, and the current-user alias", () => {
  const parsed = parseTimeReportFilters(
    new URLSearchParams(
      "team=team-1&board=15,16&board=15&user=me,7&task=23988&from=0001-01-01&to=2026-08-17T23:59:59.999Z&running=true"
    ),
    6
  );

  assert.equal(parsed.success, true);
  assert.deepEqual(parsed.filters.boardIds, [15, 16]);
  assert.deepEqual(parsed.filters.filterUserIds, [6, 7]);
  assert.equal(parsed.filters.from.toISOString(), "0001-01-01T00:00:00.000Z");
  assert.equal(parsed.filters.to.toISOString(), "2026-08-17T23:59:59.999Z");
  assert.equal(parsed.filters.runningOnly, true);
});

test("report filters reject ambiguous or non-decimal scalar values", () => {
  for (const query of [
    "task=1e3",
    "task=0x10",
    "task=9007199254740993",
    "task=1&task=2",
    "team=one&team=two",
    "from=2026-08-17&from=2026-08-18",
    "to=2026-08-17&to=2026-08-18",
    "running=true&running=false",
    "team=",
    "team=%20",
  ]) {
    assert.equal(
      parseTimeReportFilters(new URLSearchParams(query), 6).success,
      false,
      query
    );
  }
});

test("date-only report upper bounds include the entire selected day", () => {
  const parsed = parseTimeReportFilters(
    new URLSearchParams("from=2026-08-17&to=2026-08-17"),
    6
  );

  assert.equal(parsed.success, true);
  assert.equal(parsed.filters.from.toISOString(), "2026-08-17T00:00:00.000Z");
  assert.equal(parsed.filters.to.toISOString(), "2026-08-17T23:59:59.999Z");
});

test("running timers are pinned before the 1000-row report cap", () => {
  const source = read("src/lib/timeTracking.ts");
  const pin = source.indexOf('{ endedAt: { sort: "asc", nulls: "first" } }');
  const cap = source.indexOf("take: 1000");

  assert.ok(pin !== -1 && pin < cap);
});

test("time reports retain history from accessible archived boards", async () => {
  const source = read("src/lib/timeTracking.ts");
  const start = source.indexOf("export async function listReport(");
  const end = source.indexOf("\nexport async function updateEntry(", start);
  const javascript = ts.transpileModule(source.slice(start, end), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const loaded = { exports: {} };
  let reportWhere;

  new Function(
    "module",
    "exports",
    "prisma",
    "getProjectWhere",
    "isProjectAdmin",
    "isFeatureEnabled",
    "HTPR_4228_ADMIN_ONLY_TIME_REPORTS_FLAG",
    "elapsedSeconds",
    javascript
  )(
    loaded,
    loaded.exports,
    {
      timeEntry: {
        findMany: async ({ where }) => {
          reportWhere = where;
          return [];
        },
      },
    },
    (userId) => ({ OR: [{ ownerId: userId }] }),
    async () => false,
    async () => false,
    "htpr-4228-admin-only-time-reports",
    () => 0
  );

  await loaded.exports.listReport(6);

  assert.deepEqual(reportWhere.task.project.status, {
    in: ["Normal", "Archive"],
  });
  assert.deepEqual(reportWhere.task.project.OR, [{ ownerId: 6 }]);
});

test("time reports limit plain members to their own entries (HTPR-4228)", async () => {
  const source = read("src/lib/timeTracking.ts");
  const start = source.indexOf("export async function listReport(");
  const end = source.indexOf("\nexport async function updateEntry(", start);
  const javascript = ts.transpileModule(source.slice(start, end), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const loaded = { exports: {} };
  let reportWhere;
  const day = (offset) => new Date(Date.UTC(2026, 8, 9, 10, offset));
  const row = (id, userId, projectId) => ({
    id,
    userId,
    note: null,
    startedAt: day(id),
    endedAt: day(id + 30),
    pausedAt: null,
    createdAt: day(id),
    task: {
      projectId,
      uniqueIndex: id,
      ticketNumber: `T-${id}`,
      title: `Task ${id}`,
      project: { title: `Board ${projectId}` },
    },
    user: { displayName: `User ${userId}` },
  });
  const rows = [row(1, 6, 15), row(2, 7, 15), row(3, 7, 16)];

  new Function(
    "module",
    "exports",
    "prisma",
    "getProjectWhere",
    "isProjectAdmin",
    "isFeatureEnabled",
    "HTPR_4228_ADMIN_ONLY_TIME_REPORTS_FLAG",
    "elapsedSeconds",
    javascript
  )(
    loaded,
    loaded.exports,
    {
      timeEntry: {
        findMany: async ({ where }) => {
          reportWhere = where;
          // The database would apply the visibility OR itself and return
          // rows newest-first; mirror both so the assertions test what the
          // query selects.
          const adminIds = where.OR?.[1]?.task?.projectId?.in ?? [];
          return rows
            .filter(
              (rowCandidate) =>
                rowCandidate.userId === 6 ||
                adminIds.includes(rowCandidate.task.projectId)
            )
            .sort((a, b) => b.startedAt - a.startedAt);
        },
      },
      project: { findMany: async () => [{ id: 16 }] },
    },
    () => ({}),
    async () => false,
    async () => true,
    "htpr-4228-admin-only-time-reports",
    () => 0
  );

  // Flag on: caller 6 is a plain member of board 15 and admin of board 16, so
  // the query itself must keep their rows plus board 16's, newest first.
  const visible = await loaded.exports.listReport(6);

  assert.deepEqual(visible.map((entry) => entry.id), [3, 1]);
  assert.equal(visible[0].canManage, true);
  assert.equal(visible[1].canManage, false);
  assert.deepEqual(reportWhere.OR, [
    { userId: 6 },
    { task: { projectId: { in: [16] } } },
  ]);
});

test("without other-user scope the report query is pinned to the caller", async () => {
  const source = read("src/lib/timeTracking.ts");
  const start = source.indexOf("export async function listReport(");
  const end = source.indexOf("\nexport async function updateEntry(", start);
  const javascript = ts.transpileModule(source.slice(start, end), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const loaded = { exports: {} };
  let reportWhere;

  new Function(
    "module",
    "exports",
    "prisma",
    "getProjectWhere",
    "isProjectAdmin",
    "isFeatureEnabled",
    "HTPR_4228_ADMIN_ONLY_TIME_REPORTS_FLAG",
    "elapsedSeconds",
    javascript
  )(
    loaded,
    loaded.exports,
    {
      timeEntry: {
        findMany: async ({ where }) => {
          reportWhere = where;
          return [];
        },
      },
      project: { findMany: async () => [] },
    },
    () => ({}),
    async () => false,
    async () => true,
    "htpr-4228-admin-only-time-reports",
    () => 0
  );

  // Even a caller-supplied user filter cannot pull in someone else's rows.
  await loaded.exports.listReport(6, { filterUserId: 7 });

  assert.deepEqual(reportWhere.userId, 6);
});

test("administered boards come from the report scope", async () => {
  const source = read("src/lib/timeTracking.ts");
  const start = source.indexOf("export async function administeredProjectIds(");
  const end = source.indexOf("\nexport async function updateEntry(", start);
  const javascript = ts.transpileModule(source.slice(start, end), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const loaded = { exports: {} };
  let capturedWhere;

  new Function(
    "module",
    "exports",
    "prisma",
    "getProjectWhere",
    javascript
  )(
    loaded,
    loaded.exports,
    {
      project: {
        findMany: async ({ where }) => {
          capturedWhere = where;
          return [{ id: 15 }, { id: 16 }];
        },
      },
    },
    () => ({})
  );

  assert.deepEqual(
    await loaded.exports.administeredProjectIds(6, { teamId: "t1" }),
    [15, 16]
  );
  assert.equal(capturedWhere.teamId, "t1");
  assert.deepEqual(capturedWhere.OR, [
    { ownerId: 6 },
    {
      members: {
        some: { userId: 6, status: "Accepted", agentId: null, role: "Admin" },
      },
    },
  ]);

  const empty = { exports: {} };
  new Function("module", "exports", "prisma", "getProjectWhere", javascript)(
    empty,
    empty.exports,
    { project: { findMany: async () => [] } },
    () => ({})
  );
  assert.deepEqual(await empty.exports.administeredProjectIds(6), []);
});

test("the flag-gated report route hides the user filter without other-user scope", () => {
  const route = read("src/app/api/time/report/route.ts");

  assert.match(route, /HTPR_4228_ADMIN_ONLY_TIME_REPORTS_FLAG/);
  assert.match(route, /isFeatureEnabled\(/);
  assert.match(route, /administeredProjectIds\(auth\.userId/);
  assert.match(route, /canViewOthers,/);
  assert.match(
    route,
    /filterUserIds: undefined/,
    "without other-user scope the user filter must be ignored, not left to empty the report"
  );

  const screen = read("src/app/time/TimeComp.tsx");

  assert.match(screen, /report\.data\?\.canViewOthers/);
  assert.match(
    screen,
    /\{canViewOthers && \(\s+<ScopeField label="User" containerOnly>/,
    "the User filter must render only when the server allows other users"
  );

  const flags = read("src/lib/flags.ts");

  assert.match(flags, /HTPR_4228_ADMIN_ONLY_TIME_REPORTS_FLAG/);
  assert.match(
    read("src/lib/flags/keys.ts"),
    /htpr-4228-admin-only-time-reports/
  );
});

test("archived task details keep a stop-only timer path", () => {
  const source = read("src/lib/timeTracking.ts");
  const access = read("src/app/api/time/_lib.ts");

  assert.match(
    source,
    /task\?\.project\.status === "Normal" \? \{\} : \{ endedAt: null \}/
  );
  assert.match(access, /status: \{ in: \["Normal", "Archive"\] \}/);
  assert.match(source, /status: \{ in: \["Normal", "Archive"\] \}/);
});
