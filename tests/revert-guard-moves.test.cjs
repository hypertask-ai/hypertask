const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const script = path.resolve(__dirname, "../.github/scripts/revert-guard.mjs");
const originalLines = [
  "export function calculate() {",
  "  const first = loadFirst();",
  "  const second = loadSecond();",
  "  return combine(first, second);",
  "}",
].join("\n") + "\n";

function makeRepo(t, source = originalLines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "revert-guard-move-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src/original.ts"), source);
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "recent behavior"], { cwd: dir });
  const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  execFileSync("git", ["update-ref", "refs/remotes/origin/production", base], { cwd: dir });
  return dir;
}

function commit(dir, message) {
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", message], { cwd: dir });
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
}

function makeTestRepo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "revert-guard-test-edit-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  fs.mkdirSync(path.join(dir, "tests"));
  fs.writeFileSync(
    path.join(dir, "tests/contract.test.cjs"),
    [
      'const first = read("src/app/first.ts");',
      'const second = read("src/app/second.ts");',
      'const third = read("src/app/third.ts");',
      "assert.match(first, /first/);",
      "assert.match(second, /second/);",
      "assert.match(third, /third/);",
    ].join("\n") + "\n",
  );
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-q", "-m", "recent test"], { cwd: dir });
  const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).trim();
  execFileSync("git", ["update-ref", "refs/remotes/origin/production", base], { cwd: dir });
  return dir;
}

function run(dir, head) {
  return spawnSync(process.execPath, [script], {
    cwd: dir,
    env: {
      ...process.env,
      GITHUB_BASE_REF: "production",
      PR_HEAD_SHA: head,
      PR_LABELS: "[]",
    },
    encoding: "utf8",
  });
}

test("allows recent lines extracted verbatim into a new file", (t) => {
  const dir = makeRepo(t);
  fs.writeFileSync(path.join(dir, "src/original.ts"), 'export { calculate } from "./calculate";\n');
  fs.writeFileSync(path.join(dir, "src/calculate.ts"), originalLines);
  const head = commit(dir, "extract implementation");

  const result = run(dir, head);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /not extracted to new files/);
});

test("still rejects recent lines that are actually deleted", (t) => {
  const dir = makeRepo(t);
  fs.writeFileSync(path.join(dir, "src/original.ts"), "export const replacement = true;\n");
  const head = commit(dir, "delete implementation");

  const result = run(dir, head);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Revert Guard failed/);
  assert.match(result.stderr, /src\/original\.ts/);
});

test("does not hide unmatched deletions in a mostly extracted file", (t) => {
  const lines = Array.from(
    { length: 20 },
    (_, index) => `export const value${index} = ${index};`,
  );
  const dir = makeRepo(t, `${lines.join("\n")}\n`);
  fs.writeFileSync(path.join(dir, "src/original.ts"), 'export * from "./extracted";\n');
  fs.writeFileSync(path.join(dir, "src/extracted.ts"), `${lines.slice(0, 14).join("\n")}\n`);
  const head = commit(dir, "partially extract implementation");

  const result = run(dir, head);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /src\/original\.ts/);
});

test("allows test wiring paths to follow an extraction", (t) => {
  const dir = makeTestRepo(t);
  const file = path.join(dir, "tests/contract.test.cjs");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replaceAll("src/app/", "src/lib/"));
  const head = commit(dir, "follow extracted modules");

  const result = run(dir, head);
  assert.equal(result.status, 0, result.stderr);
});

test("still rejects deleted test assertions", (t) => {
  const dir = makeTestRepo(t);
  fs.writeFileSync(path.join(dir, "tests/contract.test.cjs"), "const replacement = true;\n");
  const head = commit(dir, "delete assertions");

  const result = run(dir, head);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /tests\/contract\.test\.cjs/);
});
