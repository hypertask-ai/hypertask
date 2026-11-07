const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const assignRoute = fs.readFileSync(
  path.join(root, "src/lib/mcp/operations/assignees/assign/operation.ts"),
  "utf8",
);

test("MCP task.assign accepts board-visible agents the caller does not own (HTPR-8755)", () => {
  assert.match(assignRoute, /isAgentOnBoard\(task\.projectId, targetAgentId\)/);
  assert.match(
    assignRoute,
    /\.\.\.boardAgentVisibilityWhere\(ctx\.user\.id\)/,
  );
  assert.doesNotMatch(
    assignRoute,
    /where: \{ id: targetAgentId, userId: ctx\.user\.id \}/,
  );
  assert.doesNotMatch(assignRoute, /not owned by you/);
});
