const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const script = path.resolve(__dirname, "../scripts/ci-hold-report.mjs");

const job = (name, started, stepEnds, completed) => ({
  name,
  status: "completed",
  started_at: started,
  completed_at: completed,
  steps: stepEnds.map((end, index) => ({ name: `step ${index}`, started_at: started, completed_at: end })),
});

const HELD_RUN = [
  job("browser-smoke-mobile", "2026-11-01T07:54:24Z", ["2026-11-01T08:01:21Z"], "2026-11-01T09:01:23Z"),
  job("browser-smoke-desktop", "2026-11-01T07:54:24Z", ["2026-11-01T08:02:23Z"], "2026-11-01T09:02:27Z"),
  job("browser-smoke-matrix", "2026-11-01T07:54:24Z", ["2026-11-01T07:59:54Z"], "2026-11-01T07:59:57Z"),
  job("browser-smoke-flags", "2026-11-01T07:54:24Z", ["2026-11-01T08:02:03Z"], "2026-11-01T09:02:05Z"),
  job("browser-smoke", "2026-11-01T09:02:29Z", ["2026-11-01T08:02:30Z"], "2026-11-01T09:02:32Z"),
];

test("a wait reads in whole minutes and seconds", async () => {
  const { formatDuration } = await import(script);
  assert.equal(formatDuration(42), "0m42s");
  assert.equal(formatDuration(301), "5m01s");
  assert.equal(formatDuration(3604), "60m04s");
  assert.equal(formatDuration(4088), "68m08s");
});

test("a part held over ten minutes after its last step is named, longest first", async () => {
  const { partHolds } = await import(script);
  assert.deepEqual(partHolds(HELD_RUN, 600), [
    { name: "browser-smoke-desktop", seconds: 3604 },
    { name: "browser-smoke-mobile", seconds: 3602 },
    { name: "browser-smoke-flags", seconds: 3602 },
  ]);
});

test("a part held exactly ten minutes is not named", async () => {
  const { partHolds } = await import(script);
  const jobs = [job("browser-smoke-matrix", "2026-11-01T07:54:24Z", ["2026-11-01T07:59:54Z"], "2026-11-01T08:09:54Z")];
  assert.deepEqual(partHolds(jobs, 600), []);
});

test("a part that closed on time, a part with no steps, and a part whose steps run behind its own start name nothing", async () => {
  const { partHolds } = await import(script);
  const jobs = [
    job("browser-smoke-matrix", "2026-11-01T07:54:24Z", ["2026-11-01T07:59:54Z"], "2026-11-01T07:59:57Z"),
    job("browser-smoke-mobile", "2026-11-01T07:54:24Z", ["2026-11-01T08:01:21Z", null], "2026-11-01T09:01:23Z"),
    { name: "visual-compare", status: "completed", started_at: "2026-11-01T09:40:17Z", completed_at: "2026-11-01T09:40:17Z", steps: [] },
    job("test-shard (2)", "2026-11-01T09:31:13Z", ["2026-11-01T08:35:13Z"], "2026-11-01T09:35:14Z"),
  ];
  assert.deepEqual(partHolds(jobs, 600), []);
});

test("the check time runs from the first page part to the summary job", async () => {
  const { checkWindow, formatDuration } = await import(script);
  const window = checkWindow(HELD_RUN);
  assert.equal(window.start, Date.parse("2026-11-01T07:54:24Z"));
  assert.equal(window.end, Date.parse("2026-11-01T09:02:32Z"));
  assert.equal(formatDuration(window.seconds), "68m08s");
});

test("without a summary job the check ends at the last page part, and an older single job measures itself", async () => {
  const { checkWindow, formatDuration } = await import(script);
  const parts = [
    job("browser-smoke-mobile", "2026-11-01T10:00:00Z", ["2026-11-01T10:04:08Z"], "2026-11-01T10:04:10Z"),
    job("browser-smoke-matrix", "2026-11-01T10:00:05Z", ["2026-11-01T10:03:48Z"], "2026-11-01T10:03:50Z"),
  ];
  assert.equal(formatDuration(checkWindow(parts).seconds), "4m10s");
  const single = [job("browser-smoke", "2026-11-01T07:54:24Z", ["2026-11-01T08:00:00Z"], "2026-11-01T08:01:44Z")];
  assert.equal(formatDuration(checkWindow(single).seconds), "7m20s");
  assert.equal(checkWindow([{ name: "ci-tests", status: "completed", steps: [] }]), null);
});

