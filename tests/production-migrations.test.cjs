const assert = require("node:assert/strict");
const test = require("node:test");

const packageJson = require("../package.json");
const runnerModule = import("../scripts/run-production-migrations.mjs");

const productionEnv = {
  VERCEL: "1",
  VERCEL_ENV: "production",
  VERCEL_GIT_COMMIT_REF: "production",
};

test("production build compiles the app before applying migrations", () => {
  assert.deepEqual(packageJson.scripts.build.split(/\s*&&\s*/), [
    "npx prisma generate",
    "next build --webpack",
    "node scripts/run-production-migrations.mjs",
  ]);
});

test("production migration gate runs only for production branch deployments", async () => {
  const { shouldRunProductionMigrations } = await runnerModule;

  assert.equal(shouldRunProductionMigrations(productionEnv), true);
  assert.equal(
    shouldRunProductionMigrations({ ...productionEnv, VERCEL_ENV: "preview" }),
    false,
  );
  assert.throws(
    () =>
      shouldRunProductionMigrations({
        ...productionEnv,
        VERCEL_GIT_COMMIT_REF: "feature-branch",
      }),
    /outside the production branch/,
  );
  assert.throws(
    () =>
      shouldRunProductionMigrations({
        VERCEL: "1",
        VERCEL_ENV: "production",
      }),
    /outside the production branch/,
  );
  assert.equal(shouldRunProductionMigrations({}), false);
});

test("non-production builds skip without invoking Prisma", async () => {
  const { runProductionMigrations } = await runnerModule;
  let invoked = false;

  const result = runProductionMigrations({
    env: { ...productionEnv, VERCEL_ENV: "preview" },
    spawnSyncImpl: () => {
      invoked = true;
      return { status: 0 };
    },
  });

  assert.deepEqual(result, { status: "skipped" });
  assert.equal(invoked, false);
});

test("production builds fail closed without DIRECT_URL", async () => {
  const { runProductionMigrations } = await runnerModule;

  assert.throws(
    () => runProductionMigrations({ env: productionEnv }),
    /DIRECT_URL is required/,
  );
});

test("production builds deploy through the direct database URL", async () => {
  const { runProductionMigrations } = await runnerModule;
  const calls = [];

  const result = runProductionMigrations({
    env: { ...productionEnv, DIRECT_URL: "postgresql://direct.example/db" },
    cwd: "/repo",
    spawnSyncImpl: (...args) => {
      calls.push(args);
      return { status: 0 };
    },
  });

  assert.deepEqual(result, { status: "deployed" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], process.execPath);
  assert.deepEqual(calls[0][1], [
    "/repo/node_modules/prisma/build/index.js",
    "migrate",
    "deploy",
  ]);
  assert.equal(calls[0][2].env.DATABASE_URL, "postgresql://direct.example/db");
  assert.equal(calls[0][2].env.DIRECT_URL, "postgresql://direct.example/db");
});

test("production builds propagate Prisma failures", async () => {
  const { runProductionMigrations } = await runnerModule;

  assert.throws(
    () =>
      runProductionMigrations({
        env: { ...productionEnv, DIRECT_URL: "postgresql://direct.example/db" },
        spawnSyncImpl: () => ({ status: 1 }),
      }),
    /exited with status 1/,
  );
});
