const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const scriptUrl = pathToFileURL(path.resolve(__dirname, "../scripts/release-speed.mjs")).href;

const RUSHED = "1111111111111111111111111111111111111111";
const SLOW = "2222222222222222222222222222222222222222";

const RUNS = [
  {
    name: "CI Tests",
    head_sha: RUSHED,
    started: "2026-11-02T10:00:00Z",
    finished: "2026-11-02T10:06:30Z",
  },
  {
    name: "Prod Health Check + Auto-Rollback",
    head_sha: RUSHED,
    started: "2026-11-02T10:00:02Z",
    finished: "2026-11-02T10:07:00Z",
  },
  {
    name: "CI Tests",
    head_sha: SLOW,
    started: "2026-11-02T11:00:00Z",
    finished: "2026-11-02T11:08:30Z",
  },
  {
    name: "Prod Health Check + Auto-Rollback",
    head_sha: SLOW,
    started: "2026-11-02T11:00:00Z",
    finished: "2026-11-02T11:12:00Z",
  },
];

test("one row per production push, timed from the first run to the last finish", async () => {
  const { rowsFromRuns } = await import(scriptUrl);
  const rows = rowsFromRuns(RUNS);
  assert.equal(rows.length, 2);
  const rushed = rows.find((row) => row.sha === RUSHED);
  assert.equal(rushed.seconds, 420);
  const slow = rows.find((row) => row.sha === SLOW);
  assert.equal(slow.seconds, 720);
});

test("the tail names the check that finished last", async () => {
  const { rowsFromRuns } = await import(scriptUrl);
  const rows = rowsFromRuns(RUNS);
  assert.equal(rows.find((row) => row.sha === SLOW).tail, "Prod Health Check + Auto-Rollback");
  assert.equal(rows.find((row) => row.sha === RUSHED).tail, "Prod Health Check + Auto-Rollback");
});

test("rows arrive newest first and a push without a finish is skipped", async () => {
  const { rowsFromRuns } = await import(scriptUrl);
  const rows = rowsFromRuns([...RUNS, { name: "Gitleaks", head_sha: SLOW, started: "2026-11-02T11:00:01Z" }]);
  assert.deepEqual(
    rows.map((row) => row.sha),
    [SLOW, RUSHED],
  );
});

test("the summary counts the pushes inside the ten minute goal", async () => {
  const { rowsFromRuns, summarise } = await import(scriptUrl);
  const summary = summarise(rowsFromRuns(RUNS));
  assert.equal(summary.pushes, 2);
  assert.equal(summary.inside, 1);
  assert.equal(summary.slowest, 720);
  assert.equal(summary.median, 570);
});

test("a push exactly at the goal counts as inside", async () => {
  const { summarise } = await import(scriptUrl);
  const summary = summarise([{ seconds: 600 }, { seconds: 601 }]);
  assert.equal(summary.inside, 1);
});

test("the summary of no pushes says so instead of dividing by zero", async () => {
  const { summarise, formatSummary } = await import(scriptUrl);
  assert.equal(formatSummary(summarise([])), "0 of 0 production pushes finished inside ten minutes (0%), median 0s, slowest 0s");
});

test("the table carries minutes and seconds, not bare seconds", async () => {
  const { rowsFromRuns, formatTable } = await import(scriptUrl);
  const table = formatTable(rowsFromRuns(RUNS));
  assert.match(table, /7m 00s +Prod Health Check \+ Auto-Rollback/);
  assert.match(table, /12m 00s +Prod Health Check \+ Auto-Rollback/);
});
