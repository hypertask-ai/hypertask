const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const { resolveBoardGithubRepository } = jiti(
  path.join(root, "src/lib/github/boardConnections.ts"),
);

test("board GitHub routing no longer hard-codes board 15 repositories", () => {
  assert.doesNotMatch(
    read("src/lib/pullRequests/githubPullRequests.ts"),
    /BOARD_15_GITHUB_REPOSITORIES/,
  );
  assert.equal(typeof resolveBoardGithubRepository, "function");
});
