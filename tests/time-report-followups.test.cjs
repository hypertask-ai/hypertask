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
    () => 0
  );

  await loaded.exports.listReport(6);

  assert.deepEqual(reportWhere.task.project.status, {
    in: ["Normal", "Archive"],
  });
  assert.deepEqual(reportWhere.task.project.OR, [{ ownerId: 6 }]);
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
