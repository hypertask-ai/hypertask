const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const installer = path.join(root, "scripts", "install-git-hooks.mjs");
const hookSource = readFileSync(path.join(root, ".githooks", "pre-push"), "utf8");

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function makeRepository() {
  const directory = mkdtempSync(path.join(tmpdir(), "install-git-hooks-"));
  git(directory, "init", "-q", "-b", "main");
  git(directory, "config", "user.email", "install-git-hooks@example.test");
  git(directory, "config", "user.name", "install git hooks");
  mkdirSync(path.join(directory, ".githooks"), { recursive: true });
  writeFileSync(path.join(directory, ".githooks", "pre-push"), hookSource);
  writeFileSync(path.join(directory, "README.md"), "fixture\n");
  git(directory, "add", "-A");
  git(directory, "commit", "-qm", "base");
  return directory;
}

function install(cwd) {
  return spawnSync(process.execPath, [installer], { cwd, encoding: "utf8" });
}

test("the installer writes the repository hook into the hooks directory", () => {
  const repository = makeRepository();
  const result = install(repository);
  const target = path.join(repository, ".git", "hooks", "pre-push");

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /pre-push quick check installed/);
  assert.equal(readFileSync(target, "utf8"), hookSource);
  assert.equal(statSync(target).mode & 0o777, 0o755);
});

test("rerunning the installer keeps the same hook and succeeds", () => {
  const repository = makeRepository();
  install(repository);
  const target = path.join(repository, ".git", "hooks", "pre-push");
  const first = readFileSync(target, "utf8");
  const second = install(repository);

  assert.equal(second.status, 0, second.stderr);
  assert.equal(readFileSync(target, "utf8"), first);
});

test("an unrelated existing hook is never overwritten", () => {
  const repository = makeRepository();
  const target = path.join(repository, ".git", "hooks", "pre-push");
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, "#!/bin/sh\nexit 0\n");
  chmodSync(target, 0o755);
  const result = install(repository);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /already exists and is not this repository's hook/);
  assert.equal(readFileSync(target, "utf8"), "#!/bin/sh\nexit 0\n");
});

test("a linked worktree installs into the shared hooks directory", () => {
  const repository = makeRepository();
  const worktree = path.join(mkdtempSync(path.join(tmpdir(), "install-git-hooks-worktree-")), "tree");
  git(repository, "worktree", "add", "-q", "-b", "feature", worktree);
  const result = install(worktree);
  const target = path.join(repository, ".git", "hooks", "pre-push");

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(target), true);
  assert.equal(readFileSync(target, "utf8"), hookSource);
});

test("outside a git checkout the installer stays quiet and succeeds", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "install-git-hooks-plain-"));
  const result = install(directory);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /install-git-hooks: skipped/);
});

test.after(() => console.log("install-git-hooks tests passed"));
