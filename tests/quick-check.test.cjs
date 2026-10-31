const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const script = path.resolve(__dirname, "..", "scripts", "quick-check.mjs");

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function makeRepository(files) {
  const directory = mkdtempSync(path.join(tmpdir(), "quick-check-repo-"));
  git(directory, "init", "-q", "-b", "main");
  git(directory, "config", "user.email", "quick-check@example.test");
  git(directory, "config", "user.name", "quick check");
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
    writeFileSync(path.join(directory, name), body);
  }
  git(directory, "add", "-A");
  git(directory, "commit", "-qm", "base");
  git(directory, "update-ref", "refs/remotes/origin/production", git(directory, "rev-parse", "HEAD"));
  return directory;
}

function commit(directory, name, body) {
  mkdirSync(path.dirname(path.join(directory, name)), { recursive: true });
  writeFileSync(path.join(directory, name), body);
  git(directory, "add", "-A");
  git(directory, "commit", "-qm", `change ${name}`);
}

function makeStubs({ eslintExit = 0, tscExit = 0, tscKilled = false, tscSleeps = 0, rewrite = null } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "quick-check-bin-"));
  const log = path.join(directory, "calls.log");
  const rewriteLine = rewrite ? `printf 'written by eslint\\n' >> "${path.join(rewrite.repository, rewrite.file)}"\n` : "";
  writeFileSync(
    path.join(directory, "eslint"),
    `#!/bin/sh\nprintf 'eslint %s\\n' "$*" >> "${log}"\n${rewriteLine}exit ${eslintExit}\n`,
  );
  const tscBody = tscKilled ? "kill -9 $$\n" : tscSleeps ? `sleep ${tscSleeps}\nexit ${tscExit}\n` : `exit ${tscExit}\n`;
  writeFileSync(path.join(directory, "tsc"), `#!/bin/sh\nprintf 'tsc %s\\n' "$*" >> "${log}"\n${tscBody}`);
  chmodSync(path.join(directory, "eslint"), 0o755);
  chmodSync(path.join(directory, "tsc"), 0o755);
  return {
    directory,
    calls: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : []),
  };
}

function run(directory, stubs, { cwd = directory, args = [], env = {} } = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PATH: `${stubs.directory}:${process.env.PATH}`, ...env },
  });
}

const TWO_FILES = { "src/one.ts": "export const one = 1;\n", "src/two.ts": "export const two = 2;\n" };

test("a clean change lints the changed file and then checks types", () => {
  const repository = makeRepository(TWO_FILES);
  commit(repository, "src/one.ts", "export const one = 11;\n");
  const stubs = makeStubs();
  const result = run(repository, stubs);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  const calls = stubs.calls();
  assert.equal(calls.length, 2);
  assert.match(calls[0], /^eslint .*--fix.* src\/one\.ts$/);
  assert.doesNotMatch(calls[0], /src\/two\.ts/);
  assert.match(calls[1], /^tsc -p .*\.cache\/tsc\/quick-check\.json$/);
  assert.match(result.stdout, /quick check: format, lint and types passed in \d+\.\d+s/);
});

test("a lint error stops the push", () => {
  const repository = makeRepository(TWO_FILES);
  commit(repository, "src/one.ts", "export const one = 11;\n");
  const stubs = makeStubs({ eslintExit: 1 });
  const result = run(repository, stubs);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /lint failed; the push was stopped/);
});

test("a type error stops the push", () => {
  const repository = makeRepository(TWO_FILES);
  commit(repository, "src/one.ts", "export const one: string = 11;\n");
  const stubs = makeStubs({ tscExit: 2 });
  const result = run(repository, stubs);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /the type check failed; the push was stopped/);
});

test("formatting fixes stop the push until they are committed", () => {
  const repository = makeRepository(TWO_FILES);
  commit(repository, "src/one.ts", "export const one = 11;\n");
  const stubs = makeStubs({ rewrite: { repository, file: "src/one.ts" } });
  const result = run(repository, stubs);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /formatting fixes applied to src\/one\.ts; commit them and push again/);
  assert.equal(git(repository, "diff", "--name-only"), "src/one.ts");
});

test("a killed type check warns instead of blocking the push", () => {
  const repository = makeRepository(TWO_FILES);
  commit(repository, "src/one.ts", "export const one = 11;\n");
  const stubs = makeStubs({ tscKilled: true });
  const result = run(repository, stubs);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /tsc was killed, so this push skips the type gate/);
  assert.match(result.stdout, /skipped types/);
});

test("a type check over its budget is skipped instead of blocking", () => {
  const repository = makeRepository(TWO_FILES);
  commit(repository, "src/one.ts", "export const one = 11;\n");
  const stubs = makeStubs({ tscSleeps: 10 });
  const result = run(repository, stubs, { env: { QUICK_CHECK_TYPE_BUDGET_MS: "300" } });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /passed its 0\.3s budget/);
  assert.match(result.stdout, /skipped types/);
});

test("the skip variable passes the push without running any tool", () => {
  const repository = makeRepository(TWO_FILES);
  commit(repository, "src/one.ts", "export const one = 11;\n");
  const stubs = makeStubs({ eslintExit: 1 });
  const result = run(repository, stubs, { env: { HYPERTASK_SKIP_QUICK_CHECK: "1" } });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /quick check: skipped/);
  assert.deepEqual(stubs.calls(), []);
});

test("a lint configuration change runs the full lint without rewriting files", () => {
  const repository = makeRepository({ ...TWO_FILES, "package.json": '{ "name": "fixture" }\n' });
  commit(repository, "package.json", '{ "name": "fixture", "version": "1.0.0" }\n');
  const stubs = makeStubs();
  const result = run(repository, stubs);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /lint configuration changed, running the full lint/);
  assert.match(stubs.calls()[0], /^eslint --cache .* \.$/);
  assert.doesNotMatch(stubs.calls()[0], /--fix/);
});

test("explicit files skip the changed-file lookup", () => {
  const repository = makeRepository(TWO_FILES);
  commit(repository, "src/one.ts", "export const one = 11;\n");
  const stubs = makeStubs();
  const result = run(repository, stubs, { args: ["--files", "src/two.ts"] });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(stubs.calls()[0], / src\/two\.ts$/);
});

test("the check works from a subdirectory", () => {
  const repository = makeRepository(TWO_FILES);
  commit(repository, "src/one.ts", "export const one = 11;\n");
  const stubs = makeStubs();
  const result = run(repository, stubs, { cwd: path.join(repository, "src") });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(stubs.calls()[0], / src\/one\.ts$/);
});

test.after(() => console.log("quick-check tests passed"));
