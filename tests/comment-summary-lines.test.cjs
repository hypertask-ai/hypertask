const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/comment-summary-lines.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { getCommentSummaryTargetLines } = jiti(
  path.join(root, "src/app/api/ai/_lib/commentSummaries.ts")
);

test("scales comment summary lines by word count and caps at six", () => {
  assert.equal(getCommentSummaryTargetLines(120), 1);
  assert.equal(getCommentSummaryTargetLines(239), 1);
  assert.equal(getCommentSummaryTargetLines(240), 2);
  assert.equal(getCommentSummaryTargetLines(720), 6);
  assert.equal(getCommentSummaryTargetLines(840), 6);
});
