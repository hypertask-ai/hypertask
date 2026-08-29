// Run: npx tsx src/components/RTE/mentionNavigation.check.ts
import assert from "node:assert";
import {
  firstSelectableMentionIndex,
  nextSelectableMentionIndex,
} from "./mentionNavigation";

const items = [
  { type: "peopleHeading" },
  { type: "name" },
  { type: "agentHeading" },
  { type: "taskHeading" },
  { type: "task" },
];

assert.strictEqual(firstSelectableMentionIndex(items), 1);
assert.strictEqual(
  nextSelectableMentionIndex(items, 1, 1),
  4,
  "ArrowDown skips adjacent headings",
);
assert.strictEqual(
  nextSelectableMentionIndex(items, 4, 1),
  1,
  "ArrowDown wraps to the first selectable row",
);
assert.strictEqual(
  nextSelectableMentionIndex(items, 4, -1),
  1,
  "ArrowUp skips adjacent headings",
);
assert.strictEqual(
  nextSelectableMentionIndex(items, 1, -1),
  4,
  "ArrowUp wraps to the last selectable row",
);
assert.strictEqual(
  nextSelectableMentionIndex([{ type: "error" }], 0, 1),
  -1,
  "a list without selectable rows stays unselected",
);
assert.strictEqual(nextSelectableMentionIndex([], 0, 1), -1);
assert.strictEqual(
  nextSelectableMentionIndex(items, -1, 1),
  1,
  "ArrowDown from an uninitialized selection starts at the first row",
);
assert.strictEqual(
  nextSelectableMentionIndex(items, -1, -1),
  4,
  "ArrowUp from an uninitialized selection starts at the last row",
);

console.log("mentionNavigation: all checks passed");
