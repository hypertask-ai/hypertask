const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const scriptUrl = pathToFileURL(
  path.join(root, ".github/scripts/select-tests.mjs"),
).href;

async function select(changed) {
  const { selectTests } = await import(scriptUrl);
  return selectTests(changed);
}

test("a dependency or schema change runs the whole suite", async () => {
  assert.equal(await select(["package.json"]), "ALL");
  assert.equal(await select(["prisma/schema.prisma"]), "ALL");
  assert.equal(await select(["tsconfig.json"]), "ALL");
});

const SIX_SHARED = [
  "src/lib/mcp-server/validations/comment.validation.ts",
  "src/lib/mcp-server/validations/common/task-identification.ts",
  "src/lib/mcp-server/validations/draft.validation.ts",
  "src/lib/mcp-server/validations/inbox.validation.ts",
  "src/lib/mcp-server/validations/task.validation.ts",
  "src/lib/mcp-server/validations/view.validation.ts",
];

test("six shared lib files pick their union, under half the suite, dropping nothing", async () => {
  const { discoverTestFiles } = await import(
    pathToFileURL(path.join(root, "scripts/test-inventory.mjs")).href
  );
  const { supported } = await discoverTestFiles({
    root,
    testsRoot: path.join(root, "tests"),
  });
  const selected = await select(SIX_SHARED);
  assert.notEqual(selected, "ALL");
  assert.ok(
    selected.length < supported.length / 2,
    `${selected.length} of ${supported.length} test files is not under half`,
  );
  const picked = new Set(selected);
  for (const file of SIX_SHARED) {
    const alone = await select([file]);
    if (alone === "ALL") continue;
    for (const testPath of alone) {
      assert.ok(picked.has(testPath), `${file} reaches ${testPath}, the six-file pick drops it`);
    }
  }
});

test("a workflow change selects the test that names it", async () => {
  const selected = await select([".github/workflows/ai-review-mirror.yml"]);
  assert.notEqual(selected, "ALL");
  assert.ok(selected.includes("tests/ai-review-mirror-workflow.test.cjs"));
});

test("a workflow change runs the tests that read it", async () => {
  const selected = await select([".github/workflows/ci-tests.yml"]);
  assert.notEqual(selected, "ALL");
  assert.ok(selected.includes("tests/ci-parallel-checks.test.cjs"));
});

test("the selector, the sharding and the scope detector run the whole suite", async () => {
  for (const file of [
    ".github/scripts/select-tests.mjs",
    ".github/scripts/shard-tests.mjs",
    ".github/scripts/shard-containers.mjs",
    ".github/scripts/ci-change-scope.cjs",
  ]) {
    assert.equal(await select([file]), "ALL", file);
  }
});

test("a workflow no test names still runs the whole suite", async () => {
  assert.equal(await select([`.github/workflows/${"no"}${"-test-names-this-qz"}.yml`]), "ALL");
});

test("a change no test references falls back to the whole suite", async () => {
  const unreferenced = `src/components/${"Unref"}${"erencedWidgetQqz"}.tsx`;
  assert.equal(await select([unreferenced]), "ALL");
});

test("a referenced source file selects the tests naming it", async () => {
  const selected = await select(["src/lib/mcp/auth.ts"]);
  assert.notEqual(selected, "ALL");
  assert.ok(selected.includes("tests/account-token-revocation.test.cjs"));
});

test("a test importing a changed file by relative path is selected (YPER4-238)", async () => {
  const selected = await select(["src/app/api/ai/chat/stream/streamLease.ts"]);
  assert.notEqual(selected, "ALL");
  assert.ok(selected.includes("tests/ai-chat-cancellation.test.ts"));
});

