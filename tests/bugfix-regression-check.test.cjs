const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const test = require("node:test");

const script = path.join(__dirname, "../.github/scripts/bugfix-regression-check.mjs");

async function load() {
  return import(script);
}

function git(repo, args) {
  const result = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function initRepo() {
  const repo = mkdtempSync(path.join(tmpdir(), "bugfix-regression-fixture-"));
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "fixture@example.com"]);
  git(repo, ["config", "user.name", "Fixture"]);
  return repo;
}

function commit(repo, files, message) {
  for (const [name, contents] of Object.entries(files)) {
    const target = path.join(repo, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", message]);
  return git(repo, ["rev-parse", "HEAD"]).trim();
}

const answerTest = (expected) => `const assert = require("node:assert/strict");
const test = require("node:test");
test("answer", () => {
  assert.equal(require("../lib.js"), ${expected});
});
`;

function repoWithFix(expectedOnHead) {
  const repo = initRepo();
  const base = commit(repo, { "lib.js": "module.exports = 1;\n" }, "base");
  const head = commit(repo, {
    "lib.js": `module.exports = ${expectedOnHead};\n`,
    "tests/answer.test.cjs": answerTest(2),
  }, "fix");
  return { repo, base, head };
}

test("the title tag used by pr-title is the bugfix signal", async () => {
  const { isBugfixTitle, classifyPullRequest, decideRun } = await load();
  assert.equal(isBugfixTitle("HTPR-7686 [BUGFIX] Keep the draft"), true);
  assert.equal(isBugfixTitle("HYFA-4 [BUGFIX] Repair login"), true);
  assert.equal(isBugfixTitle("YPER4-651 [BUGFIX] No follower email"), true);
  for (const title of [
    "HTPR-1 [FEATURE] Add a board",
    "HTPR-1 [INFRA] Report bugfix tests",
    "HTPR-1 [BUGFIX]",
    "bugfix: repair the draft",
    "HTPR-1 [bugfix] Lower case tag",
  ]) {
    assert.equal(classifyPullRequest({ title, testFiles: [] }).status, "skip", title);
    assert.equal(decideRun({ title }).status, "skip", title);
  }
  const bugfix = "HTPR-1 [BUGFIX] Repair the draft";
  assert.equal(decideRun({ title: bugfix }).status, "run");
  assert.equal(classifyPullRequest({ title: bugfix, testFiles: [] }).status, "flag");
});

test("a bugfix with no changed test is flagged, and the escape hatch needs a real reason", async () => {
  const { classifyPullRequest, parseNameStatus, selectChangedTests } = await load();
  assert.equal(
    classifyPullRequest({ title: "HTPR-9 [BUGFIX] Repair", testFiles: [] }).lines[0],
    "bugfix-regression flag no test file added or changed",
  );
  const rows = parseNameStatus([
    "M", "src/components/Header.tsx",
    "A", "tests/nested/added.test.ts",
    "R100", "tests/old.test.cjs", "tests/renamed.test.cjs",
    "D", "tests/removed.test.cjs",
    "A", "tests/notes.test.js",
    "A", "tests/../../outside.test.cjs",
  ].join("\0") + "\0");
  assert.deepEqual(selectChangedTests(rows), ["tests/nested/added.test.ts", "tests/renamed.test.cjs"]);

  const placeholder = classifyPullRequest({
    title: "HTPR-9 [BUGFIX] Repair",
    labels: ["no-regression-test"],
    body: "- No new automated test applies because: `...`.",
    testFiles: [],
  });
  assert.equal(placeholder.status, "flag");

  const hidden = classifyPullRequest({
    title: "HTPR-9 [BUGFIX] Repair",
    labels: ["no-regression-test"],
    body: "<!-- no-regression-test: this reason is only in a comment -->",
    testFiles: [],
  });
  assert.equal(hidden.status, "flag");

  const rejoined = classifyPullRequest({
    title: "HTPR-9 [BUGFIX] Repair",
    labels: ["no-regression-test"],
    body: "<<!---->!--\nno-regression-test: this reason is only in a comment\n-->",
    testFiles: [],
  });
  assert.equal(rejoined.status, "flag");

  const exempt = classifyPullRequest({
    title: "HTPR-9 [BUGFIX] Repair",
    labels: [{ name: "no-regression-test" }],
    body: "- No new automated test applies because: `Native crash dump with no Node harness`.",
    testFiles: [],
  });
  assert.equal(exempt.status, "exempt");
  assert.match(exempt.lines[0], /Native crash dump/);

  const line = classifyPullRequest({
    title: "YPER4-9 [BUGFIX] Repair",
    labels: ["hold", "no-regression-test"],
    body: "no-regression-test: security fix for a live token leak",
    testFiles: ["tests/unused.test.cjs"],
  });
  assert.equal(line.status, "exempt");
  assert.equal(
    classifyPullRequest({
      title: "HTPR-9 [BUGFIX] Repair",
      body: "no-regression-test: security fix for a live token leak",
      testFiles: [],
    }).status,
    "flag",
  );
});

test("verdicts name the test file when it passes on the base or fails on the head", async () => {
  const { judgeResults } = await load();
  const pass = judgeResults([{ file: "tests/answer.test.cjs", base: "fail", head: "pass" }]);
  assert.equal(pass.status, "pass");
  assert.deepEqual(pass.lines, ["bugfix-regression pass tests/answer.test.cjs"]);

  const reproducesNothing = judgeResults([
    { file: "tests/answer.test.cjs", base: "pass", head: "pass" },
    { file: "tests/other.test.ts", base: "fail", head: "pass" },
  ]);
  assert.equal(reproducesNothing.status, "flag");
  assert.deepEqual(reproducesNothing.lines, [
    "bugfix-regression flag tests/answer.test.cjs passes on the merge base, so it does not reproduce the bug",
  ]);

  const broken = judgeResults([{ file: "tests/answer.test.cjs", base: "fail", head: "fail" }]);
  assert.equal(broken.lines[0], "bugfix-regression flag tests/answer.test.cjs fails on the pull request head");
});

test("a real test fails on the unfixed code and passes on the fix", async (t) => {
  const { runCheck } = await load();
  const { repo, base, head } = repoWithFix(2);
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const result = runCheck({
    repo,
    title: "HTPR-1 [BUGFIX] Answer becomes two",
    base,
    head,
  });
  assert.equal(result.status, "pass", JSON.stringify(result));
  assert.deepEqual(result.lines, ["bugfix-regression pass tests/answer.test.cjs"]);
  assert.equal(result.details[0].base, "fail");
  assert.equal(result.details[0].head, "pass");
  assert.match(result.details[0].baseLine, /not ok|!==|AssertionError/);
  const listed = git(repo, ["worktree", "list", "--porcelain"]);
  assert.equal(listed.split("\n").filter((line) => line.startsWith("worktree ")).length, 1);
});

test("a test that already passes on the merge base is flagged by name", async (t) => {
  const { runCheck } = await load();
  const repo = initRepo();
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const base = commit(repo, { "lib.js": "module.exports = 1;\n" }, "base");
  const head = commit(repo, {
    "lib.js": "module.exports = 1;\n",
    "tests/answer.test.cjs": answerTest(1),
  }, "test only");
  const result = runCheck({
    repo,
    title: "HTPR-2 [BUGFIX] Claim a fix without changing the answer",
    base,
    head,
  });
  assert.equal(result.status, "flag");
  assert.equal(
    result.lines[0],
    "bugfix-regression flag tests/answer.test.cjs passes on the merge base, so it does not reproduce the bug",
  );
});

test("a bugfix that does not change a test is flagged, and the command exits zero", async (t) => {
  const repo = initRepo();
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const base = commit(repo, { "lib.js": "module.exports = 1;\n" }, "base");
  const head = commit(repo, { "lib.js": "module.exports = 2;\n" }, "fix");
  const output = path.join(repo, "output.txt");
  const result = spawnSync(process.execPath, [
    script,
    "--repo", repo,
    "--title", "HTPR-3 [BUGFIX] Change the answer without a test",
    "--base", base,
    "--head", head,
  ], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_EVENT_PATH: "", GITHUB_OUTPUT: output, GITHUB_ACTIONS: "", GITHUB_STEP_SUMMARY: "" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^bugfix-regression flag no test file added or changed/m);
});

test("decide runs only for a bugfix that is not exempt, and a bad sha does not fail the process", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "bugfix-regression-decide-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, "github-output.txt");
  const feature = spawnSync(process.execPath, [script, "--decide"], {
    encoding: "utf8",
    env: {
      ...process.env,
      PR_TITLE: "HTPR-4 [FEATURE] Add a board",
      PR_BODY: "",
      PR_LABELS: "[]",
      GITHUB_OUTPUT: output,
      GITHUB_EVENT_PATH: "",
      GITHUB_ACTIONS: "",
      GITHUB_STEP_SUMMARY: "",
    },
  });
  assert.equal(feature.status, 0, feature.stderr);
  assert.match(feature.stdout, /bugfix-regression skip not a bugfix pull request/);
  assert.match(readFileSync(output, "utf8"), /run=false/);

  const bugfixOutput = path.join(dir, "bugfix-output.txt");
  const bugfix = spawnSync(process.execPath, [script, "--decide"], {
    encoding: "utf8",
    env: {
      ...process.env,
      PR_TITLE: "HTPR-5 [BUGFIX] Repair the draft",
      PR_BODY: "",
      PR_LABELS: "[]",
      GITHUB_OUTPUT: bugfixOutput,
      GITHUB_EVENT_PATH: "",
      GITHUB_ACTIONS: "",
      GITHUB_STEP_SUMMARY: "",
    },
  });
  assert.equal(bugfix.status, 0, bugfix.stderr);
  assert.equal(bugfix.stdout, "");
  assert.match(readFileSync(bugfixOutput, "utf8"), /run=true/);

  const exemptOutput = path.join(dir, "exempt-output.txt");
  const exempt = spawnSync(process.execPath, [script, "--decide"], {
    encoding: "utf8",
    env: {
      ...process.env,
      PR_TITLE: "HTPR-5 [BUGFIX] Repair the draft",
      PR_BODY: "no-regression-test: native crash dump with no Node harness",
      PR_LABELS: JSON.stringify(["no-regression-test"]),
      GITHUB_OUTPUT: exemptOutput,
      GITHUB_EVENT_PATH: "",
      GITHUB_ACTIONS: "",
      GITHUB_STEP_SUMMARY: "",
    },
  });
  assert.equal(exempt.status, 0, exempt.stderr);
  assert.match(exempt.stdout, /bugfix-regression exempt native crash dump/);
  assert.match(readFileSync(exemptOutput, "utf8"), /run=false/);

  const broken = spawnSync(process.execPath, [
    script, "--title", "HTPR-6 [BUGFIX] Repair", "--base", "nope", "--head", "nope", "--repo", dir,
  ], { encoding: "utf8", env: { ...process.env, GITHUB_EVENT_PATH: "", GITHUB_ACTIONS: "", GITHUB_STEP_SUMMARY: "" } });
  assert.equal(broken.status, 0, broken.stderr);
  assert.match(broken.stdout, /bugfix-regression error/);
});


test("the CLI never calls a missing base module a reproduced bug", (t) => {
  const repo = initRepo();
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const base = commit(repo, { "lib.js": "module.exports = 1;\n" }, "base");
  const head = commit(repo, {
    "new-module.js": "module.exports = 2;\n",
    "tests/added.test.cjs": 'const assert = require("node:assert/strict");\nconst answer = require("../new-module.js");\nrequire("node:test")("answer", () => assert.equal(answer, 2));\n',
  }, "new module");
  const result = spawnSync(process.execPath, [
    script, "--repo", repo, "--title", "HTPR-7 [BUGFIX] New helper",
    "--base", base, "--head", head,
  ], { encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "", GITHUB_OUTPUT: "", GITHUB_STEP_SUMMARY: "" } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /bugfix-regression flag tests\/added.test.cjs.*setup failed/);
  assert.doesNotMatch(result.stdout, /bugfix-regression pass/);
  assert.equal(git(repo, ["worktree", "list", "--porcelain"]).split("\n").filter((line) => line.startsWith("worktree ")).length, 1);
});


test("schema replay never changes the shared generated Prisma client", async (t) => {
  const { runCheck } = await load();
  const repo = initRepo();
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const base = commit(repo, {
    "lib.js": "module.exports = 1;\n",
    "src/prisma/schema.prisma": "old schema\n",
  }, "base");
  const head = commit(repo, {
    "lib.js": "module.exports = 2;\n",
    "src/prisma/schema.prisma": "new schema\n",
    "tests/answer.test.cjs": answerTest(2),
  }, "schema change");
  const generator = path.join(repo, "node_modules/prisma/build/index.js");
  mkdirSync(path.dirname(generator), { recursive: true });
  const sentinel = path.join(repo, "client-touched");
  writeFileSync(generator, `require("node:fs").writeFileSync(${JSON.stringify(sentinel)}, "changed");`);
  const result = runCheck({ repo, title: "HTPR-8 [BUGFIX] Schema change", base, head });
  assert.equal(result.status, "error");
  assert.match(result.lines[0], /Prisma schemas differ/);
  assert.equal(require("node:fs").existsSync(sentinel), false);
  assert.equal(git(repo, ["worktree", "list", "--porcelain"]).split("\n").filter((line) => line.startsWith("worktree ")).length, 1);
});

test("a production tip advance cannot enter the pre-fix replay", async (t) => {
  const { runCheck } = await load();
  const { repo, base, head } = repoWithFix(2);
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  git(repo, ["checkout", "-b", "production", base]);
  const advanced = commit(repo, { "tests/unrelated.test.cjs": 'throw new Error("not part of this fix");\n' }, "unrelated production change");
  const result = runCheck({ repo, title: "HTPR-10 [BUGFIX] Answer", base: advanced, head });
  assert.equal(result.base, base);
  assert.equal(result.status, "pass", JSON.stringify(result));
  assert.deepEqual(result.lines, ["bugfix-regression pass tests/answer.test.cjs"]);
});

test("dependency changes remain unproven instead of sharing the fixed dependency", async (t) => {
  const { runCheck } = await load();
  const repo = initRepo();
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const base = commit(repo, { "package.json": '{"version":"1.0.0"}\n', "lib.js": "module.exports = 1;\n" }, "base");
  const head = commit(repo, {
    "package.json": '{"version":"2.0.0"}\n',
    "lib.js": "module.exports = 2;\n",
    "tests/answer.test.cjs": answerTest(2),
  }, "dependencies");
  const result = runCheck({ repo, title: "HTPR-11 [BUGFIX] Dependency", base, head });
  assert.equal(result.status, "error");
  assert.match(result.lines[0], /Dependencies differ/);
});

test("file-read failures without assertion evidence cannot count as reproduction", async (t) => {
  const { runCheck } = await load();
  const repo = initRepo();
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const base = commit(repo, { "lib.js": 'module.exports = require("node:fs").readFileSync("missing-fixture");\n' }, "base");
  const head = commit(repo, { "lib.js": "module.exports = 2;\n", "tests/answer.test.cjs": answerTest(2) }, "fix");
  const result = runCheck({ repo, title: "HTPR-12 [BUGFIX] Fixture", base, head });
  assert.equal(result.status, "flag");
  assert.match(result.lines[0], /base setup failed/);
});

test("backtests use the historical merge parent even when head is in production", async (t) => {
  const { backtest } = await load();
  const { chmodSync } = require("node:fs");
  const { repo, base, head } = repoWithFix(2);
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const tree = git(repo, ["rev-parse", `${head}^{tree}`]).trim();
  const merge = git(repo, ["commit-tree", tree, "-p", base, "-p", head, "-m", "Merge PR"]).trim();
  git(repo, ["branch", "production", merge]);
  git(repo, ["update-ref", "refs/pull/1/head", head]);
  git(repo, ["remote", "add", "origin", repo]);
  const bin = path.join(repo, "bin");
  mkdirSync(bin);
  const title = "HTPR-13 [BUGFIX] Historical answer";
  const gh = path.join(bin, "gh");
  writeFileSync(gh, `#!${process.execPath}\nconst result = process.argv.includes("list") ? ${JSON.stringify([{ number: 1, title, mergedAt: "2026-10-27T00:00:00Z" }])} : ${JSON.stringify({ title, labels: [], body: "", mergeCommit: { oid: merge }, headRefOid: head })};\nconsole.log(JSON.stringify(result));\n`);
  chmodSync(gh, 0o755);
  const previous = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previous}`;
  try {
    const results = backtest({ repo, limit: 1 });
    assert.equal(results.length, 1);
    assert.equal(results[0].status, "pass", JSON.stringify(results));
  } finally {
    process.env.PATH = previous;
  }
});
