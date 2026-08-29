const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/board-manifest.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { columnRole } = jiti(
  path.join(root, "src/lib/mcp/boards/columnRole.ts")
);

test("classifies board columns by semantic role", () => {
  const cases = [
    ["Triage", "intake"],
    ["Team Inbox", "intake"],
    ["Product Intake", "intake"],
    ["Backlog", "backlog"],
    ["Ready for development", "ready"],
    ["In Progress", "in-progress"],
    ["DOING", "in-progress"],
    ["WIP", "in-progress"],
    ["AI Review", "ai-review"],
    ["Valentin Review", "human-review"],
    ["Design Review", "human-review"],
    ["QA", "human-review"],
    ["Done", "done"],
    ["Complete", "done"],
    ["Shipped", "done"],
  ];

  for (const [title, expectedRole] of cases) {
    assert.equal(columnRole(title), expectedRole, title);
  }
});

test("normalizes separators and avoids partial keyword matches", () => {
  assert.equal(columnRole("IN-PROGRESS"), "in-progress");
  assert.equal(columnRole("Quarterly planning"), "other");
  assert.equal(columnRole("Incomplete ideas"), "other");
});

test("falls back to other for an unrecognized column", () => {
  assert.equal(columnRole("Icebox"), "other");
  assert.equal(columnRole(""), "other");
});
