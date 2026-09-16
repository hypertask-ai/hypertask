const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const PINNED = [
  "better-auth",
  "@better-auth/api-key",
  "@better-auth/passkey",
];
const RANGE_RE = /^~?1\.6\.\d+$/;
const LOCKED_RE = /^1\.6\.\d+$/;

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

test("Better Auth 1.x stays on 1.6 so sign-in does not hit the 1.7 table check", () => {
  // HTPR-6395 / HTPR-6390: Better Auth 1.7.3 looks for default Prisma table
  // names and throws "Prisma schema mismatch / Missing tables User,
  // BetterAuthSession, ..." on /api/auth/bridge-session. Our models are
  // remapped. A 1.6 patch is fine; a 1.7 minor is not.
  const pkg = readJson("package.json");
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  for (const name of PINNED) {
    assert.match(
      String(deps[name] || ""),
      RANGE_RE,
      `${name} must be pinned to 1.6.x (got ${JSON.stringify(deps[name])})`,
    );
  }

  const lock = readJson("package-lock.json");
  for (const name of PINNED) {
    const entry = lock.packages[`node_modules/${name}`];
    assert.ok(entry, `${name} must be present in package-lock.json`);
    assert.match(
      String(entry.version || ""),
      LOCKED_RE,
      `${name} lockfile version must stay on 1.6.x (got ${JSON.stringify(entry.version)})`,
    );
  }

  console.log("better-auth family pin verified");
});
