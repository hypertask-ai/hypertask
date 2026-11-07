const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const jiti = require("jiti")(__filename);

const pullRequests = jiti(path.join(__dirname, "..", "src/lib/pullRequests/githubPullRequests.ts"));

test("board GitHub routing no longer hard-codes board 15 repositories", () => {
  assert.equal(pullRequests.BOARD_15_GITHUB_REPOSITORIES, undefined);
  assert.equal(typeof pullRequests.resolveBoardGithubRepository, "function");
});
