// HTPR-3805: getProjectMembers(projectId, excludeUserId) drops excludeUserId
// from the returned list. Both "list members" call sites passed their own
// caller's id as excludeUserId, so the board OWNER — the caller, on boards
// with zero Member rows — vanished from their own members list ("No members
// found" on board 2198). A "list members" endpoint must never exclude the
// caller; that's only for a genuinely different exclusion use case (none
// exists in this repo today — processMentions.ts calls it with no
// excludeUserId at all).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const LIST_MEMBERS_CALL_SITES = [
  path.resolve(__dirname, "../src/app/api/mcp/projects/[projectId]/members/route.ts"),
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
