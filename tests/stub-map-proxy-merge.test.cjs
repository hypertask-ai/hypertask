const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { load, withStubs } = require("./task-route-loader.cjs");

const root = path.resolve(__dirname, "..");
const fallbackRequest = "@yper4-608/fallback";
const extraRequest = "@yper4-608/extra";
const fallback = { value: "base fallback" };
const extra = { value: "extra override" };
const catchAll = () => new Proxy({}, {
  has: (_target, request) => typeof request === "string" && request.startsWith("@yper4-608/"),
  get: () => fallback,
});

const loaders = {
  "task-route load": load,
  "refactored module require": (file, stubs) => require("./refactored-module-require.cjs")
    .createRefactoredModuleRequire(root, stubs)(`./${file}`),
  "shared loadModule": (file, stubs) => require("./helpers/loadModule.cjs").loadModule(file, stubs),
  "create-view-context load": (file, stubs) => require("./helpers/create-view-context.cjs").load(file, stubs),
  "board-rename loadTs": (file, stubs) => require("./helpers/board-rename.cjs").loadTs(file, stubs),
  "UI loader": (file, stubs) => require("./helpers/htpr-7260-ui.cjs").loader(stubs)(file),
  "Slack loadTs": (file, stubs) => require("./slack-app-fixtures.cjs").loadTs(file, stubs),
  "catalog loader": (file, stubs) => require("./htpr-6927-fixtures.cjs").loader(stubs)(file),
};

for (const [name, loadModule] of Object.entries(loaders)) {
  test(`${name} preserves Proxy fallback and gives extra stubs precedence`, (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yper4-608-stubs-"));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const filename = path.join(directory, "entry.ts");
    fs.writeFileSync(filename, `exports.fallback = require("${fallbackRequest}"); exports.extra = require("${extraRequest}");`);
    const file = path.relative(root, filename);
    const base = catchAll();
    const overrides = { [extraRequest]: extra };
    const spread = { ...base, ...overrides };
    assert.equal(fallbackRequest in spread, false);
    assert.throws(() => loadModule(file, spread), /@yper4-608\/fallback/);
    const merged = withStubs(base, overrides);
    assert.equal(fallbackRequest in merged, true);
    assert.equal(merged[fallbackRequest], fallback);
    assert.equal(merged[extraRequest], extra);
    const loaded = loadModule(file, merged);
    assert.equal(loaded.fallback.value, fallback.value);
    assert.equal(loaded.extra.value, extra.value);
  });
}

test("an unconditional catch-all still resolves modules after merging", () => {
  const base = new Proxy({}, { has: () => true, get: () => fallback });
  const resolve = (stubs) => (request) => {
    if (request in stubs) return stubs[request];
    throw new Error(`Missing stub: ${request}`);
  };
  const overrides = { [extraRequest]: extra };
  const source = `require("${fallbackRequest}")`;
  assert.throws(() => vm.runInNewContext(source, { require: resolve({ ...base, ...overrides }) }), /Missing stub/);
  const merged = withStubs(base, overrides);
  assert.equal(vm.runInNewContext(source, { require: resolve(merged) }), fallback);
  assert.equal(merged[extraRequest], extra);
});

test("plain-object stub maps retain untouched entries and extra precedence", () => {
  const base = { [fallbackRequest]: fallback, [extraRequest]: fallback };
  const merged = withStubs(base, { [extraRequest]: extra });
  assert.equal(fallbackRequest in merged, true);
  assert.equal(merged[fallbackRequest], fallback);
  assert.equal(merged[extraRequest], extra);
  assert.equal("missing" in merged, false);
  assert.equal(merged.missing, undefined);
  assert.equal(base[extraRequest], fallback);
});

test("nested merges preserve catch-all traps in either map and explicit undefined overrides", () => {
  const merged = withStubs(withStubs({}, catchAll()), { [extraRequest]: undefined });
  assert.equal(fallbackRequest in merged, true);
  assert.equal(merged[fallbackRequest], fallback);
  assert.equal(extraRequest in merged, true);
  assert.equal(merged[extraRequest], undefined);
  assert.equal(withStubs()[fallbackRequest], undefined);
});
