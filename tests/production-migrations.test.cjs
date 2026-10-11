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
    shouldRunProductionMigrations({
      ...productionEnv,
      PRODUCTION_BRANCH: "release",
      VERCEL_GIT_COMMIT_REF: "release",
    }),
    true,
  );
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
  const deploy = calls.at(-1);
  assert.equal(deploy[0], process.execPath);
  assert.deepEqual(deploy[1], [
    "/repo/node_modules/prisma/build/index.js",
    "migrate",
    "deploy",
  ]);
  assert.equal(deploy[2].env.DATABASE_URL, "postgresql://direct.example/db");
  assert.equal(deploy[2].env.DIRECT_URL, "postgresql://direct.example/db");
});

test("HTPR-7076: a failed retryable migration is marked rolled back before deploy", async () => {
  const { runProductionMigrations, RETRY_FAILED_MIGRATIONS } = await runnerModule;
  const calls = [];

  const result = runProductionMigrations({
    env: { ...productionEnv, DIRECT_URL: "postgresql://direct.example/db" },
    cwd: "/repo",
    spawnSyncImpl: (...args) => {
      calls.push(args[1].slice(1));
      // Prisma refuses resolve when the migration is not failed; deploy must still run.
      return { status: args[1][2] === "resolve" ? 1 : 0 };
    },
  });

  assert.deepEqual(result, { status: "deployed" });
  assert.deepEqual(RETRY_FAILED_MIGRATIONS, ["20261011010000_htpr_7076_ai_usage_cache_tokens"]);
  assert.deepEqual(calls, [
    ["migrate", "resolve", "--rolled-back", "20261011010000_htpr_7076_ai_usage_cache_tokens"],
    ["migrate", "deploy"],
  ]);
});

test("HTPR-7076: the cache columns migration is safe to re-run and does not queue on the table lock", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const sql = fs.readFileSync(
    path.join(__dirname, "../src/prisma/migrations/20261011010000_htpr_7076_ai_usage_cache_tokens/migration.sql"),
    "utf8",
  );
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "cachedInputTokens" INTEGER/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "cacheWriteInputTokens" INTEGER/);
  assert.match(sql, /set_config\('lock_timeout', '2s', true\)/);
  assert.match(sql, /WHEN lock_not_available/);
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
