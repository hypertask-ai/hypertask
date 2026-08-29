// HTPR-5515: "massive white space in the inbox".
//
// Every split renders its own wrapper and only the active one renders rows.
// The wrapper relied on the HTML `hidden` attribute to remove the inactive
// ones, but it also set `display: "flex"` inline. An inline declaration beats
// the UA stylesheet rule `[hidden] { display: none }`, so `hidden` did nothing:
// each inactive split stayed in the layout as an EMPTY `flex: 1` column.
// With N splits, N-1 empty flex children shared the inbox height and the real
// notification list was squeezed into a fraction of the page, leaving a large
// blank area.
//
// This pins the resolved inline display value. It fails if the wrapper ever
// goes back to an unconditional "flex".
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

// Mirrors inboxConfig.visibility in src/lib/configs/inbox.config.ts.
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
