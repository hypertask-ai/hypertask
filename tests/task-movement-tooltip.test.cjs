const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "src/components/PageComponents/TaskDetail/TaskMovement.tsx",
  ),
  "utf8",
);

test("task navigation tooltips stay clear of the left app rail", () => {
  const navigationTooltips = source.match(
    /<Tooltip\s+left=\{0\}\s+bottom=\{-53\}\s+text='Navigate to (?:previous|next) task'/g,
  );

  assert.equal(navigationTooltips?.length, 2);
  assert.doesNotMatch(source, /<Tooltip\s+left=\{-\d+\}[\s\S]*?Navigate to (?:previous|next) task/);
});
