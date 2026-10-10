const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { execFileSync } = require("node:child_process");

const folder = "src/lib/flags/definitions";
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flag-files-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, folder), { recursive: true });
  return root;
}
function flag(root, key, identifier, extra = "") {
  fs.writeFileSync(path.join(root, folder, `${key}.ts`), `export const ${identifier} = "${key}";\nexport default { key: ${identifier}, shippedOn: "2026-10-10", description: "Fixture", ${extra} } as const;\n`);
}

test("generator is deterministic, sorts filenames, exports keys and never rewrites unchanged output", async (t) => {
  const root = fixture(t);
  flag(root, "htpr-9-last", "LAST_FLAG");
  flag(root, "htpr-1-first", "FIRST_FLAG");
  const { generateFlagIndex } = await import("../scripts/generate-flag-index.mjs");
  const first = generateFlagIndex(root);
  const output = path.join(root, folder, "index.generated.ts");
  const before = fs.statSync(output).mtimeMs;
  assert.equal(generateFlagIndex(root), first);
  assert.equal(fs.statSync(output).mtimeMs, before);
  assert.ok(first.indexOf('from "./htpr-1-first"') < first.indexOf('from "./htpr-9-last"'));
  assert.match(first, /export \{ FIRST_FLAG \}/);
  assert.match(first, /export const FLAG_DEFINITIONS = \[\n  flag0,\n  flag1,/);
});

test("generator fails loudly for missing folders, missing definitions, malformed files and unsafe modules", async (t) => {
  const root = fixture(t);
  const { generateFlagIndex } = await import("../scripts/generate-flag-index.mjs");
  assert.throws(() => generateFlagIndex(path.join(root, "missing")), /ENOENT/);
  assert.throws(() => generateFlagIndex(root), /empty or missing/);
  const filename = path.join(root, folder, "htpr-1-first.ts");
  const valid = 'export const FIRST_FLAG = "htpr-1-first";\nexport default { key: FIRST_FLAG, shippedOn: "2026-10-10", description: "Fixture" } as const;';
  for (const source of [
    valid.split("\n")[0],
    valid.replace("export const", "export declare const"),
    valid.replace('description: "Fixture"', ''),
    valid.replace('"2026-10-10"', '"2026-02-31"'),
    valid.replace('key: FIRST_FLAG', 'key: "htpr-2-other"'),
    valid.replace('key: FIRST_FLAG', 'key: FIRST_FLAG, key: FIRST_FLAG'),
    valid.replace('key: FIRST_FLAG', 'key: FIRST_FLAG, ...extra'),
    valid.replace('key: FIRST_FLAG', 'key: FIRST_FLAG, defaultMode: "EVERYONE"'),
    valid.replace('key: FIRST_FLAG', 'key: FIRST_FLAG, releaseRisk: { risk: "small", reason: "" }'),
    valid + '\nconsole.log("side effect");',
    'import fs from "node:fs";\n' + valid,
    valid.replace('"htpr-1-first"', '"htpr-2-other"'),
    'export const FIRST_FLAG = ;',
  ]) {
    fs.writeFileSync(filename, source);
    assert.throws(() => generateFlagIndex(root), /invalid .*htpr-1-first\.ts/, source);
  }
  fs.writeFileSync(filename, 'import type { FeatureFlagDefinition } from "../definitions";\n' + valid);
  assert.doesNotThrow(() => generateFlagIndex(root));
  flag(root, "htpr-2-other", "FIRST_FLAG");
  assert.throws(() => generateFlagIndex(root), /duplicate feature flag/);
});

test("two independent flag PRs merge without registry conflicts and regenerate both flags", async (t) => {
  const root = fixture(t);
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q");
  git("config", "user.name", "Flag test");
  git("config", "user.email", "flag@example.test");
  fs.writeFileSync(path.join(root, ".gitignore"), `${folder}/index.generated.ts\n`);
  flag(root, "htpr-1-base", "BASE_FLAG");
  git("add", "."); git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  git("switch", "-qc", "flag-a");
  flag(root, "htpr-2-one", "ONE_FLAG");
  git("add", "."); git("commit", "-qm", "flag one");
  git("switch", "-qc", "flag-b", base);
  flag(root, "htpr-3-two", "TWO_FLAG");
  git("add", "."); git("commit", "-qm", "flag two");
  git("merge", "--no-edit", "flag-a");
  assert.equal(git("diff", "--name-only", "--diff-filter=U"), "");
  const { generateFlagIndex } = await import("../scripts/generate-flag-index.mjs");
  const generated = generateFlagIndex(root);
  assert.match(generated, /export \{ ONE_FLAG \}/);
  assert.match(generated, /export \{ TWO_FLAG \}/);
  assert.equal(git("status", "--porcelain"), "");
  assert.equal(git("ls-files", `${folder}/index.generated.ts`), "");
});
