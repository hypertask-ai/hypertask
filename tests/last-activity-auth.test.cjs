const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const read = (file) =>
  fs.readFileSync(path.resolve(__dirname, "..", file), "utf8");
// The Pages file is a thin adapter; the shared handler and its auth wrapper hold the logic.
const source = read("src/lib/api/project-writes/last-activity-read.ts");
const authWrapper = read("src/lib/api/task-writes/route.ts");

// WHY: the response says which boards an account can reach and when each last
// moved. nookies_user is readable and writable by the client, so deriving the
// id from it would hand any caller another account's board list.
test("the board-activity endpoint takes identity from the verified session", () => {
  assert.match(authWrapper, /getSessionUser\(request\.headers\)/);
  assert.match(source, /taskWriteRoute\(/);
  assert.match(source, /getProjectsLastActivity\(session\.userId\)/);
  assert.doesNotMatch(source, /nookies_user/);
});

test("an unauthenticated caller gets 401 before any query runs", () => {
  // taskWriteRoute answers 401 before it ever calls the operation.
  assert.doesNotMatch(source, /validateBeforeAuth/);
  const guardIndex = authWrapper.indexOf("401");
  const operationIndex = authWrapper.indexOf("options.operation(");
  assert.ok(guardIndex > -1 && operationIndex > guardIndex);
});
