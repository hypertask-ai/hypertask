const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const baseline = "fb9ef851b6bb3a5b8ef84d2425df5a6f7d19ac3b";
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trimEnd();
const allowed = new Set([
  "GATES.md", "docs/htpr-6509-slices.md",
  "src/app/api/agents/[agentId]/route.ts", "src/app/api/auth/verify-code/route.ts",
  "src/app/api/pages/[publicId]/route.ts", "src/app/api/pages/[publicId]/archive/route.ts",
  "src/app/api/pages/[publicId]/restore/route.ts", "src/app/api/pages/[publicId]/versions/route.ts",
  "src/lib/aiChat/taskTree.ts", "src/lib/demo/cleanupGuest.ts", "src/lib/timeTracking.ts",
  "src/utils/controllers/pages/pageService.ts", "src/utils/controllers/tasks/assertTaskAccess.ts",
  "tests/chat-task-tree.test.ts", "tests/htpr-6509-s3-contracts.test.cjs",
  "tests/htpr-6509-s3-sql.test.cjs", "tests/htpr-6509-s3-verify.cjs", "tests/htpr-6509-s3-baseline.json",
]);
function files() {
  return [...new Set([...git("diff", "--name-only", baseline).split("\n"), ...git("ls-files", "--others", "--exclude-standard").split("\n")].filter(Boolean))];
}
function verifyPaths(paths) {
  assert.ok(paths.length < 40, "slice must stay below forty paths");
  for (const file of paths) assert.ok(allowed.has(file), `Out-of-scope file: ${file}`);
}
function verifyCopy(text) {
  assert.ok(!text.includes("\u2014"), "no new em dash");
}
function scope() {
  assert.throws(() => verifyPaths(["src/app/api/mcp/tasks/route.ts"]));
  assert.throws(() => verifyPaths(["src/lib/mcp-server/index.ts"]));
  assert.throws(() => verifyPaths(["src/lib/appShellBootstrap/server.ts"]));
  assert.throws(() => verifyPaths(Array(40).fill("GATES.md")));
  assert.throws(() => verifyCopy("positive\u2014control"));
  assert.equal(fs.realpathSync(root), "/home/valentin/projects/ht-wt-6509c");
  assert.equal(git("branch", "--show-current"), "htpr-6509-s3");
  verifyPaths(files());
  git("diff", "--unified=0", baseline).split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).forEach(verifyCopy);
  git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean).forEach((file) => verifyCopy(fs.readFileSync(path.join(root, file), "utf8")));
  git("diff", "--check", baseline);
  console.log(`Slice 3 scope passed: ${files().length} paths`);
}
function lint() {
  const changed = files().filter((file) => /\.(ts|cjs)$/.test(file));
  assert.ok(changed.length > 0);
  const args = ["run", "lint", "--", "--ignore-pattern", "**/*", "--ignore-pattern", "!**/"];
  for (const file of changed) args.push("--ignore-pattern", `!${file.replace(/[\[\]]/g, "\\$&")}`);
  console.log(`Lint targets: ${changed.join(", ")}`);
  const result = spawnSync("npm", args, { cwd: root, stdio: "inherit", timeout: 120000 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, "scoped npm run lint must pass");
  console.log(`Slice 3 lint passed: ${changed.length} targets`);
}
function commit() {
  const message = git("log", "-1", "--format=%B");
  assert.match(message, /^HTPR-6509: /);
  assert.ok(message.endsWith("Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"));
  assert.ok(git("diff", "--name-only", baseline, "HEAD").includes("src/lib/aiChat/taskTree.ts"));
  const pending = git("status", "--porcelain").split("\n").filter(Boolean);
  assert.ok(pending.every((line) => line.slice(3) === "GATES.md"), "only the ledger may await its proof commit");
  assert.equal(git("branch", "--show-current"), "htpr-6509-s3");
  console.log("Slice 3 commit passed");
}
const command = process.argv[2];
assert.ok(["scope", "lint", "commit"].includes(command), "choose scope, lint or commit");
({ scope, lint, commit })[command]();
