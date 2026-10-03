const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { root } = require("./slack-app-fixtures.cjs");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

function addedEmDash(diff) {
  return diff.split("\n").some((line) => line.startsWith("+") && !line.startsWith("+++") && line.includes("\u2014"));
}

assert.equal(git("branch", "--show-current"), "htpr-6817");
const message = git("log", "-1", "--format=%B");
assert.match(message, /^HTPR-6817: .+/);
assert.ok(message.endsWith("Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"));
assert.equal(git("diff", "--name-only", "HEAD", "--", "src", "docs", "tests"), "");
const base = git("merge-base", "HEAD", "origin/production");
const files = git("diff", "--name-only", base, "HEAD").split("\n");
assert.ok(files.length > 0);
for (const file of files) {
  assert.match(file, /^(?:GATES\.md|src\/lib\/slack\/[^/]+\.ts|src\/lib\/flags(?:\/keys)?\.ts|src\/app\/api\/slack\/(?:events|commands)\/route\.ts|docs\/slack-app(?:-manifest\.json|\.md)|tests\/slack-app-[^/]+\.cjs)$/);
  assert.ok(fs.existsSync(path.join(root, file)));
}
assert.equal(addedEmDash("+const label = '\u2014';"), true, "positive control must detect a forbidden addition");
assert.equal(addedEmDash(git("diff", base, "HEAD", "--unified=0")), false);
console.log("SLACK APP REPOSITORY PASSED");
