const test = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
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
  for (const [name, body] of Object.entries({ "tsconfig.json": '{ "compilerOptions": {} }\n', ...files })) {
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

function makeStubs({
  eslintExit = 0,
  tscExit = 0,
  tscKilled = false,
  tscSleeps = 0,
  tscSlowRuns = 0,
  rewrite = null,
} = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), "quick-check-bin-"));
  const log = path.join(directory, "calls.log");
  const counter = path.join(directory, "tsc-runs");
  const rewriteLine = rewrite ? `printf 'written by eslint\\n' >> "${path.join(rewrite.repository, rewrite.file)}"\n` : "";
  writeFileSync(
    path.join(directory, "eslint"),
    `#!/bin/sh\nprintf 'eslint %s\\n' "$*" >> "${log}"\n${rewriteLine}exit ${eslintExit}\n`,
  );
  const runs = `runs=$(cat "${counter}" 2>/dev/null || echo 0)\nruns=$((runs + 1))\necho "$runs" > "${counter}"\n`;
  const tscBody = tscKilled
    ? "kill -9 $$\n"
    : tscSleeps
      ? `${tscSlowRuns ? `if [ "$runs" -le ${tscSlowRuns} ]; then sleep ${tscSleeps}; fi\n` : `sleep ${tscSleeps}\n`}exit ${tscExit}\n`
      : `exit ${tscExit}\n`;
  writeFileSync(path.join(directory, "tsc"), `#!/bin/sh\nprintf 'tsc %s\\n' "$*" >> "${log}"\n${runs}${tscBody}`);
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
    timeout: 600_000,
    env: {
      ...process.env,
      PATH: `${stubs.directory}:${process.env.PATH}`,
      QUICK_CHECK_BIN_DIR: stubs.directory,
      ...env,
    },
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

test("partial type checks retain project declarations and module augmentations", () => {
  const repository = makeRepository({
    "tsconfig.json": '{ "compilerOptions": { "strict": true, "noEmit": true } }\n',
    "src/library.d.ts": 'declare module "library" { export interface Commands {} }\n',
    "src/extension.ts": 'import "library";\ndeclare module "library" { interface Commands { create(): string } }\n',
    "src/one.ts": 'import type { Commands } from "library"; export const run = (commands: Commands) => commands.create();\n',
  });
  commit(repository, "src/one.ts", 'import type { Commands } from "library"; export const run = (commands: Commands): string => commands.create();\n');
  const stubs = makeStubs();
  writeFileSync(path.join(stubs.directory, "tsc"), `#!/bin/sh\nexec "${process.execPath}" "${require.resolve("typescript/lib/tsc.js")}" "$@"\n`);
  const result = run(repository, stubs);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  const config = JSON.parse(readFileSync(path.join(repository, ".cache/tsc/quick-check.json"), "utf8"));
  assert.deepEqual(config.include.sort(), ["../../src/extension.ts", "../../src/library.d.ts", "../../src/one.ts"]);
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
  const stubs = makeStubs();
  const compiler = path.resolve(__dirname, "../node_modules/.bin/tsc");
  writeFileSync(path.join(stubs.directory, "tsc"), `#!/bin/sh\nexec "${compiler}" "$@"\n`);
  const result = run(repository, stubs);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /TS2322/);
  assert.match(result.stderr, /the type check failed; the push was stopped/);
});

for (const broken of [false, true]) {
  test(`project declarations prevent false TS7016 without hiding real errors: broken=${broken}`, () => {
    const repository = makeRepository({
      "src/one.ts": "export const one = 1;\n",
      "node_modules/untyped-package/index.js": "exports.value = 1;\n",
      "types/package.d.ts": 'declare module "untyped-package" { export const value: number; }\n',
      "config/base.json": JSON.stringify({
        compilerOptions: { strict: true, skipLibCheck: true, types: [], module: "esnext", moduleResolution: "bundler" },
        include: ["../src/**/*.ts", "../types/**/*.d.ts"],
        exclude: ["../types/excluded.d.ts"],
      }),
      "types/excluded.d.ts": "declare const missing: DoesNotExist;\n",
      "tsconfig.json": '{\n  "extends": "./config/base.json",\n}\n',
    });
    commit(repository, "src/one.ts", `import { value } from "untyped-package";\nexport const one${broken ? ": string" : ""} = value;\n`);
    const stubs = makeStubs();
    const compiler = path.resolve(__dirname, "../node_modules/.bin/tsc");
    writeFileSync(path.join(stubs.directory, "tsc"), `#!/bin/sh\nexec "${compiler}" "$@"\n`);
    const full = spawnSync(process.execPath, [compiler, "--noEmit", "-p", path.join(repository, "tsconfig.json")], { encoding: "utf8", timeout: 600_000 });
    assert.equal(full.status === 0, !broken, full.stdout + full.stderr);
    if (broken) assert.match(full.stdout, /TS2322/);

    const result = run(repository, stubs);

    assert.equal(result.status, broken ? 1 : 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /TS7016/);
    if (broken) {
      assert.match(result.stdout, /TS2322/);
      assert.match(result.stderr, /the type check failed; the push was stopped/);
    } else {
      assert.doesNotMatch(result.stdout, /confirming partial type errors/);
    }
  });
}

