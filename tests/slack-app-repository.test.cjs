const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { root } = require("./slack-app-fixtures.cjs");

function repositoryScope(files = ["tests/feature-flags.test.cjs"]) {
  const git = (...args) => {
    if (args[0] === "branch") return "htpr-6817\n";
    if (args[0] === "log") return "HTPR-6817: fixture\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n";
    if (args[0] === "merge-base") return "fixture-base\n";
    if (args.includes("--name-only") && args.includes("fixture-base")) return files.join("\n") + "\n";
    return "";
  };
  const context = { require: (id) => id === "node:child_process" ? { execFileSync: (_command, args) => git(...args) } : id === "./slack-app-fixtures.cjs" ? { root } : require(id), console: { log() {} } };
  vm.runInNewContext(fs.readFileSync(path.join(root, "tests/slack-app-repository.cjs"), "utf8"), context);
}

test("repository check accepts the PR's changed feature-flag test", () => {
  assert.doesNotThrow(() => repositoryScope());
});

test("repository scope still rejects unrelated files and feature-flag lookalikes", () => {
  for (const file of ["README.md", "tests/feature-flags.test.cjs.backup", "src/lib/redis.ts"]) {
    assert.throws(() => repositoryScope([file]), /did not match the regular expression/);
  }
});
