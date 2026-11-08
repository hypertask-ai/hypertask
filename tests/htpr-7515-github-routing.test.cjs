const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const pullRequests = jiti(path.join(root, "src/lib/pullRequests/githubPullRequests.ts"));
const { resolveBoardGithubRepository } = jiti(path.join(root, "src/lib/github/boardConnections.ts"));

test("board GitHub routing no longer hard-codes board 15 repositories", () => {
  assert.equal(pullRequests.BOARD_15_GITHUB_REPOSITORIES, undefined);
  assert.equal(typeof resolveBoardGithubRepository, "function");
  assert.equal(typeof pullRequests.boardForGithubRepository, "function");
});
