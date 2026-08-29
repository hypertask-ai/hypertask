const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/summary-teaser.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { summaryTeaser } = jiti(path.join(root, "src/utils/summaryTeaser.ts"));

test("strips inline bold and trailing [N] marker", () => {
  assert.equal(
    summaryTeaser("**Abdul Wahhab** changed the status from DEV to PAUSED [4]"),
    "Abdul Wahhab changed the status from DEV to PAUSED"
  );
});

test("prefers first bullet and strips its marker", () => {
  assert.equal(
    summaryTeaser("## What this is\n- Adds *fast* login via `token`\n- More"),
    "Adds fast login via token"
  );
});

test("falls back to first non-header line", () => {
  assert.equal(summaryTeaser("## Header\nPlain line here"), "Plain line here");
});

test("empty input returns empty string", () => {
  assert.equal(summaryTeaser(""), "");
});
