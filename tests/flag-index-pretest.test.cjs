const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, { interopDefault: true });
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

function entry(dir, body) {
  const ensure = path.join(root, "src/lib/flags/ensureFlagIndex.ts");
  const flags = path.join(dir, "src/lib/flags");
  fs.writeFileSync(
    path.join(flags, "local-ensure.ts"),
    `import { ensureFlagIndex } from ${JSON.stringify(ensure)};\nensureFlagIndex(${JSON.stringify(dir)});\n`,
  );
  const file = path.join(flags, "entry.ts");
  fs.writeFileSync(file, `import "./local-ensure";\n${body}`);
  return file;
}

test("a checkout without the flag list builds it before the keys resolve", (t) => {
  const dir = fixture(t);
  const loaded = withNodeEnv(undefined, () => jiti(entry(dir, 'export * from "./definitions/index.generated";\n')));
  assert.equal(loaded.FIRST_FLAG, "htpr-1-first");
  assert.match(fs.readFileSync(path.join(dir, "src/lib/flags/definitions/index.generated.ts"), "utf8"), /FIRST_FLAG/);
});

test("production startup leaves a missing flag list untouched", (t) => {
  const dir = fixture(t);
  withNodeEnv("production", () => ensureFlagIndex(dir));
  assert.equal(fs.existsSync(path.join(dir, "src/lib/flags/definitions/index.generated.ts")), false);
});

test("a direct definitions import builds a missing flag list", (t) => {
  const dir = fixture(t);
  const loaded = withNodeEnv(undefined, () => jiti(entry(dir, 'import { FLAG_DEFINITIONS } from "./definitions/index.generated";\nexport const FEATURE_FLAG_DEFINITIONS = FLAG_DEFINITIONS;\n')));
  assert.equal(loaded.FEATURE_FLAG_DEFINITIONS.length, 1);
  assert.equal(loaded.FEATURE_FLAG_DEFINITIONS[0].key, "htpr-1-first");
});

test("the registry wrapper may import the flag list builder and nothing else that runs", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flag-wrapper-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (relative, content) => {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  const git = (args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  write("src/lib/flags.ts", 'const DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n');
  write(
    "src/lib/flags/definitions/htpr-1-first.ts",
    'export const FIRST_FLAG = "htpr-1-first";\nexport default { key: FIRST_FLAG, shippedOn: "2026-10-10", description: "Fixture" } as const;\n',
  );
  write(
    "src/lib/flags/definitions.ts",
    'import "./ensureFlagIndex";\nimport { FLAG_DEFINITIONS } from "./definitions/index.generated";\nexport const FEATURE_FLAG_DEFINITIONS = FLAG_DEFINITIONS;\n',
  );
  git(["init", "-q"]);
  git(["add", "-A"]);
  git(["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-q", "-m", "allow the builder"]);
  const allowed = git(["rev-parse", "HEAD"]).trim();
  write(
    "src/lib/flags/definitions.ts",
    'import { readFileSync } from "node:fs";\nimport { FLAG_DEFINITIONS } from "./definitions/index.generated";\nexport const FEATURE_FLAG_DEFINITIONS = FLAG_DEFINITIONS;\n',
  );
  git(["add", "src/lib/flags/definitions.ts"]);
  git(["-c", "user.email=test@example.com", "-c", "user.name=Test", "commit", "-q", "-m", "reject another import"]);
  const rejected = git(["rev-parse", "HEAD"]).trim();
  const script = path.join(dir, "check.mjs");
  fs.writeFileSync(script, `process.chdir(${JSON.stringify(dir)});\nprocess.env.FEATURE_FLAG_TYPESCRIPT_PATH = ${JSON.stringify(require.resolve("typescript"))};\nconst { parseDefinitions } = await import(${JSON.stringify(pathToFileURL(path.join(root, ".github/scripts/feature-flag-registry.mjs")).href)});\nconst parsed = parseDefinitions(${JSON.stringify(allowed)});\nif (parsed.keys[0] !== "htpr-1-first") throw new Error(parsed.keys.join(","));\ntry { parseDefinitions(${JSON.stringify(rejected)}); throw new Error("import was allowed"); }\ncatch (error) { if (!/data-only generated registry wrapper/.test(error.message)) throw error; }\n`);
  const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
