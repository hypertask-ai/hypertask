const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");

const script = path.join(__dirname, "../.github/scripts/repro-first.mjs");

function git(repo, args) {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function initRepo() {
  const repo = mkdtempSync(path.join(tmpdir(), "repro-first-"));
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "fixture@example.com"]);
  git(repo, ["config", "user.name", "Fixture"]);
  return repo;
}

function commit(repo, files) {
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(repo, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "snapshot"]);
  return git(repo, ["rev-parse", "HEAD"]).trim();
}

const answerTest = (expected) => `const assert = require("node:assert/strict");
const test = require("node:test");
test("answer", () => {
  assert.equal(require("../src/lib.js"), ${expected});
});
`;

function run(repo, args, extraEnv = {}) {
  return spawnSync(process.execPath, [script, "--repo", repo, ...args], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_ACTIONS: "", GITHUB_STEP_SUMMARY: "", GITHUB_EVENT_PATH: "", ...extraEnv },
  });
}

test("a test that passes on the old code fails the check, and a real failure passes it", async (t) => {
  const repo = initRepo();
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const base = commit(repo, { "src/lib.js": "module.exports = 1;\n" });
  const same = commit(repo, {
    "src/lib.js": "module.exports = 1;\n\n",
    "tests/answer.test.cjs": answerTest(1),
  });
  const unchanged = run(repo, ["--title", "HTPR-1 [BUGFIX] Claim a fix", "--base", base, "--head", same]);
  assert.equal(unchanged.status, 1, unchanged.stdout);
  assert.match(unchanged.stdout, /repro-first fail no changed test fails on the old code/);

  const fixed = commit(repo, {
    "src/lib.js": "module.exports = 2;\n",
    "tests/answer.test.cjs": answerTest(2),
  });
  const proved = run(repo, ["--title", "HTPR-1 [BUGFIX] Answer becomes two", "--base", same, "--head", fixed]);
  assert.equal(proved.status, 0, proved.stderr + proved.stdout);
  assert.match(proved.stdout, /repro-first pass tests\/answer\.test\.cjs fails on the old code and passes on the pull request/);
});

test("a bugfix with no source change is exempt, and a source change with no test fails", async (t) => {
  const repo = initRepo();
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const base = commit(repo, { "src/lib.js": "module.exports = 1;\n", "tests/answer.test.cjs": answerTest(1) });
  const testsOnly = commit(repo, { "tests/answer.test.cjs": answerTest(1) + "\n" });
  const exempt = run(repo, ["--title", "HTPR-2 [BUGFIX] Docs in the test", "--base", base, "--head", testsOnly, "--scope"]);
  assert.equal(exempt.status, 0, exempt.stdout);
  assert.match(exempt.stdout, /repro-first exempt no source file changed/);

  const sourceOnly = commit(repo, { "src/lib.js": "module.exports = 3;\n" });
  const missing = run(repo, ["--title", "HTPR-2 [BUGFIX] Change the answer", "--base", testsOnly, "--head", sourceOnly, "--scope"]);
  assert.equal(missing.status, 1, missing.stdout);
  assert.match(missing.stdout, /repro-first fail no changed test fails on the old code/);

  const feature = run(repo, ["--title", "HTPR-2 [INFRA] Not a bug fix", "--base", testsOnly, "--head", sourceOnly]);
  assert.equal(feature.status, 0, feature.stdout);
  assert.match(feature.stdout, /repro-first skip not a bugfix pull request/);
});

test("recorded GitHub runner results: pull 3561 goes red and pull 3560 goes green", async () => {
  const { judgeReproFirst } = await import(script);
  const red = judgeReproFirst({
    title: "HTPR-9362 [BUGFIX] Hiding the open view removes it from the tab list",
    srcChanged: true,
    check: {
      status: "flag",
      details: [
        { file: "tests/delete-view-once.test.cjs", base: "pass", head: "pass" },
        { file: "tests/htpr-9362-hide-active-view.test.cjs", base: "error", head: "pass" },
      ],
    },
  });
  assert.equal(red.code, 1);
  assert.match(red.lines[0], /no changed test fails on the old code/);

  const green = judgeReproFirst({
    title: "HTPR-9375 [BUGFIX] Make comment dictation capture permanent",
    srcChanged: true,
    check: {
      status: "pass",
      details: [{ file: "tests/htpr-8138-comment-dictation.test.cjs", base: "fail", head: "pass" }],
    },
  });
  assert.equal(green.code, 0);
  assert.match(green.lines[0], /htpr-8138-comment-dictation\.test\.cjs/);

  const oneIsEnough = judgeReproFirst({
    title: "HTPR-9361 [BUGFIX] Leave finished tickets out of Blocked and show its rule",
    srcChanged: true,
    check: {
      status: "flag",
      details: [
        { file: "tests/board-background-refetch-render.test.cjs", base: "pass", head: "pass" },
        { file: "tests/htpr-9361-blocked-skips-done.test.cjs", base: "fail", head: "pass" },
      ],
    },
  });
  assert.equal(oneIsEnough.code, 0);

  const brokenHead = judgeReproFirst({
    title: "HTPR-1 [BUGFIX] Still broken",
    srcChanged: true,
    check: { details: [{ file: "tests/answer.test.cjs", base: "fail", head: "fail" }] },
  });
  assert.equal(brokenHead.code, 1);
  assert.match(brokenHead.lines[0], /does not pass on the pull request/);
});

test("a TypeError on the old code counts, and a missing module does not", async (t) => {
  const repo = initRepo();
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const base = commit(repo, { "src/lib.js": "module.exports = null;\n" });
  const thrown = commit(repo, {
    "src/lib.js": "module.exports = { id: 1 };\n",
    "tests/id.test.cjs": "const assert = require('node:assert/strict');\nconst test = require('node:test');\ntest('id', () => { assert.equal(require('../src/lib.js').id, 1); });\n",
  });
  const typeError = run(repo, ["--title", "HTPR-4 [BUGFIX] Read the id", "--base", base, "--head", thrown]);
  assert.equal(typeError.status, 0, typeError.stdout + typeError.stderr);
  assert.match(typeError.stdout, /repro-first pass tests\/id\.test\.cjs/);

  const added = commit(repo, {
    "src/added.js": "module.exports = 1;\n",
    "tests/added.test.cjs": "const assert = require('node:assert/strict');\nconst test = require('node:test');\ntest('added', () => { assert.equal(require('../src/added.js'), 1); });\n",
  });
  const missing = run(repo, ["--title", "HTPR-4 [BUGFIX] Add a module", "--base", thrown, "--head", added]);
  assert.equal(missing.status, 1, missing.stdout + missing.stderr);
  assert.match(missing.stdout, /no changed test fails on the old code/);
});

test("scope writes run=false when the pull request is exempt", async (t) => {
  const repo = initRepo();
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const base = commit(repo, { "src/lib.js": "module.exports = 1;\n" });
  const head = commit(repo, { "README.md": "note\n" });
  const output = path.join(repo, "github-output.txt");
  const result = run(repo, ["--title", "HTPR-3 [BUGFIX] Readme only", "--base", base, "--head", head, "--scope"], {
    GITHUB_OUTPUT: output,
  });
  assert.equal(result.status, 0, result.stdout);
  assert.match(readFileSync(output, "utf8"), /run=false/);
});
