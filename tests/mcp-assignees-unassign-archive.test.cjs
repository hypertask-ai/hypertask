const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "src/app/api/mcp/assignees/assign/route.ts"),
  "utf8",
);

test("MCP unassign allows Archive/Deleted tasks; assign stays Normal-only (HTPR-6428)", () => {
  assert.match(
    source,
    /allowNonNormalStatus:\s*assignIntent\s*===\s*"unassign"/,
  );
  assert.match(
    source,
    /allowNonNormalStatus\s*\?\s*\{\s*\}\s*:\s*\{\s*status:\s*ACTIVE_TASK_MUTATION_STATUS\s*\}/,
  );

  // Assign must still hit the Normal filter when allowNonNormalStatus is false.
  assert.doesNotMatch(
    source,
    /findTaskByIdentifier\([\s\S]*?allowNonNormalStatus:\s*true/,
  );
  assert.match(
    source,
    /Unassign must reach Archive\/Deleted tasks[\s\S]*allowNonNormalStatus\?: boolean/,
  );

  console.log("assign still requires Normal");
});
