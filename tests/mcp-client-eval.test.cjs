const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const { CLIENTS, loadCatalog } = require(
  path.join(root, "evals/mcp-client/lib/catalog.cjs"),
);
const { measuredUsage } = require(path.join(root, "evals/mcp-client/lib/tokens.cjs"));
const { gradeObservation, gradeMcpPlan } = require(
  path.join(root, "evals/mcp-client/lib/grade.cjs"),
);
const { clientAvailable, parseJsonBlobs, runClientAdapter, which } = require(
  path.join(root, "evals/mcp-client/lib/executors.cjs"),
);
const { observedToolCalls, runEval } = require(
  path.join(root, "evals/mcp-client/lib/run.cjs"),
);
const { mergePublishedReport } = require(
  path.join(root, "evals/mcp-client/lib/merge-report.cjs"),
);

const hasNativeCli = Boolean(process.env.EVAL_HYPERTASK_BIN || which("hypertask"));

test("catalog has 20 unique Hypertask tasks with MCP, CLI, and outcome assertions", () => {
  const catalog = loadCatalog();
  assert.equal(catalog.tasks.length, 20);
  assert.equal(new Set(catalog.tasks.map((task) => task.id)).size, 20);
  for (const task of catalog.tasks) {
    assert.ok(task.expect.stdoutIncludes.length > 0);
    assert.equal(JSON.stringify(task).includes("HTPR-6533"), false);
  }
});

test("copying the expected plan without outcomes fails grading", () => {
  const catalog = loadCatalog();
  for (const task of catalog.tasks) {
    assert.equal(gradeObservation(task, "mcp", { tools: task.mcp.tools }).pass, false);
    assert.equal(gradeObservation(task, "cli", { commands: task.cli.commands }).pass, false);
  }
});

test("wrong MCP tool, extra call, or wrong stdout fails", () => {
  const catalog = loadCatalog();
  const task = catalog.tasks.find((item) => item.id === "get-ticket");
  assert.equal(
    gradeMcpPlan(task, [{ name: "hypertask_list_tasks", args: {} }]).pass,
    false,
  );
  assert.equal(
    gradeMcpPlan(task, [...task.mcp.tools, { name: "hypertask_list_tasks", args: {} }]).pass,
    false,
  );
  const grade = gradeObservation(task, "cli", {
    commands: [{ argv: task.cli.commands[0].argv, stdout: "unrelated", status: 0 }],
  });
  assert.equal(grade.pass, false);
});

test(
  "fixture mode measures surfaces and does not fabricate client rows",
  { skip: hasNativeCli ? false : "native CLI unavailable" },
  async () => {
    const report = await runEval({
      now: "2026-09-17T06:00:00.000Z",
      label: "pre-6478",
      mode: "fixture",
    });
    assert.equal(report.rows.length, 0);
    assert.equal(report.summary.successRate, null);
    assert.equal(report.surfaces.length, 40);
    const failedSurfaces = report.surfaces.filter((row) => !row.pass);
    assert.equal(
      failedSurfaces.length,
      0,
      failedSurfaces.map((row) => `${row.taskId} ${row.transport}: ${row.reason}`).join("; "),
    );
    assert.ok(report.summary.byTransport.mcp.wallMs > 0);
    assert.ok(report.summary.byTransport.cli.wallMs > 0);
  },
);

