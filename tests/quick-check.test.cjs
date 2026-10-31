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
  const lint = calls.find((call) => call.startsWith("eslint"));
  assert.match(lint, /^eslint .*--fix.* src\/one\.ts$/);
  assert.doesNotMatch(lint, /src\/two\.ts/);
  assert.match(calls.find((call) => call.startsWith("tsc")), /^tsc -p .*\.cache\/tsc\/quick-check\.json$/);
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
  assert.match(result.stdout, /tsc was killed, so this push skips it/);
  assert.match(result.stdout, /skipped types/);
});

test("a type check over its budget is skipped instead of blocking", () => {
  const repository = makeRepository(TWO_FILES);
  commit(repository, "src/one.ts", "export const one = 11;\n");
  const stubs = makeStubs({ tscSleeps: 10 });
  const started = Date.now();
  const result = run(repository, stubs, { env: { QUICK_CHECK_TYPE_BUDGET_MS: "300" } });
  const waited = Date.now() - started;

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /tsc passed its time budget/);
  assert.match(result.stdout, /skipped types/);
  assert.ok(waited < 5000, `the hook waited ${waited}ms on a 300ms budget`);
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
  const repository = makeRepository({ ...TWO_FILES, "eslint.config.mjs": "export default [];\n" });
  commit(repository, "eslint.config.mjs", "export default [{ rules: {} }];\n");
  const stubs = makeStubs();
  const result = run(repository, stubs);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /lint configuration changed, running the full lint/);
  const lint = stubs.calls().find((call) => call.startsWith("eslint"));
  assert.match(lint, /^eslint --cache .* \.$/);
  assert.doesNotMatch(lint, /--fix/);
});

test("a changed file inside eslint-local-rules runs the full lint", () => {
  const repository = makeRepository({ ...TWO_FILES, "eslint-local-rules/style.mjs": "export default [];\n" });
  commit(repository, "eslint-local-rules/style.mjs", "export default [{ rules: {} }];\n");
  const stubs = makeStubs();
  const result = run(repository, stubs);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /lint configuration changed, running the full lint/);
});

test("a dirty configuration file blocks the push", () => {
  const repository = makeRepository({ ...TWO_FILES, "tsconfig.json": '{ "compilerOptions": {} }\n' });
  commit(repository, "tsconfig.json", '{ "compilerOptions": { "strict": true } }\n');
  writeFileSync(path.join(repository, "tsconfig.json"), '{ "compilerOptions": { "strict": false } }\n');
  const stubs = makeStubs();
  const result = run(repository, stubs);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /uncommitted changes to tsconfig\.json/);
});

test("a push of another commit is not checked and not blocked", () => {
  const repository = makeRepository(TWO_FILES);
  commit(repository, "src/one.ts", "export const one = 11;\n");
  const other = git(repository, "rev-parse", "HEAD");
  writeFileSync(path.join(repository, "src/one.ts"), "export const one = 99;\n");
  git(repository, "add", "-A");
  git(repository, "commit", "-qm", "later work");
  const stubs = makeStubs({ eslintExit: 1 });
  const result = spawnSync(process.execPath, [script], {
    cwd: repository,
    encoding: "utf8",
    input: `refs/heads/feature ${other} refs/heads/feature ${"0".repeat(40)}\n`,
    env: { ...process.env, PATH: `${stubs.directory}:${process.env.PATH}` },
  });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /not the checked-out commit, so it is not checked/);
  assert.deepEqual(stubs.calls(), []);
});

test("a compiler configuration change runs the full type check", () => {
  const repository = makeRepository({ ...TWO_FILES, "tsconfig.json": '{ "compilerOptions": {} }\n' });
  commit(repository, "tsconfig.json", '{ "compilerOptions": { "strict": true } }\n');
  const stubs = makeStubs();
  const result = run(repository, stubs);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /the compiler configuration changed, running the full type check/);
  assert.match(stubs.calls().find((call) => call.startsWith("tsc")), /-p .*full\.json$/);
});

test("a dirty checked file blocks the push until it is committed", () => {
  const repository = makeRepository(TWO_FILES);
  commit(repository, "src/one.ts", "export const one = 11;\n");
  writeFileSync(path.join(repository, "src/one.ts"), "export const one = 12;\n");
  const stubs = makeStubs();
  const result = run(repository, stubs);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /uncommitted changes to src\/one\.ts; commit them/);
  assert.deepEqual(stubs.calls(), []);
});

test("explicit files skip the changed-file lookup", () => {
  const repository = makeRepository(TWO_FILES);
  commit(repository, "src/one.ts", "export const one = 11;\n");
  const stubs = makeStubs();
  const result = run(repository, stubs, { args: ["--files", "src/two.ts"] });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(stubs.calls().find((call) => call.startsWith("eslint")), / src\/two\.ts$/);
});

test("the check works from a subdirectory", () => {
  const repository = makeRepository(TWO_FILES);
  commit(repository, "src/one.ts", "export const one = 11;\n");
  const stubs = makeStubs();
  const result = run(repository, stubs, { cwd: path.join(repository, "src") });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(stubs.calls().find((call) => call.startsWith("eslint")), / src\/one\.ts$/);
});

test.after(() => console.log("quick-check tests passed"));
