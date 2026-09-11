const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

// Same CI-safe TypeScript loader used by tests/factory-owner-ui.test.cjs.
function load(relative, overrides = {}) {
  const filename = path.resolve(root, relative);
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = Module._nodeModulePaths(path.dirname(filename));
  mod.require = (id) =>
    Object.prototype.hasOwnProperty.call(overrides, id)
      ? overrides[id]
      : require(id);
  const source = fs.readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  mod._compile(outputText, filename);
  return mod.exports;
}

const { selectFavorites } = load(
  "src/utils/api/global/apiHelpers/favoritesResponse.ts",
);

test("selectFavorites turns non-arrays into [] and keeps real lists", () => {
  assert.deepEqual(selectFavorites(42), []);
  assert.deepEqual(selectFavorites({ message: "Unable to load favorites" }), []);
  assert.deepEqual(selectFavorites(undefined), []);
  const list = [{ id: 1, index: 1, projectId: 15 }];
  assert.equal(selectFavorites(list), list);
});

test("favorites hook uses selectFavorites and no longer seeds with a user id", () => {
  const hook = read("src/hooks/MultiPages/useGetAllFavorites.ts");
  const manage = read("src/components/Modals/ManageFavorites/index.tsx");
  const landing = read("src/app/[...boardURL]/LandingPage.tsx");
  const provider = read("src/components/ProviderGlobal/useGlobalProvider.ts");

  assert.match(hook, /select:\s*selectFavorites/);
  assert.doesNotMatch(
    hook,
    /initialData:\s*initialData/,
    "numeric initialData must not be accepted",
  );
  assert.doesNotMatch(
    manage,
    /useGetAllFavorites\(\s*currentUser\.UserSettingId\s*,\s*currentUser\.id\s*\)/,
  );
  assert.doesNotMatch(
    landing,
    /useGetAllFavorites\(\s*_currentUser\.UserSettingId\s*,\s*_currentUser\.id/,
  );
  assert.match(provider, /Array\.isArray\(favorites\)/);
});
