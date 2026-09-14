const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const helperUrl = pathToFileURL(
  path.join(root, "src/lib/mcp/tasks/activeTaskMutation.ts"),
).href;
const routeSource = fs.readFileSync(
  path.join(root, "src/app/api/mcp/assignees/assign/route.ts"),
  "utf8",
);

test("assignee lookup status filter: unassign allows any status, assign stays Normal (HTPR-6428)", async () => {
  const {
    ACTIVE_TASK_MUTATION_STATUS,
    assigneeLookupStatusFilter,
  } = await import(helperUrl);

  assert.equal(assigneeLookupStatusFilter("assign"), ACTIVE_TASK_MUTATION_STATUS);
  assert.equal(assigneeLookupStatusFilter("assign"), "Normal");
  assert.equal(assigneeLookupStatusFilter("unassign"), undefined);

  // MCP assignees/assign only accepts assign|unassign (no toggle). Unassign
  // alone gets the non-Normal lookup; assign keeps the Normal filter.
  assert.match(
    routeSource,
    /assigneeLookupStatusFilter\(\s*allowNonNormalStatus\s*\?\s*"unassign"\s*:\s*"assign"\s*\)/,
  );
  assert.match(
    routeSource,
    /allowNonNormalStatus:\s*assignIntent\s*===\s*"unassign"/,
  );
  assert.match(
    routeSource,
    /assignIntent !== "assign" && assignIntent !== "unassign"/,
  );

  console.log("assign still requires Normal");
});
