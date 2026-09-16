const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const { CLIENTS, TRANSPORTS, loadCatalog } = require(
  path.join(root, "evals/mcp-client/lib/catalog.cjs"),
);
const { estimateUsage } = require(path.join(root, "evals/mcp-client/lib/tokens.cjs"));
const { gradeObservation, gradeMcp } = require(
  path.join(root, "evals/mcp-client/lib/grade.cjs"),
);
const { runEval } = require(path.join(root, "evals/mcp-client/lib/run.cjs"));

test("catalog has 20 unique Hypertask tasks with MCP and CLI plans", () => {
  const catalog = loadCatalog();
  assert.equal(catalog.tasks.length, 20);
  assert.equal(new Set(catalog.tasks.map((task) => task.id)).size, 20);
  assert.ok(catalog.tasks.some((task) => task.id === "find-overdue"));
  assert.ok(catalog.tasks.some((task) => task.id === "comment-ticket"));
  assert.ok(catalog.tasks.some((task) => task.id === "move-to-qa"));
});

test("replay grades the expected plan as a pass", () => {
  const catalog = loadCatalog();
  for (const task of catalog.tasks) {
    assert.equal(
      gradeObservation(task, "mcp", { tools: task.mcp.tools }).pass,
      true,
    );
    assert.equal(
      gradeObservation(task, "cli", { commands: task.cli.commands }).pass,
      true,
    );
  }
});

test("wrong MCP tool fails the task", () => {
  const catalog = loadCatalog();
  const task = catalog.tasks.find((item) => item.id === "move-to-qa");
  const grade = gradeMcp(task, [{ name: "hypertask_list_tasks", args: {} }]);
  assert.equal(grade.pass, false);
});

test("replay report covers every client and transport", () => {
  const report = runEval({ now: "2026-09-16T10:00:00.000Z", label: "pre-6478" });
  assert.equal(report.rows.length, 20 * CLIENTS.length * TRANSPORTS.length);
  assert.equal(report.summary.failed, 0);
  assert.equal(report.summary.successRate, 1);
  for (const client of CLIENTS) {
    for (const transport of TRANSPORTS) {
      const subset = report.rows.filter(
        (row) => row.client === client && row.transport === transport,
      );
      assert.equal(subset.length, 20);
      assert.ok(subset.every((row) => row.pass));
      assert.ok(subset.every((row) => row.tokensIn > 0));
      assert.ok(subset.every((row) => row.tokensOut > 0));
      assert.ok(subset.every((row) => row.wallMs > 0));
      assert.ok(subset.every((row) => row.toolCalls >= 1));
    }
  }
  const mcpWall = report.summary.byClient.claude.mcp.wallMs;
  const cliWall = report.summary.byClient.claude.cli.wallMs;
  assert.ok(mcpWall > cliWall);
});

test("MCP token estimate is higher than CLI for the same task", () => {
  const catalog = loadCatalog();
  const task = catalog.tasks[0];
  const mcp = estimateUsage(task, "claude", "mcp");
  const cli = estimateUsage(task, "claude", "cli");
  assert.ok(mcp.tokensIn > cli.tokensIn);
});
