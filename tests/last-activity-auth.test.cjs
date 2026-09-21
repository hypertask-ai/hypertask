const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.resolve(__dirname, "../src/pages/api/projects/lastActivity.ts"),
  "utf8",
);

// WHY: the response says which boards an account can reach and when each last
// moved. nookies_user is readable and writable by the client, so deriving the
// id from it would hand any caller another account's board list.
test("the board-activity endpoint takes identity from the verified session", () => {
  assert.match(source, /getSessionUser/);
  assert.doesNotMatch(source, /nookies_user/);
});

test("an unauthenticated caller gets 401 before any query runs", () => {
  const guardIndex = source.indexOf("401");
  const queryIndex = source.indexOf("await getProjectsLastActivity(");
  assert.ok(guardIndex > -1 && queryIndex > guardIndex);
});
