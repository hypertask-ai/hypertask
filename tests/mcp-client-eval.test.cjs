const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const { CLIENTS, TRANSPORTS, loadCatalog } = require(
  path.join(root, "evals/mcp-client/lib/catalog.cjs"),
);
const { estimateUsage } = require(path.join(root, "evals/mcp-client/lib/tokens.cjs"));
const { gradeObservation, gradeMcpPlan } = require(
  path.join(root, "evals/mcp-client/lib/grade.cjs"),
);
const { clientAvailable } = require(path.join(root, "evals/mcp-client/lib/executors.cjs"));
const {
  isIndependentRecording,
  loadTranscripts,
} = require(path.join(root, "evals/mcp-client/lib/transcripts.cjs"));
const { runEval } = require(path.join(root, "evals/mcp-client/lib/run.cjs"));

test("catalog has 20 unique Hypertask tasks with MCP, CLI, and outcome assertions", () => {
  const catalog = loadCatalog();
  assert.equal(catalog.tasks.length, 20);
  assert.equal(new Set(catalog.tasks.map((task) => task.id)).size, 20);
  assert.ok(catalog.tasks.some((task) => task.id === "find-overdue"));
  assert.ok(catalog.tasks.some((task) => task.id === "comment-ticket"));
  assert.ok(catalog.tasks.some((task) => task.id === "move-to-qa"));
  for (const task of catalog.tasks) {
    assert.ok(task.expect.stdoutIncludes.length > 0);
    assert.equal(task.mcp.tools[0].args?.project_id === 15, false);
    assert.equal(JSON.stringify(task).includes("HTPR-6533"), false);
  }
});

test("copying the expected plan without outcomes fails grading", () => {
  const catalog = loadCatalog();
  for (const task of catalog.tasks) {
    assert.equal(
      gradeObservation(task, "mcp", { tools: task.mcp.tools }).pass,
      false,
    );
    assert.equal(
      gradeObservation(task, "cli", { commands: task.cli.commands }).pass,
      false,
    );
  }
});

test("wrong MCP tool or extra call fails the task", () => {
  const catalog = loadCatalog();
  const task = catalog.tasks.find((item) => item.id === "move-to-qa");
  assert.equal(
    gradeMcpPlan(task, [{ name: "hypertask_list_tasks", args: {} }]).pass,
    false,
  );
  assert.equal(
    gradeMcpPlan(task, [
      ...task.mcp.tools,
      { name: "hypertask_list_tasks", args: {} },
    ]).pass,
    false,
  );
});

test("wrong stdout fails even when the planned command ran", () => {
  const catalog = loadCatalog();
  const task = catalog.tasks.find((item) => item.id === "get-ticket");
  const grade = gradeObservation(task, "cli", {
    commands: [{ argv: task.cli.commands[0].argv, stdout: "unrelated", status: 0 }],
  });
  assert.equal(grade.pass, false);
  assert.match(grade.reason, /stdout missing/);
});

test("recorded transcripts are independent of the expected plan", () => {
  const catalog = loadCatalog();
  const transcripts = loadTranscripts();
  assert.ok(transcripts.recordings.length >= 20 * CLIENTS.length * TRANSPORTS.length);
  for (const task of catalog.tasks) {
    for (const client of CLIENTS) {
      for (const transport of TRANSPORTS) {
        const recording = transcripts.recordings.find(
          (item) =>
            item.taskId === task.id &&
            item.client === client &&
            item.transport === transport,
        );
        assert.ok(recording, `${task.id} ${client} ${transport}`);
        assert.equal(isIndependentRecording(task, recording, transport), true);
      }
    }
  }
});

test("fixture mode executes MCP and CLI surfaces once per task", async () => {
  const report = await runEval({
    now: "2026-09-17T06:00:00.000Z",
    label: "pre-6478",
    mode: "fixture",
  });
  assert.equal(report.rows.length, 20 * CLIENTS.length * TRANSPORTS.length);
  assert.equal(report.summary.failed, 0);
  assert.equal(report.summary.surfaceFailed, 0);
  assert.equal(report.surfaces.length, 20 * TRANSPORTS.length);
  assert.ok(report.surfaces.every((row) => row.pass));
  assert.ok(report.surfaces.every((row) => row.wallSource === "measured"));
  assert.ok(report.summary.byTransport.mcp.wallMs > 0);
  assert.ok(report.summary.byTransport.cli.wallMs > 0);
});

test("replay rows stay replay unless a named client adapter ran", async () => {
  const report = await runEval({
    now: "2026-09-17T06:00:00.000Z",
    label: "live-without-clients",
    mode: "live",
    env: { ...process.env, EVAL_LIVE_CLIENTS: "" },
  });
  assert.ok(report.rows.every((row) => row.mode === "replay"));
  assert.ok(report.rows.every((row) => row.executor === "transcript"));
  assert.equal(clientAvailable("claude", { EVAL_LIVE_CLIENTS: "" }), false);
});

test("live writes do not share one real project across fake client labels", () => {
  const catalog = loadCatalog();
  const mutating = catalog.tasks.filter((task) => task.mutating);
  assert.ok(mutating.length > 0);
  for (const task of mutating) {
    assert.equal(JSON.stringify(task).includes("\"project_id\":15"), false);
    assert.equal(JSON.stringify(task).includes("HTPR-6533"), false);
  }
});

test("token estimates exist but are not the displayed measured usage", async () => {
  const catalog = loadCatalog();
  const task = catalog.tasks[0];
  const estimate = estimateUsage(task, "claude", "mcp");
  assert.equal(estimate.source, "estimate");
  const report = await runEval({
    now: "2026-09-17T06:00:00.000Z",
    label: "usage",
    mode: "replay",
  });
  assert.ok(report.rows.every((row) => row.usageSource !== "estimate"));
  assert.ok(
    report.rows.every(
      (row) => row.tokensIn == null || row.usageSource === "provider" || row.usageSource === "transcript",
    ),
  );
});

test("a broken fixture CLI fails the surface check", async () => {
  const brokenBin = path.join(os.tmpdir(), `broken-hypertask-${process.pid}.cjs`);
  fs.writeFileSync(brokenBin, "#!/usr/bin/env node\nprocess.exit(2)\n");
  fs.chmodSync(brokenBin, 0o755);
  const { runCliSurface } = require(path.join(root, "evals/mcp-client/lib/executors.cjs"));
  const catalog = loadCatalog();
  const task = catalog.tasks[0];
  const live = runCliSurface(task, { hypertaskBin: brokenBin, env: process.env });
  assert.equal(live.executed, true);
  assert.ok(live.error);
  fs.rmSync(brokenBin, { force: true });
});
