const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");

const pkg = JSON.parse(readFileSync(`${__dirname}/../package.json`, "utf8"));
const devTools = [
  "eslint",
  "eslint-config-next",
  "@eslint/compat",
  "@typescript-eslint/parser",
  "typescript",
  "@typescript/native",
  "@types/node",
  "@types/react",
  "@types/ua-parser-js",
  "ts-loader",
];

test("development tools stay out of runtime dependencies", () => {
  for (const name of devTools) {
    assert.equal(Object.hasOwn(pkg.dependencies, name), false, `${name} is development-only`);
    assert.ok(pkg.devDependencies[name], `${name} must remain available for development`);
  }
});

test("unused package-manager packages are not direct dependencies", () => {
  for (const name of ["install", "npm"]) {
    assert.equal(Object.hasOwn(pkg.dependencies, name), false);
    assert.equal(Object.hasOwn(pkg.devDependencies, name), false);
  }
});

test("lockfile root dependency maps match the manifest", () => {
  const lock = JSON.parse(readFileSync(`${__dirname}/../package-lock.json`, "utf8"));
  assert.deepEqual(lock.packages[""].dependencies, pkg.dependencies);
  assert.deepEqual(lock.packages[""].devDependencies, pkg.devDependencies);
});
