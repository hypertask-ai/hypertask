const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../src/lib/demo/provisionGuest.ts"),
  "utf8",
);

test("skeleton guest tasks are all assigned and exactly the first is overdue", () => {
  assert.match(
    source,
    /boardKind === "skeleton" && taskCount === 0[\s\S]*?dueDateFromDays\(-1, dueDateBase\)/,
  );
  assert.match(
    source,
    /boardKind === "skeleton" \|\|[\s\S]*?prisma\.assignees\.create\(\{[\s\S]*?userId: owner\.userId/,
  );
});

test("generated guest tasks use a deterministic alternating assignment", () => {
  assert.match(
    source,
    /boardKind === "generated" && taskIndex % 2 === 0/,
  );
  assert.match(source, /purpose \? "generated" : "skeleton"/);
  assert.match(source, /provisionGeneratedBoard\(LEARN_BOARD, owner, \{ boardKind: "learn" \}\)/);
});
