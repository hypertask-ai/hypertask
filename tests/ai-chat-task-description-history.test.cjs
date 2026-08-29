// HTPR-5113: AI chat must expose the same task-description history behavior
// as MCP without calling the app's own authenticated MCP endpoints. This repo
// has no database test harness, so these assertions guard the route wiring and
// authorization order at the source level.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROUTE = path.resolve(
  __dirname,
  "../src/app/api/ai/chat/stream/route.ts",
);

function toolBody(source, toolName) {
  const start = source.indexOf(`${toolName}: tool({`);
  assert.notEqual(start, -1, `${toolName} tool definition not found`);
  const nextToolStart = source.indexOf("\n    hypertask_", start + 1);
  return source.slice(start, nextToolStart === -1 ? undefined : nextToolStart);
}

test("hypertask_task_description_history is registered in AI chat", () => {
  const source = fs.readFileSync(ROUTE, "utf8");
  const body = toolBody(source, "hypertask_task_description_history");

  assert.match(body, /action: z\.enum\(\["versions", "restore"\]\)/);
  assert.match(body, /resolveTaskForTool\(user, \{/);
  assert.match(body, /sendStatus\("hypertask_task_description_history"\)/);
  assert.match(body, /prisma\.docVersion\.findMany\(/);
  assert.match(body, /upsertTaskDescription\(/);
  assert.doesNotMatch(body, /TaskService|\/mcp\/tasks\/description-/);
});

test("hypertask_task_description_history is registered as a write tool", () => {
  const source = fs.readFileSync(ROUTE, "utf8");
  const writeToolNamesStart = source.indexOf("const writeToolNames = new Set([");
  const writeToolNamesEnd = source.indexOf("]);", writeToolNamesStart);
  const writeToolNames = source.slice(writeToolNamesStart, writeToolNamesEnd);

  assert.match(
    writeToolNames,
    /"hypertask_task_description_history"/,
    "restore replaces the current description, so the tool must be treated as a write",
  );
});

test("task description restore checks project access before writing", () => {
  const source = fs.readFileSync(ROUTE, "utf8");
  const body = toolBody(source, "hypertask_task_description_history");
  const accessAt = body.indexOf(
    "validateProjectAccess(task.projectId, user.id)",
  );
  const snapshotAt = body.indexOf("prisma.docVersion.findFirst(");
  const writeAt = body.indexOf("upsertTaskDescription({");

  assert.notEqual(accessAt, -1, "the MCP route's project access check must run");
  assert.notEqual(snapshotAt, -1, "restore must load the task-scoped version");
  assert.notEqual(writeAt, -1, "restore must write through upsertTaskDescription");
  assert.ok(accessAt < snapshotAt, "access must be checked before loading a restore snapshot");
  assert.ok(accessAt < writeAt, "access must be checked before replacing the description");
});
