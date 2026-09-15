const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");

// e2e/midscene has no install or build step in CI, so ci-tests reports SKIPPED
// for every change to it. These assertions are the only gate that notices when
// the advisory dependency comes back or the @midscene/web floor slips below the
// major that dropped it (HTPR-6289).
const root = path.resolve(__dirname, "..");

const readJson = (relativePath) =>
  JSON.parse(readFileSync(path.join(root, relativePath), "utf8"));

const manifest = readJson("e2e/midscene/package.json");
const lock = readJson("e2e/midscene/package-lock.json");

const dependencyMaps = (entry) => [
  entry.dependencies,
  entry.devDependencies,
  entry.peerDependencies,
  entry.optionalDependencies,
];

test("midscene e2e keeps @midscene/web on the major that dropped @xmldom/xmldom", () => {
  const range = manifest.dependencies["@midscene/web"];
  const major = Number(range.replace(/^\D+/, "").split(".")[0]);
  assert.ok(
    major >= 1,
    `@midscene/web ${range} predates 1.0.0, which still bundles @xmldom/xmldom`,
  );

  const installed = lock.packages["node_modules/@midscene/web"];
  assert.ok(installed, "the lockfile no longer resolves @midscene/web");
  assert.equal(Number(installed.version.split(".")[0]), major);

  assert.equal(lock.packages[""].dependencies["@midscene/web"], range);
});

test("midscene e2e resolves no @xmldom/xmldom at any depth", () => {
  for (const [installPath, entry] of Object.entries(lock.packages)) {
    assert.ok(
      !installPath.includes("@xmldom/xmldom"),
      `${installPath} is back in the lockfile`,
    );
    for (const map of dependencyMaps(entry)) {
      assert.ok(
        !map || !("@xmldom/xmldom" in map),
        `${installPath || "the root package"} requires @xmldom/xmldom again`,
      );
    }
  }
});
