const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const routingSource = fs.readFileSync(
  path.join(root, "src/lib/pullRequests/githubPullRequests.ts"),
  "utf8",
);

test("board GitHub routing no longer hard-codes board 15 repositories", () => {
  assert.doesNotMatch(routingSource, /BOARD_15_GITHUB_REPOSITORIES/);
});