test("weekly surface publication preserves live client measurements", () => {
  const liveRows = [{ taskId: "get-ticket", client: "claude", transport: "mcp" }];
  const liveByClient = { claude: { mcp: { tasks: 1, passed: 1 } } };
  const previous = {
    generatedAt: "2026-09-16T06:00:00.000Z",
    label: "live",
    mode: "live",
    rows: liveRows,
    surfaces: [{ taskId: "old", transport: "mcp" }],
    summary: {
      tasks: 1,
      passed: 1,
      failed: 0,
      successRate: 1,
      byClient: liveByClient,
      byTransport: { mcp: { tasks: 1, passed: 0 } },
      surfaceFailed: 1,
    },
  };
  const fixture = {
    generatedAt: "2026-09-17T06:00:00.000Z",
    label: "weekly",
    mode: "fixture",
    rows: [],
    surfaces: [{ taskId: "get-ticket", transport: "mcp", pass: true }],
    summary: {
      tasks: 0,
      passed: 0,
      failed: 0,
      successRate: null,
      byClient: {},
      byTransport: { mcp: { tasks: 1, passed: 1 } },
      surfaceFailed: 0,
    },
  };

  const merged = mergePublishedReport(previous, fixture);

  assert.deepEqual(merged.rows, liveRows);
  assert.deepEqual(merged.summary.byClient, liveByClient);
  assert.deepEqual(merged.surfaces, fixture.surfaces);
  assert.deepEqual(merged.summary.byTransport, fixture.summary.byTransport);
  assert.equal(merged.summary.surfaceFailed, 0);
  assert.equal(merged.generatedAt, previous.generatedAt);
  assert.equal(merged.label, previous.label);
  assert.deepEqual(previous.surfaces, [{ taskId: "old", transport: "mcp" }]);
});

test("weekly surface publication replaces a report without client rows", () => {
  const fixture = {
    rows: [],
    surfaces: [],
    summary: { byClient: {}, byTransport: { mcp: {}, cli: {} } },
  };
  assert.deepEqual(
    mergePublishedReport({ rows: [], summary: { byClient: {} } }, fixture),
    fixture,
  );
});

test("live mode omits unavailable clients instead of replaying a pass", async () => {
  const report = await runEval({
    now: "2026-09-17T06:00:00.000Z",
    label: "live-without-clients",
    mode: "live",
    env: { ...process.env, EVAL_LIVE_CLIENTS: "" },
  });
  assert.equal(report.rows.length, 0);
  assert.equal(report.summary.byTransport, undefined);
  assert.equal(clientAvailable("claude", { EVAL_LIVE_CLIENTS: "" }), false);
});

test("an attempted live client failure is a failed live row", () => {
  const catalog = loadCatalog();
  const task = catalog.tasks[0];
  const broken = path.join(os.tmpdir(), `broken-claude-${process.pid}`);
  fs.writeFileSync(broken, "#!/bin/sh\nexit 7\n");
  fs.chmodSync(broken, 0o755);
  const live = runClientAdapter("claude", task, "mcp", {
    env: { ...process.env, EVAL_LIVE_CLIENTS: "claude", CLAUDE_BIN: broken },
  });
  assert.equal(live.attempted, true);
  assert.ok(live.error);
  fs.rmSync(broken, { force: true });
});

test("native client JSONL keeps each event separate", () => {
  assert.deepEqual(
    parseJsonBlobs('{"type":"tool","name":"first"}\n{"type":"usage","input_tokens":12}\n'),
    [
      { type: "tool", name: "first" },
      { type: "usage", input_tokens: 12 },
    ],
  );
});

test("live metrics count observed calls and exclude verification time", () => {
  const catalog = loadCatalog();
  const clientBin = path.join(os.tmpdir(), `measured-claude-${process.pid}`);
  const hypertaskBin = path.join(os.tmpdir(), `slow-hypertask-${process.pid}`);
  fs.writeFileSync(
    clientBin,
    "#!/bin/sh\nprintf '%s\\n' '{\"tools\":[{\"name\":\"hypertask_get_task\",\"args\":{}}]}'\n",
  );
  fs.writeFileSync(hypertaskBin, "#!/bin/sh\nsleep 0.05\nprintf '%s\\n' '{}'\n");
  fs.chmodSync(clientBin, 0o755);
  fs.chmodSync(hypertaskBin, 0o755);
  try {
    const started = Date.now();
    const live = runClientAdapter("claude", catalog.tasks[0], "mcp", {
      env: {
        ...process.env,
        EVAL_LIVE_CLIENTS: "claude",
        CLAUDE_BIN: clientBin,
      },
      isolation: {
        projectId: 4242,
        ticket: "ISO-1",
        taskId: 88,
        userId: 7,
        userName: "Eval Agent",
      },
      hypertaskBin,
    });
    const totalMs = Date.now() - started;
    assert.equal(observedToolCalls(live.observation, "mcp"), 1);
    assert.ok(totalMs - live.wallMs >= 300, `${live.wallMs} should exclude ${totalMs} total ms`);
  } finally {
    fs.rmSync(clientBin, { force: true });
    fs.rmSync(hypertaskBin, { force: true });
  }
});

