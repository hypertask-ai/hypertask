const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

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
