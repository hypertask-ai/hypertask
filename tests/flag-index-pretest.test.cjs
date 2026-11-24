const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");
const { loadModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");
const helper = path.join(root, "src/lib/flags/ensureFlagIndex.ts");

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flag-index-"));
  const folder = path.join(dir, "src/lib/flags/definitions");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    path.join(folder, "htpr-1-first.ts"),
    'export const FIRST_FLAG = "htpr-1-first";\nexport default { key: FIRST_FLAG, shippedOn: "2026-10-10", description: "Fixture" } as const;\n',
  );
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function withFlagRoot(dir, nodeEnv, run) {
  const previousRoot = process.env.HYPERTASK_FLAG_INDEX_ROOT;
  const previousEnv = process.env.NODE_ENV;
  process.env.HYPERTASK_FLAG_INDEX_ROOT = dir;
  if (nodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnv;
  try {
    return run();
  } finally {
    if (previousRoot === undefined) delete process.env.HYPERTASK_FLAG_INDEX_ROOT;
    else process.env.HYPERTASK_FLAG_INDEX_ROOT = previousRoot;
    if (previousEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnv;
  }
}

test("a checkout without the flag list builds it before the keys resolve", (t) => {
  const dir = fixture(t);
  const entry = path.join(dir, "src/lib/flags/entry.ts");
  fs.writeFileSync(entry, `import ${JSON.stringify(helper)};\nexport * from "./definitions/index.generated";\n`);
  const loaded = withFlagRoot(dir, undefined, () => createJiti(__filename, { interopDefault: true })(entry));
  assert.equal(loaded.FIRST_FLAG, "htpr-1-first");
  const generated = createJiti(__filename + ":generated", { interopDefault: true })(path.join(dir, "src/lib/flags/definitions/index.generated.ts"));
  assert.equal(generated.FLAG_DEFINITIONS[0].key, "htpr-1-first");
});

test("the TypeScript test loader builds a missing flag list before the keys resolve", (t) => {
  const dir = fixture(t);
  const entry = path.join(dir, "src/lib/flags/entry.ts");
  fs.writeFileSync(entry, `import ${JSON.stringify(helper)};\nexport * from "./definitions/index.generated";\nimport { FIRST_FLAG } from "./definitions/index.generated";\nconsole.log(FIRST_FLAG);\n`);
  const result = withFlagRoot(dir, undefined, () => spawnSync(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), entry], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  }));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), "htpr-1-first");
});

test("production startup leaves a missing flag list untouched", (t) => {
  const dir = fixture(t);
  const result = withFlagRoot(dir, "production", () => spawnSync(process.execPath, ["--experimental-strip-types", "--disable-warning=ExperimentalWarning", helper], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
  }));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(dir, "src/lib/flags/definitions/index.generated.ts")), false);
});

test("the flag list builder can be evaluated by the CommonJS test loader", (t) => {
  const dir = fixture(t);
  withFlagRoot(dir, undefined, () => loadModule(helper));
  assert.equal(fs.existsSync(path.join(dir, "src/lib/flags/definitions/index.generated.ts")), true);
});