test("the import graph follows aliases, relative hops, path.join and unresolvable requires", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const { execFileSync } = require("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "select-graph-"));
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  put("scripts/test-inventory.mjs", fs.readFileSync(path.join(root, "scripts/test-inventory.mjs"), "utf8"));
  put(".github/scripts/select-tests.mjs", fs.readFileSync(path.join(root, ".github/scripts/select-tests.mjs"), "utf8"));
  put("src/lib/leaf.ts", "export const leaf = 1;\n");
  put("src/lib/mid.ts", 'import { leaf } from "@/lib/leaf";\nexport const mid = leaf;\n');
  put("src/lib/dir/index.ts", "export const d = 1;\n");
  put("src/lib/other.ts", "export const other = 1;\n");
  put("src/lib/orphan.ts", "export const orphan = 1;\n");
  put("tests/alias.test.cjs", 'require("../src/lib/mid");\n');
  put("tests/barrel.test.ts", 'import "../src/lib/dir";\n');
  put("tests/join.test.cjs", 'const p = require("node:path").join(__dirname, "..", "src", "lib", "other.ts");\n');
  put("tests/helper.cjs", 'require("../src/lib/leaf");\n');
  put("tests/viahelper.test.cjs", 'require("./helper.cjs");\n');
  put("tests/dynamic.test.cjs", "const name = process.env.X;\nrequire(name);\n");
  put("tests/mixed.test.cjs", 'require("./helper.cjs");\nrequire(process.env.X);\n');
  put("src/lib/loader.ts", "export const load = (n: string) => require(n);\n");
  put("tests/viaLoader.test.cjs", 'require("../src/lib/loader");\n');
  put("src/lib/shimTarget.ts", "export const t = 1;\n");
  const shim =
    "function load(file, stubs = {}) {\n" +
    "  const mod = { require: (request) => stubs[request] ?? require(request) };\n" +
    "  return mod;\n}\n";
  put("tests/shimLiteral.test.cjs", shim + 'load("src/lib/shimTarget.ts");\n');
  put("tests/shimDynamic.test.cjs", shim + "load(process.env.X);\n");
  put("tests/helpers/loadTs.cjs", "exports.loadTsModule = " + "function loadTsModule(file) { return require(file); };\n");
  put("tests/shimHelper.test.cjs", 'const { loadTsModule } = require("./helpers/loadTs.cjs");\nloadTsModule("src/lib/shimTarget.ts");\n');
  put("tests/shimHelperDynamic.test.cjs", 'const { loadTsModule } = require("./helpers/loadTs.cjs");\nloadTsModule(process.env.X);\n');
  const helperReq = 'const { loadTsModule } = require("./helpers/loadTs.cjs");\n';
  put("tests/shimRef.test.cjs", helperReq + '["src/lib/shimTarget.ts"].map(loadTsModule);\n');
  put("tests/shimAlias.test.cjs", 'const { loadTsModule: l } = require("./helpers/loadTs.cjs");\nl("src/lib/shimTarget.ts");\n');
  put("tests/shimNs.test.cjs", 'const h = require("./helpers/loadTs.cjs");\n// loadTsModule(x) in a comment is ignored\nh.loadTsModule("src/lib/shimTarget.ts");\n');
  put("tests/helpers/anon.cjs", "module.exports = (p) => require(p);\n");
  put("tests/shimAnon.test.cjs", 'require("./helpers/anon.cjs")("src/lib/shimTarget.ts");\n');
  put(
    "tests/shimNested.test.cjs",
    "function load(f) { return (r) => require(r); }\n" +
      "function run(p) { load(process.env.X); return require(p); }\n" +
      'run("src/lib/shimTarget.ts");\n',
  );
  put("tests/helpers/loadRel.cjs", "exports.loadRel = function loadRel(file) { return (r) => require(r); };\n");
  put("tests/helpers/relTarget.ts", "export const rel = 1;\n");
  const relReq = 'const { loadRel } = require("./helpers/loadRel.cjs");\n';
  put("tests/shimRel.test.cjs", relReq + 'loadRel("./relTarget.ts");\n');
  put("tests/shimRelMissing.test.cjs", relReq + 'loadRel("./nope.ts");\n');
  put("tests/gone.ts", "export const gone = 1;\n");
  put("tests/shimGone.test.cjs", relReq + 'loadRel("./gone.ts");\n');
  const loadA = "exports.loadA = function loadA(f) { return (r) => require(r); };\n";
  put("tests/helpers/a/loadA.cjs", loadA);
  put("tests/helpers/a/t.ts", "export const t = 1;\n");
  put("tests/helpers/b/h2.cjs", loadA);
  put(
    "tests/shimDirs.test.cjs",
    'const { loadA } = require("./helpers/a/loadA.cjs");\nloadA("../b/h2.cjs");\nloadA("./t.ts");\n',
  );
  put(
    "tests/shimSecond.test.cjs",
    'function load(file, name) { return require(name); }\nload("src/lib/shimTarget.ts");\n',
  );
  put("tests/test-inventory.test.cjs", "// guard\n");
  put("tests/demo-smoke.test.cjs", "// guard\n");
  put("tests/file-size-limit.test.cjs", "// guard\n");
  const pick = (file) =>
    execFileSync(process.execPath, [".github/scripts/select-tests.mjs", file], { cwd: dir, encoding: "utf8" })
      .trim().split("\n");
  try {
    const leaf = pick("src/lib/leaf.ts");
    assert.ok(leaf.includes("tests/alias.test.cjs"), "alias + relative hop");
    assert.ok(leaf.includes("tests/viahelper.test.cjs"), "through a test helper");
    assert.ok(leaf.includes("tests/dynamic.test.cjs"), "unresolvable require widens");
    assert.ok(leaf.includes("tests/mixed.test.cjs"), "static helper plus dynamic require");
    assert.ok(leaf.includes("tests/viaLoader.test.cjs"), "dynamic require reached in src");
    assert.ok(!leaf.includes("tests/join.test.cjs"), "unrelated test is skipped");
    const viaShim = pick("src/lib/shimTarget.ts");
    assert.ok(viaShim.includes("tests/shimLiteral.test.cjs"), "literal loader path is traced");
    assert.ok(viaShim.includes("tests/shimHelper.test.cjs"), "loader in a test helper is traced");
    assert.ok(!pick("src/lib/other.ts").includes("tests/shimLiteral.test.cjs"), "shim test is not always-selected");
    assert.ok(!pick("src/lib/other.ts").includes("tests/shimHelper.test.cjs"), "helper shim test is not always-selected");
    const otherPick = pick("src/lib/other.ts");
    assert.ok(otherPick.includes("tests/shimSecond.test.cjs"), "require of a non-first parameter stays always-selected");
    assert.ok(!otherPick.includes("tests/shimGone.test.cjs"), "deleted-target test is traced, not always-selected");
    assert.ok(pick("tests/helpers/gone.ts").includes("tests/shimGone.test.cjs"), "deleted helper-relative target selects the test");
    assert.ok(pick("tests/helpers/b/t.ts").includes("tests/shimDirs.test.cjs"), "late loader dir re-validates earlier calls");
    assert.ok(otherPick.includes("tests/shimAnon.test.cjs"), "anonymous exported loader stays always-selected");
    assert.ok(otherPick.includes("tests/shimNested.test.cjs"), "unknown nested loader call stays always-selected");
    assert.ok(otherPick.includes("tests/shimRelMissing.test.cjs"), "literal that resolves nowhere stays always-selected");
    assert.ok(!otherPick.includes("tests/shimRel.test.cjs"), "helper-relative literal is traced, not always-selected");
    assert.ok(pick("tests/helpers/relTarget.ts").includes("tests/shimRel.test.cjs"), "literal resolved from the helper dir");
    assert.ok(pick("src/lib/other.ts").includes("tests/shimRef.test.cjs"), "loader passed by reference is untraceable");
    assert.ok(pick("src/lib/other.ts").includes("tests/shimAlias.test.cjs"), "destructured loader alias is untraceable");
    assert.ok(viaShim.includes("tests/shimNs.test.cjs"), "namespace call h.loader('lit') is traced");
    assert.ok(!pick("src/lib/other.ts").includes("tests/shimNs.test.cjs"), "namespace call is not always-selected");
    assert.ok(pick("src/lib/other.ts").includes("tests/shimDynamic.test.cjs"), "loader with non-literal path stays untraceable");
    assert.ok(pick("src/lib/other.ts").includes("tests/shimHelperDynamic.test.cjs"), "helper loader with non-literal path stays untraceable");
    assert.ok(pick("src/lib/dir/index.ts").includes("tests/barrel.test.ts"), "directory index");
    assert.ok(pick("src/lib/other.ts").includes("tests/join.test.cjs"), "path.join with __dirname");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("nested suites are discoverable, not just the flat tests dir", async () => {
  const selected = await select([
    "tests/security/getCount.test.ts",
    "src/lib/mcp/auth.ts",
  ]);
  assert.notEqual(selected, "ALL");
  assert.ok(selected.includes("tests/security/getCount.test.ts"));
});

test("a file referenced only by name, not by path, runs the full suite", async () => {
  const named = `src/lib/${"task-write"}${"-lock.ts"}`;
  assert.equal(await select([named]), "ALL");
});

test("a deleted test path never reaches the runner", async () => {
  const selected = await select([
    "tests/deleted-suite-qqz.test.cjs",
    "src/lib/mcp/auth.ts",
  ]);
  assert.notEqual(selected, "ALL");
  assert.ok(!selected.includes("tests/deleted-suite-qqz.test.cjs"));
});

test("an unreferenced file forces ALL even alongside a changed test", async () => {
  const unreferenced = `src/components/${"Unref"}${"erencedWidgetQqz"}.tsx`;
  assert.equal(await select(["tests/agent-slug.test.cjs", unreferenced]), "ALL");
});

test("a changed test file is always run", async () => {
  const selected = await select(["tests/agent-slug.test.cjs"]);
  assert.ok(Array.isArray(selected));
  assert.ok(selected.includes("tests/agent-slug.test.cjs"));
});

test("a changed test file also runs the files that compile its source (HYCI-69)", async () => {
  const selected = await select(["tests/compose-task-palette.test.cjs"]);
  assert.notEqual(selected, "ALL");
  assert.ok(selected.includes("tests/compose-task-palette.test.cjs"));
  for (const host of ["tests/htpr-7307-ctrlj-footer-clickable.test.cjs", "tests/htpr-7675-ctrlj-enter-before-text-renders.test.cjs"]) {
    assert.ok(selected.includes(host), `${host} loads the changed fixture`);
  }
});

test("selection always includes the cheap runner and demo guards", async () => {
  const selected = await select(["tests/agent-slug.test.cjs"]);
  assert.ok(selected.includes("tests/test-inventory.test.cjs"));
  assert.ok(selected.includes("tests/demo-smoke.test.cjs"));
});

test("selected paths are committed test files the runner accepts", async () => {
  const fs = require("node:fs");
  const selected = await select(["tests/agent-slug.test.cjs"]);
  for (const file of selected) {
    assert.match(file, /^tests\/[A-Za-z0-9._/-]+\.test\.(cjs|ts)$/);
    assert.ok(fs.existsSync(path.join(root, file)), `${file} does not exist`);
  }
});

test("importing a barrel does not select every file under that directory", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const { execFileSync } = require("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "select-barrel-"));
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  put("scripts/test-inventory.mjs", fs.readFileSync(path.join(root, "scripts/test-inventory.mjs"), "utf8"));
  put(".github/scripts/select-tests.mjs", fs.readFileSync(path.join(root, ".github/scripts/select-tests.mjs"), "utf8"));
  put("src/utils/index.ts", "export const base = 1;\n");
  put("src/utils/leaf.ts", "export const leaf = 1;\n");
  put("src/lib/usesBarrel.ts", 'import { base } from "@/utils";\nexport const uses = base;\n');
  put("tests/barrel-importer.test.cjs", 'require("../src/lib/usesBarrel.ts");\n');
  put("tests/leaf-importer.test.cjs", 'require("../src/utils/leaf.ts");\n');
  put("tests/scan-utils.test.cjs", 'require("node:fs").readdirSync("src/utils");\n');
  put("tests/prefix-utils.test.cjs", "const name = process.env.X;\nconst p = `src/utils/${name}`;\n");
  put("tests/copy-utils.test.cjs", 'require("node:fs").cpSync("src/utils", "dest", { recursive: true });\n');
  put("tests/join-utils.test.cjs", 'require("node:path").join("src", "utils");\n');
  put("tests/require-barrel.test.cjs", 'require("../src/utils");\n');
  put("tests/side-effect-barrel.test.cjs", 'import "../src/utils";\n');
  const pick = (file) =>
    execFileSync(process.execPath, [".github/scripts/select-tests.mjs", file], { cwd: dir, encoding: "utf8" })
      .trim()
      .split("\n");
  try {
    const leaf = pick("src/utils/leaf.ts");
    assert.ok(leaf.includes("tests/leaf-importer.test.cjs"), "the test that imports the leaf still runs");
    assert.ok(leaf.includes("tests/scan-utils.test.cjs"), "a directory walk still runs");
    assert.ok(leaf.includes("tests/prefix-utils.test.cjs"), "a dynamic path prefix still runs");
    assert.ok(!leaf.includes("tests/barrel-importer.test.cjs"), "import \"@/utils\" is not every file under src/utils");
    assert.ok(!leaf.includes("tests/require-barrel.test.cjs"), "require(\"../src/utils\") is that module");
    assert.ok(!leaf.includes("tests/side-effect-barrel.test.cjs"), "import \"../src/utils\" is that module");
    assert.ok(leaf.includes("tests/copy-utils.test.cjs"), "cpSync of the directory still runs");
    assert.ok(leaf.includes("tests/join-utils.test.cjs"), "path.join of the directory still runs");
    const index = pick("src/utils/index.ts");
    assert.ok(index.includes("tests/barrel-importer.test.cjs"), "the barrel file itself still selects its importer");
    assert.ok(index.includes("tests/require-barrel.test.cjs"), "require of the barrel still selects its test");
    assert.ok(index.includes("tests/copy-utils.test.cjs"), "copying the directory still runs for the barrel file");
    assert.notEqual(leaf.join("\n"), "ALL");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a pick that covers most of the suite runs the whole suite", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const { execFileSync } = require("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "select-wide-pick-"));
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  put("scripts/test-inventory.mjs", fs.readFileSync(path.join(root, "scripts/test-inventory.mjs"), "utf8"));
  put(".github/scripts/select-tests.mjs", fs.readFileSync(path.join(root, ".github/scripts/select-tests.mjs"), "utf8"));
  put("src/lib/core.ts", "export const core = 1;\n");
  put("src/lib/leaf.ts", "export const leaf = 1;\n");
  for (let i = 0; i < 10; i++) put(`tests/reaches-core-${i}.test.cjs`, 'require("../src/lib/core.ts");\n');
  put("tests/reaches-leaf.test.cjs", 'require("../src/lib/leaf.ts");\n');
  const pick = (file) =>
    execFileSync(process.execPath, [".github/scripts/select-tests.mjs", file], { cwd: dir, encoding: "utf8" })
      .trim();
  try {
    assert.equal(pick("src/lib/core.ts"), "ALL");
    const leaf = pick("src/lib/leaf.ts").split("\n");
    assert.ok(leaf.includes("tests/reaches-leaf.test.cjs"), "a narrow pick still runs the test that reaches it");
    assert.ok(!leaf.includes("tests/reaches-core-0.test.cjs"), "a narrow pick is not widened");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a test added by the same PR does not count as coverage", async () => {
  const selected = await select([
    "tests/select-tests.test.cjs",
    "src/lib/select-tests-fixture-qqz.ts",
  ]);
  assert.equal(selected, "ALL");
});