test("a held part is named on its push's line with the length of the wait", async () => {
  const { pushLine } = await import(script);
  const line = pushLine({ id: 41286623269, status: "completed" }, HELD_RUN, { repo: "hypertask-ai/hypertask", holdSeconds: 600 });
  assert.equal(line, "68m08s — https://github.com/hypertask-ai/hypertask/actions/runs/41286623269 — held: browser-smoke-desktop 60m04s, browser-smoke-mobile 60m02s, browser-smoke-flags 60m02s");
});

test("a push whose parts all closed on time names no part", async () => {
  const { pushLine } = await import(script);
  const jobs = [
    job("browser-smoke-desktop", "2026-11-01T09:56:49Z", ["2026-11-01T10:01:43Z"], "2026-11-01T10:01:46Z"),
    job("browser-smoke", "2026-11-01T10:01:48Z", ["2026-11-01T10:01:50Z"], "2026-11-01T10:01:52Z"),
  ];
  const line = pushLine({ id: 41295281590, status: "completed" }, jobs, { repo: "hypertask-ai/hypertask", holdSeconds: 600 });
  assert.equal(line, "5m03s — https://github.com/hypertask-ai/hypertask/actions/runs/41295281590");
});

test("an unfinished push says it is in progress instead of naming a check time", async () => {
  const { pushLine } = await import(script);
  const running = [{ name: "browser-smoke-desktop", status: "in_progress", started_at: "2026-11-01T10:39:21Z", completed_at: null, steps: [{ name: "build", started_at: "2026-11-01T10:39:22Z", completed_at: null }] }];
  assert.equal(pushLine({ id: 41298435284, status: "in_progress" }, running, { repo: "hypertask-ai/hypertask", holdSeconds: 600 }), "in progress — https://github.com/hypertask-ai/hypertask/actions/runs/41298435284");
});

test("the report says how many pushes it listed and which parts waited", async () => {
  const { report } = await import(script);
  const rows = [
    { run: { id: 41286623269, status: "completed" }, jobs: HELD_RUN },
    { run: { id: 41295281590, status: "completed" }, jobs: [job("browser-smoke-desktop", "2026-11-01T09:56:49Z", ["2026-11-01T10:01:43Z"], "2026-11-01T10:01:46Z")] },
  ];
  const { lines, pushes, summary } = report(rows, { repo: "hypertask-ai/hypertask", holdSeconds: 600, holdMinutes: 10 });
  assert.equal(lines.length, 2);
  assert.equal(pushes, "2 pushes listed, newest first.");
  assert.equal(summary, "3 parts waited over 10m after their last step, on 1 of 2 pushes.");
});

test("the command defaults to ten pushes and ten minutes and rejects a broken flag", async () => {
  const { parseArgs } = await import(script);
  assert.deepEqual(parseArgs([]), {
    repo: "hypertask-ai/hypertask",
    workflow: "ci-tests.yml",
    branch: "production",
    limit: 10,
    holdMinutes: 10,
    help: false,
  });
  assert.equal(parseArgs(["--limit", "3"]).limit, 3);
  assert.equal(parseArgs(["--hold-minutes", "2"]).holdMinutes, 2);
  assert.equal(parseArgs(["--branch", "production", "--repo", "valentinyeo/postbox"]).repo, "valentinyeo/postbox");
  assert.throws(() => parseArgs(["--nope"]), /unknown argument --nope/);
  assert.throws(() => parseArgs(["--limit", "ten"]), /--limit needs a whole number/);
  assert.throws(() => parseArgs(["--limit"]), /--limit needs a value/);
});
