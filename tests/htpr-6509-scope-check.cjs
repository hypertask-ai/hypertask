const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const baseline = "dd6ed1827";
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trimEnd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const controllerFiles = [
  "src/utils/controllers/favorites/getAll.ts",
  "src/utils/controllers/users/getById.ts",
  "src/utils/controllers/pages/pageService.ts",
  "src/utils/controllers/projects/detail.ts",
];
const allowed = new Set([
  ...controllerFiles,
  "src/app/api/ai-chat/all-sessions/route.ts",
  "docs/htpr-6509-first-slice.md",
  "docs/htpr-6509-slices.md",
  "tests/htpr-6509-query-batching.test.cjs",
  "tests/htpr-6509-query-contracts.json",
  "tests/htpr-6509-scope-check.cjs",
  "GATES.md",
]);

function verifyPaths(files) {
  assert.ok(files.length < 40, "slice must remain reviewable");
  for (const file of files) assert.ok(allowed.has(file), `Out-of-scope change: ${file}`);
}
function verifyCopy(source) {
  assert.ok(!source.includes("\u2014"), "new text must not contain an em dash");
}

test("diff stays in this worktree and declared slice, with negative controls", () => {
  assert.throws(() => verifyPaths(["src/app/api/mcp/tasks/route.ts"]));
  assert.throws(() => verifyPaths(["src/lib/mcp-server/index.ts"]));
  assert.throws(() => verifyPaths(Array(40).fill("GATES.md")));
  assert.throws(() => verifyCopy("known\u2014bad"));
  assert.equal(fs.realpathSync(root), "/home/valentin/projects/ht-wt-6509b");
  assert.equal(git("branch", "--show-current"), "htpr-6509-s2");
  const tracked = git("diff", "--name-only", baseline).split("\n").filter(Boolean);
  const untracked = git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean);
  const files = [...new Set([...tracked, ...untracked])];
  verifyPaths(files);
  const added = git("diff", "--unified=0", baseline).split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++"));
  added.forEach(verifyCopy);
  untracked.forEach((file) => verifyCopy(read(file)));
  git("diff", "--check", baseline);
  console.log(`Scope verified: ${files.length} changed paths, no excluded changes or new em dash`);
});

test("controller changes are only relation-read opt-ins and session route adopts existing helpers", () => {
  for (const file of controllerFiles) {
    const original = git("show", `${baseline}:${file}`);
    const current = read(file).replace(/^\s*relationLoadStrategy: ["']join["'],\n/m, "").trimEnd();
    assert.equal(current, original, `${file} must not change selections, errors, side effects or authorization`);
  }
  const sessionRoute = read("src/app/api/ai-chat/all-sessions/route.ts");
  assert.match(sessionRoute, /loadCurrentUser\(request\.headers, true\)/);
  assert.match(sessionRoute, /return unauthorized\(\)/);
  assert.doesNotMatch(sessionRoute, /isValidUser|cookies\(/);
});

test("renamed notes retain slice 1 and state measured slice-2 work and remaining sections", () => {
  assert.equal(fs.existsSync(path.join(root, "docs/htpr-6509-first-slice.md")), false);
  const notes = read("docs/htpr-6509-slices.md");
  for (const heading of ["Slice 1:", "Slice 2:", "Remaining work after slice 2", "Already present at baseline", "Slice 2 verification and limits"]) assert.ok(notes.includes(heading), heading);
  for (let section = 1; section <= 7; section++) assert.ok(notes.includes(`Section ${section}:`));
  const contracts = JSON.parse(read("tests/htpr-6509-query-contracts.json"));
  const operations = { sessions: "/api/ai-chat/all-sessions", favorites: "getFavoritesForUser", user: "getUserById", page: "getPage", project: "/api/projects/detail" };
  for (const [name, operation] of Object.entries(operations)) {
    const line = notes.split("\n").find((candidate) => candidate.startsWith("| ") && candidate.includes(`\`${operation}\``) && candidate.includes("| Preserved contract") === false);
    assert.ok(line, operation);
    assert.ok(line.includes(`| ${contracts[name].queryCount} | 1 |`), `${operation} must carry its measured query counts`);
  }
  assert.ok(notes.includes("Large/unbounded JSON payloads are intentionally retained"));
  console.log("Slice documentation verified");
});

test("local implementation commit has the requested message and trailer with no unfinished source changes", { skip: process.env.HTPR_6509_CHECK_COMMIT !== "1" }, () => {
  const message = git("log", "-1", "--format=%B");
  assert.match(message, /^HTPR-6509: /);
  assert.ok(message.endsWith("Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"));
  assert.ok(git("diff", "--name-only", baseline, "HEAD").includes("src/app/api/ai-chat/all-sessions/route.ts"));
  const pending = git("status", "--porcelain").split("\n").filter(Boolean);
  assert.ok(pending.every((line) => line.slice(3) === "GATES.md"), "only the gate ledger may await its proof commit");
  console.log("Local implementation commit verified");
});
