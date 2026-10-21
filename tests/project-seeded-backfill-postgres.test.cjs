const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const migration = path.join(root, "src/prisma/migrations/20261017130000_htpr_7287_backfill_project_seeded/migration.sql");
const image = process.env.HTPR_PG_IMAGE || "ghcr.io/hypertask-ai/ci-postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea";
const requirePostgres = process.env.HT_REQUIRE_PG_TESTS === "1";

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    ...options,
  });
}

function checked(result) {
  assert.equal(result.status, 0, [result.error?.message, result.stdout, result.stderr].filter(Boolean).join("\n"));
  return result.stdout.trim();
}

function psql(container, sql) {
  return checked(run("docker", [
    "exec", "-i", container, "psql", "-U", "ht", "-d", "ht_seeded", "-v", "ON_ERROR_STOP=1", "-At",
  ], { input: sql }));
}

async function waitForPostgres(container) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (run("docker", ["exec", container, "pg_isready", "-U", "ht", "-d", "ht_seeded"]).status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.fail("throwaway PostgreSQL did not become ready within 30 seconds");
}

test("seeded backfill updates only proven starter and demo boards and is idempotent", { timeout: 180_000 }, async (t) => {
  const docker = run("docker", ["version", "--format", "{{.Server.Version}}"]);
  if (docker.status !== 0 || !docker.stdout?.trim()) {
    if (requirePostgres) assert.fail("Docker is required for this test");
    t.skip("Docker is unavailable");
    return;
  }

  const container = `htpr7287-seeded-${process.pid}-${Date.now()}`;
  try {
    checked(run("docker", [
      "run", "-d", "--name", container,
      "-e", "POSTGRES_USER=ht", "-e", "POSTGRES_PASSWORD=ht", "-e", "POSTGRES_DB=ht_seeded", image,
    ]));
    await waitForPostgres(container);

    const schemaSql = checked(run(process.execPath, [
      path.join(root, "node_modules/prisma/build/index.js"), "migrate", "diff",
      "--config", path.join(root, "prisma.config.ts"),
      "--from-empty", "--to-schema", path.join(root, "src/prisma/schema.prisma"), "--script",
    ], { env: { ...process.env, DATABASE_URL: "postgresql://ht:ht@127.0.0.1:1/ht_seeded", DIRECT_URL: "postgresql://ht:ht@127.0.0.1:1/ht_seeded" } }));
    psql(container, schemaSql);
    psql(container, `
      INSERT INTO "User" ("id", "uid", "email", "joinedAt") VALUES
        (332, 'hyper-ai', 'ai@example.test', '2026-01-01'),
        (1, 'normal', 'normal@example.test', '2026-01-01'),
        (2, 'guest_demo', 'guest@example.test', '2026-10-17 12:00:00'),
        (3, 'exguest_adopted', 'adopted@example.test', '2026-10-17 12:00:00'),
        (4, 'guestXnot-a-guest', 'not-guest@example.test', '2026-01-01'),
        (5, 'exguestXnot-a-guest', 'not-adopted@example.test', '2026-01-01');

      INSERT INTO "Project" ("id", "name", "ownerId", "createdAt") VALUES
        (1, 'starter', 1, '2026-10-17 12:00:00'),
        (2, 'manual', 1, '2026-10-17 12:00:00'),
        (3, 'unproven-old-starter', 1, '2026-10-17 12:00:00'),
        (4, 'late-connect-task', 1, '2026-10-17 12:00:00'),
        (5, 'guest-demo', 2, '2026-10-17 12:00:00'),
        (6, 'adopted-demo', 1, '2026-10-17 12:00:00'),
        (7, 'manual-before-guest', 1, '2026-10-17 11:59:00'),
        (8, 'unescaped-guest-prefix', 4, '2026-10-17 12:00:00'),
        (9, 'unescaped-exguest-prefix', 1, '2026-10-17 12:00:00'),
        (10, 'wrong-connect-creator', 1, '2026-10-17 12:00:00'),
        (11, 'connect-before-board', 1, '2026-10-17 12:00:00'),
        (12, 'guest-before-board', 2, '2026-10-17 12:00:00'),
        (13, 'late-guest-task', 2, '2026-10-17 12:00:00'),
        (14, 'near-match-connect-title', 1, '2026-10-17 12:00:00');

      INSERT INTO "Task" ("id", "uniqueIndex", "section", "description", "projectId", "userId", "title", "createdAt") VALUES
        (1, 1, 'Todo', '', 1, 332, 'Connect Hypertask to Claude or ChatGPT', '2026-10-17 12:00:00'),
        (2, 1, 'Todo', '', 2, 1, 'Ordinary task', '2026-10-17 12:00:00'),
        (3, 1, 'Todo', '', 3, 332, 'Other starter task', '2026-10-17 12:00:00'),
        (4, 1, 'Todo', '', 4, 332, 'Connect Hypertask to Claude or ChatGPT', '2026-10-17 14:00:00'),
        (5, 1, 'Todo', '', 5, 2, 'Demo task', '2026-10-17 12:10:00'),
        (6, 1, 'Todo', '', 6, 3, 'Adopted task', '2026-10-17 12:00:01'),
        (7, 1, 'Todo', '', 7, 2, 'Later guest contribution', '2026-10-17 12:00:01'),
        (8, 1, 'Todo', '', 8, 4, 'Not a guest task', '2026-10-17 12:00:00'),
        (9, 1, 'Todo', '', 9, 5, 'Not an adopted guest task', '2026-10-17 12:00:00'),
        (10, 1, 'Todo', '', 10, 1, 'Connect Hypertask to Claude or ChatGPT', '2026-10-17 12:00:00'),
        (11, 1, 'Todo', '', 11, 332, 'Connect Hypertask to Claude or ChatGPT', '2026-10-17 11:59:59'),
        (12, 1, 'Todo', '', 12, 2, 'Demo task before board', '2026-10-17 11:59:59'),
        (13, 1, 'Todo', '', 13, 2, 'Demo task too late', '2026-10-17 12:10:00.001'),
        (14, 1, 'Todo', '', 14, 332, 'Connect Hypertask to Claude or ChatGPT!', '2026-10-17 12:00:00');
    `);

    const stateSql = 'SELECT "id", "seeded", xmin::text FROM "Project" ORDER BY "id";';
    const before = psql(container, stateSql);
    assert.ok(before.split("\n").every((row) => row.split("|")[1] === "f"));
    const migrationSql = fs.readFileSync(migration, "utf8");
    const firstRun = psql(container, migrationSql);
    const after = psql(container, stateSql);
    const expected = Array.from({ length: 14 }, (_, i) => `${i + 1}|${[1, 5, 6].includes(i + 1) ? "t" : "f"}`);
    assert.deepEqual(after.split("\n").map((row) => row.split("|").slice(0, 2).join("|")), expected);
    assert.equal(firstRun, "UPDATE 3");
    for (const row of before.split("\n")) {
      if (![1, 5, 6].includes(Number(row.split("|")[0]))) assert.ok(after.split("\n").includes(row));
    }

    assert.equal(psql(container, migrationSql), "UPDATE 0");
    assert.equal(psql(container, stateSql), after);
  } finally {
    run("docker", ["rm", "-f", container]);
  }
});
