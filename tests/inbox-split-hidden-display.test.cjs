const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const SPLIT_SOURCE = path.join(
  __dirname,
  "..",
  "src",
  "components",
  "notifications",
  "inboxSplit",
  "index.tsx",
);
const CONFIG_SOURCE = path.join(
  __dirname,
  "..",
  "src",
  "lib",
  "configs",
  "inbox.config.ts",
);

const hidden = (value, index) => value !== index;
const display = (value, index) => (value !== index ? "none" : "flex");

test("the active split is laid out as a flex column", () => {
  assert.strictEqual(display(2, 2), "flex");
  assert.strictEqual(hidden(2, 2), false);
});

test("an inactive split resolves to display:none, not flex", () => {
  for (const index of [0, 1, 3, 4]) {
    assert.strictEqual(display(2, index), "none");
    assert.strictEqual(hidden(2, index), true);
  }
});

test("only one split of many contributes layout height", () => {
  const splits = [0, 1, 2, 3, 4, 5];
  const laidOut = splits.filter((index) => display(3, index) !== "none");
  assert.deepStrictEqual(laidOut, [3]);
});

test("the two visibility predicates never disagree", () => {
  for (let value = 0; value < 5; value++) {
    for (let index = 0; index < 5; index++) {
      assert.strictEqual(hidden(value, index), display(value, index) === "none");
    }
  }
});

test("the split wrapper does not hardcode an inline display", () => {
  const source = fs.readFileSync(SPLIT_SOURCE, "utf8");
  assert.ok(
    !/display:\s*"flex"/.test(source),
    'inboxSplit must not set display: "flex" inline; an inline display defeats the hidden attribute',
  );
  assert.ok(
    source.includes("inboxConfig.visibility.display(value, index)"),
    "inboxSplit must resolve display through inboxConfig.visibility.display",
  );
});

test("inbox.config exposes the display predicate", () => {
  const source = fs.readFileSync(CONFIG_SOURCE, "utf8");
  assert.ok(
    /display:\s*\(value: number, index: number\)/.test(source),
    "inboxConfig.visibility.display must exist",
  );
});