test("live writes fail closed without explicit isolation identifiers", async () => {
  const report = await runEval({
    now: "2026-09-17T06:00:00.000Z",
    label: "writes",
    mode: "live",
    env: {
      ...process.env,
      EVAL_LIVE_CLIENTS: "claude",
      EVAL_LIVE_WRITES: "1",
      CLAUDE_BIN: "/bin/true",
    },
  });
  const mutating = report.rows.filter((row) => row.mutating);
  assert.ok(mutating.length > 0);
  assert.ok(
    mutating.every((row) => row.pass === false && /EVAL_PROJECT_ID/.test(row.reason)),
  );
});

test("unavailable provider usage stays null", () => {
  const usage = measuredUsage({ tokensIn: 12, source: "unavailable" }, "unavailable");
  assert.equal(usage.tokensIn, null);
  assert.equal(usage.source, "unavailable");
});

test("live writes rewrite catalog targets onto EVAL_PROJECT_ID", () => {
  const { bindTask } = require(path.join(root, "evals/mcp-client/lib/isolation.cjs"));
  const catalog = loadCatalog();
  const bound = bindTask(catalog.tasks.find((task) => task.id === "create-task"), {
    projectId: 4242,
    ticket: "ISO-1",
    taskId: 88,
  });
  assert.equal(bound.mcp.tools[0].args.project_id, 4242);
  assert.ok(bound.cli.commands[0].argv.includes("4242"));
  assert.match(bound.prompt, /project 4242/);
});

test("a broken fixture CLI fails the surface check", async () => {
  const brokenBin = path.join(os.tmpdir(), `broken-hypertask-${process.pid}.cjs`);
  fs.writeFileSync(brokenBin, "#!/usr/bin/env node\nprocess.exit(2)\n");
  fs.chmodSync(brokenBin, 0o755);
  const { runCliSurface } = require(path.join(root, "evals/mcp-client/lib/executors.cjs"));
  const catalog = loadCatalog();
  const live = await runCliSurface(catalog.tasks[0], { hypertaskBin: brokenBin, env: process.env });
  assert.equal(live.executed, true);
  assert.ok(live.error);
  fs.rmSync(brokenBin, { force: true });
});

test("CLIENTS stay the three named product clients", () => {
  assert.deepEqual(CLIENTS, ["claude", "cursor", "codex"]);
});

test("live state grading requires explicit isolation and expands --self", () => {
  const { deltaState, expandSelfAssign, liveIsolationFromEnv } = require(
    path.join(root, "evals/mcp-client/lib/isolation.cjs"),
  );
  assert.equal(liveIsolationFromEnv({ EVAL_PROJECT_ID: "4242" }), null);
  assert.deepEqual(
    liveIsolationFromEnv({
      EVAL_PROJECT_ID: "4242",
      EVAL_TICKET: "ISO-1",
      EVAL_TASK_ID: "88",
      EVAL_USER_ID: "7",
      EVAL_USER_NAME: "Eval Agent",
    }),
    {
      projectId: 4242,
      ticket: "ISO-1",
      taskId: 88,
      userId: 7,
      userName: "Eval Agent",
    },
  );
  assert.deepEqual(
    deltaState(
      { commentCount: 4, createdCount: 2, timeLogCount: 3 },
      { commentCount: 5, createdCount: 3, timeLogCount: 4, title: "Eval fixture note" },
    ),
    {
      commentCount: 2,
      createdCount: 1,
      timeLogCount: 1,
      title: "Eval fixture note",
    },
  );
  assert.deepEqual(expandSelfAssign(["task", "assign", "EVAL-1", "--self"], 7), [
    "task",
    "assign",
    "EVAL-1",
    "--assignee",
    "7",
  ]);
});
