const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const { findKnownBadPackages } = require("../.github/scripts/check-known-bad-packages.cjs");
const { meetsFloor } = require("../.github/scripts/check-node-security-floor.cjs");

const list = JSON.parse(fs.readFileSync(".github/known-bad-packages.json", "utf8"));
const lock = (packages) => ({ lockfileVersion: 3, packages: { "": { name: "app" }, ...packages } });

test("every worm release is refused, top-level or nested", () => {
  const packages = {
    "node_modules/keyv": { version: "6.0.0" },
    "node_modules/cacheable": { version: "2.5.1" },
    "node_modules/eslint/node_modules/flat-cache": { version: "6.1.24" },
    "node_modules/a/node_modules/b/node_modules/file-entry-cache": { version: "11.1.6" },
  };
  const hits = findKnownBadPackages("package-lock.json", lock(packages), list);
  assert.equal(hits.length, 4);
  assert.match(hits[2], /node_modules\/eslint\/node_modules\/flat-cache: flat-cache@6\.1\.24 is a known-bad release/);
});

test("aliased installs are refused by their real package name", () => {
  const hits = findKnownBadPackages("package-lock.json", lock({ "node_modules/cache-alias": { name: "keyv", version: "6.0.0" } }), list);
  assert.equal(hits.length, 1);
});

test("the clean versions next to the worm releases are still allowed", () => {
  const packages = {
    "node_modules/keyv": { version: "5.6.0" },
    "node_modules/cacheable": { version: "2.5.0" },
    "node_modules/flat-cache": { version: "6.1.23" },
    "node_modules/file-entry-cache": { version: "11.1.5" },
    "node_modules/@keyv/serialize": { version: "6.0.0" },
  };
  assert.deepEqual(findKnownBadPackages("package-lock.json", lock(packages), list), []);
});

test("a lockfile without a packages map fails closed", () => {
  assert.throws(() => findKnownBadPackages("old/package-lock.json", { lockfileVersion: 1, dependencies: {} }, list), /old\/package-lock.json has no "packages" map/);
});

test("every tracked lockfile in the repository is clean", () => {
  for (const file of ["package-lock.json", "e2e/midscene/package-lock.json", "config/parity/runner/package-lock.json"]) {
    assert.deepEqual(findKnownBadPackages(file, JSON.parse(fs.readFileSync(file, "utf8")), list), []);
  }
});

test("Node below the October 2026 security floor is refused", () => {
  for (const version of ["24.21.0", "v24.22.0", "22.23.4", "20.99.99"]) assert.equal(meetsFloor(version, "24.22.1"), false, version);
});

test("Node at or above the security floor is still allowed", () => {
  for (const version of ["24.22.1", "v24.22.2", "24.23.0", "26.12.1"]) assert.equal(meetsFloor(version, "24.22.1"), true, version);
});

test("an unreadable Node version fails closed", () => {
  for (const version of [undefined, "", "24.x", "latest"]) assert.throws(() => meetsFloor(version, "24.22.1"), /must look like/);
});

test("the app floor and the CI floor read the same file", () => {
  const floor = JSON.parse(fs.readFileSync("src/lib/runtime/nodeSecurityFloor.json", "utf8"));
  assert.equal(floor.minimum, "24.22.1");
  assert.match(fs.readFileSync("src/lib/runtime/nodeSecurityFloor.ts", "utf8"), /from "\.\/nodeSecurityFloor\.json"/);
});