for (const extension of [".d.ts", ".ts"]) {
  for (const broken of [false, true]) {
    test(`partial checks use project globals from ${extension}: broken=${broken}`, () => {
      const repository = makeRepository({
        "src/one.ts": "export const one = 1;\n",
        [`src/globals${extension}`]: "declare const existing: number;\n",
        "tsconfig.json": JSON.stringify({ compilerOptions: { skipLibCheck: true, types: [] }, include: ["src/**/*.ts"] }),
      });
      commit(repository, "src/one.ts", `export const one${broken ? ": string" : ""} = existing;\n`);
      const stubs = makeStubs();
      const compiler = path.resolve(__dirname, "../node_modules/.bin/tsc");
      writeFileSync(path.join(stubs.directory, "tsc"), `#!/bin/sh\nexec "${compiler}" "$@"\n`);
      const result = run(repository, stubs);

      assert.equal(result.status, broken ? 1 : 0, result.stdout + result.stderr);
      if (broken) assert.match(result.stdout, /TS2322/);
      if (extension === ".ts") assert.match(result.stdout, /confirming partial type errors with the full project/);
    });
  }
}

test("formatting fixes stop the push until they are committed", () => {
  const repository = makeRepository(TWO_FILES);
  commit(repository, "src/one.ts", "export const one = 11;\n");
  const stubs = makeStubs({ rewrite: { repository, file: "src/one.ts" } });
  const result = run(repository, stubs);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /formatting fixes applied to src\/one\.ts; commit them and push again/);
  assert.equal(git(repository, "diff", "--name-only"), "src/one.ts");
});

test("a machine-killed type check prints a loud line and goes through", () => {
  const repository = makeRepository(TWO_FILES);
  commit(repository, "src/one.ts", "export const one = 11;\n");
  const stubs = makeStubs({ tscKilled: true });
  const result = run(repository, stubs);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /quick check: NOT TYPE CHECKED: src\/one\.ts/);
  assert.match(result.stdout, /skipped types/);
  assert.equal(stubs.calls().filter((call) => call.startsWith("tsc")).length, 1);
});

test("a type check over its budget reruns once with the longer budget and passes", () => {
  const repository = makeRepository(TWO_FILES);
  commit(repository, "src/one.ts", "export const one = 11;\n");
  const stubs = makeStubs({ tscSleeps: 5, tscSlowRuns: 1 });
  const result = run(repository, stubs, {
    env: { QUICK_CHECK_TYPE_BUDGET_MS: "300", QUICK_CHECK_FULL_TYPE_BUDGET_MS: "20000" },
  });

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /tsc passed its 0s budget; running it once more with 20s/);
  assert.match(result.stdout, /format, lint and types passed/);
  assert.equal(stubs.calls().filter((call) => call.startsWith("tsc")).length, 2);
});

test("a type check that stays over budget stops the push with the rerun command", () => {
  const repository = makeRepository(TWO_FILES);
  commit(repository, "src/one.ts", "export const one = 11;\n");
  const stubs = makeStubs({ tscSleeps: 30 });
  const result = run(repository, stubs, {
    env: { QUICK_CHECK_TYPE_BUDGET_MS: "300", QUICK_CHECK_FULL_TYPE_BUDGET_MS: "500" },
  });

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(
    result.stderr,
    /quick check: tsc did not finish for src\/one\.ts; push blocked\. Run: node scripts\/quick-check\.mjs --files src\/one\.ts/,
  );
  assert.doesNotMatch(result.stdout, /NOT TYPE CHECKED/);
  assert.equal(stubs.calls().filter((call) => call.startsWith("tsc")).length, 2);
});

test("the rerun command quotes a path with a space", () => {
  const spaced = "src/tutorial space/one.ts";
  const repository = makeRepository({ ...TWO_FILES, [spaced]: "export const one = 1;\n" });
  commit(repository, spaced, "export const one = 11;\n");
  const stubs = makeStubs({ tscSleeps: 30 });
  const result = run(repository, stubs, {
    env: { QUICK_CHECK_TYPE_BUDGET_MS: "300", QUICK_CHECK_FULL_TYPE_BUDGET_MS: "500" },
  });

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(
    result.stderr,
    /Run: node scripts\/quick-check\.mjs --files 'src\/tutorial space\/one\.ts'/,
  );
});

test("a missing type checker stops the push instead of skipping it", () => {
  const repository = makeRepository(TWO_FILES);
  commit(repository, "src/one.ts", "export const one = 11;\n");
  const stubs = makeStubs();
  rmSync(path.join(stubs.directory, "tsc"));
  const result = run(repository, stubs);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /tsc is not installed in this checkout; run npm install and push again/);
});

test("the old skip variable no longer bypasses the check", () => {
  const repository = makeRepository(TWO_FILES);
  commit(repository, "src/one.ts", "export const one = 11;\n");
  const stubs = makeStubs({ eslintExit: 1 });
  const result = run(repository, stubs, { env: { HYPERTASK_SKIP_QUICK_CHECK: "1" } });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /lint failed; the push was stopped/);
  assert.ok(stubs.calls().length > 0);
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
    env: {
      ...process.env,
      PATH: `${stubs.directory}:${process.env.PATH}`,
      QUICK_CHECK_BIN_DIR: stubs.directory,
    },
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
