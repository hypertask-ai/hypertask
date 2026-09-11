const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

// Keep this mirror identical to selectFavorites in favoritesResponse.ts.
// CI Node cannot import .ts from a .cjs file without the full app install.
const selectFavorites = (data) => (Array.isArray(data) ? data : []);

test("selectFavorites turns non-arrays into [] and keeps real lists", () => {
  assert.deepEqual(selectFavorites(42), []);
  assert.deepEqual(selectFavorites({ message: "Unable to load favorites" }), []);
  assert.deepEqual(selectFavorites(undefined), []);
  const list = [{ id: 1, index: 1, projectId: 15 }];
  assert.equal(selectFavorites(list), list);

  assert.match(
    read("src/utils/api/global/apiHelpers/favoritesResponse.ts"),
    /Array\.isArray\(data\) \? \(data as IFavorites\[\]\) : \[\]/,
  );
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
