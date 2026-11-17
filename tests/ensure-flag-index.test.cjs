const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename);
const { ensureFlagIndex } = jiti(path.join(root, "src/lib/flags/ensureFlagIndex.ts"));

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

function withNodeEnv(value, run) {
  const previous = process.env.NODE_ENV;
  if (value === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
}

test("a checkout without the flag list builds it before the keys module resolves", (t) => {
  const dir = fixture(t);
  const flags = path.join(dir, "src/lib/flags");
  const ensure = path.join(root, "src/lib/flags/ensureFlagIndex.ts");
  fs.writeFileSync(
    path.join(flags, "local-ensure.ts"),
    `import { ensureFlagIndex } from ${JSON.stringify(ensure)};\nensureFlagIndex(${JSON.stringify(dir)});\n`,
  );
  fs.writeFileSync(
    path.join(flags, "entry.ts"),
    'import "./local-ensure";\nexport * from "./definitions/index.generated";\n',
  );
  const loaded = withNodeEnv(undefined, () => jiti(path.join(flags, "entry.ts")));
  assert.equal(loaded.FIRST_FLAG, "htpr-1-first");
  assert.equal(fs.existsSync(path.join(dir, "src/lib/flags/definitions/index.generated.ts")), true);
});

test("production startup leaves a missing flag list untouched", (t) => {
  const dir = fixture(t);
  withNodeEnv("production", () => ensureFlagIndex(dir));
  assert.equal(fs.existsSync(path.join(dir, "src/lib/flags/definitions/index.generated.ts")), false);
});

test("a direct definitions import builds a missing flag list", () => {
  const output = path.join(root, "src/lib/flags/definitions/index.generated.ts");
  const backup = fs.existsSync(output) ? fs.readFileSync(output) : null;
  const scriptPath = path.join(os.tmpdir(), `flag-index-direct-${process.pid}.cjs`);
  fs.writeFileSync(scriptPath, `
    const assert = require("node:assert/strict");
    const fs = require("node:fs");
    const path = require("node:path");
    const { createJiti } = require("jiti");
    const root = ${JSON.stringify(root)};
    const output = path.join(root, "src/lib/flags/definitions/index.generated.ts");
    const definitions = path.join(root, "src/lib/flags/definitions.ts");
    const load = () => createJiti(__filename)(definitions);
    if (process.env.CHECK === "production") {
      process.env.NODE_ENV = "production";
      assert.throws(load);
      assert.equal(fs.existsSync(output), false);
    } else {
      delete process.env.NODE_ENV;
      const loaded = load();
      assert.ok(loaded.FEATURE_FLAG_DEFINITIONS.length > 0);
      assert.equal(fs.existsSync(output), true);
      const again = createJiti(__filename)(definitions);
      assert.equal(again.FEATURE_FLAG_DEFINITIONS.length, loaded.FEATURE_FLAG_DEFINITIONS.length);
      const keys = createJiti(__filename)(path.join(root, "src/lib/flags/keys.ts"));
      assert.ok(Object.values(keys).includes(loaded.FEATURE_FLAG_DEFINITIONS[0].key));
    }
  `);
  const run = (check) => spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    env: { ...process.env, CHECK: check, NODE_ENV: "" },
    encoding: "utf8",
  });
  try {
    if (backup) fs.rmSync(output);
    const blocked = run("production");
    assert.equal(blocked.status, 0, blocked.stderr || blocked.stdout);
    const built = run("build");
    assert.equal(built.status, 0, built.stderr || built.stdout);
  } finally {
    fs.rmSync(scriptPath, { force: true });
    if (backup) fs.writeFileSync(output, backup);
    else fs.rmSync(output, { force: true });
  }
});
