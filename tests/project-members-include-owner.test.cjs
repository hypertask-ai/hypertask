const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("./helpers/chat-stream-source.cjs");
const path = require("node:path");

const LIST_MEMBERS_CALL_SITES = [
  path.resolve(__dirname, "../src/lib/mcp/operations/projects/[projectId]/members/operation.ts"),
  path.resolve(__dirname, "../src/app/api/ai/chat/stream/route.ts"),
];

test("list-members endpoints call getProjectMembers without excluding the caller", () => {
  for (const file of LIST_MEMBERS_CALL_SITES) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(
      source,
      /getProjectMembers\([^)]*,\s*(user\.id|ctx\.user\.id)\)/,
      `${file} must not pass the caller's id as excludeUserId to getProjectMembers`,
    );
  }
});
