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
const { clientAvailable, runClientAdapter, which } = require(
  path.join(root, "evals/mcp-client/lib/executors.cjs"),
);
const { runEval } = require(path.join(root, "evals/mcp-client/lib/run.cjs"));

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

test("live writes fail closed without an isolated project id", async () => {
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

test("live state grading uses per-row deltas and expands --self", () => {
  const { deltaState, expandSelfAssign } = require(
    path.join(root, "evals/mcp-client/lib/isolation.cjs"),
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
