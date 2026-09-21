const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const script = path.resolve(__dirname, "../scripts/check-source-size.mjs");

function makeRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "source-size-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  return dir;
}

function run(dir, args = [], env = {}) {
  const childEnv = { ...process.env, ...env };
  delete childEnv.GITHUB_BASE_REF;
  return spawnSync(process.execPath, [script, ...args], {
    cwd: dir,
    env: childEnv,
    encoding: "utf8",
  });
}

test("counts a newline-terminated source file without an extra line", (t) => {
  const dir = makeRepo(t);
  fs.writeFileSync(path.join(dir, "limit.ts"), "line\n".repeat(1500));
  assert.equal(run(dir, ["limit.ts"]).status, 0);

  fs.writeFileSync(path.join(dir, "limit.ts"), "line\n".repeat(1501));
  const result = run(dir, ["limit.ts"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /limit\.ts: 1501 lines/);
});

test("checks staged source-file additions", (t) => {
  const dir = makeRepo(t);
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  execFileSync("git", ["add", "README.md"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "base"], { cwd: dir });

  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src/large.ts"), "line\n".repeat(1501));
  execFileSync("git", ["add", "src/large.ts"], { cwd: dir });

  const result = run(dir, [], { SOURCE_SIZE_BASE_REF: "HEAD" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /src\/large\.ts: 1501 lines/);
});

test("fails when no comparison base can be resolved", (t) => {
  const dir = makeRepo(t);
  fs.writeFileSync(path.join(dir, "README.md"), "base\n");
  execFileSync("git", ["add", "README.md"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "base"], { cwd: dir });

  const result = run(dir, [], { SOURCE_SIZE_BASE_REF: "missing-base" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Could not resolve a source-size base ref/);
});
