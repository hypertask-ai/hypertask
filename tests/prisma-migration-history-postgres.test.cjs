const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const prismaCli = path.join(
  root,
  "node_modules",
  "prisma",
  "build",
  "index.js",
);
const schema = path.join(root, "src", "prisma", "schema.prisma");
const prismaConfig = path.join(root, "prisma.config.ts");
const catchupMigration = path.join(
  root,
  "src",
  "prisma",
  "migrations",
  "20260825160000_reconcile_migration_history",
  "migration.sql",
);
const image = process.env.HTPR_PG_IMAGE || "postgres:16-alpine";
const requirePostgres = process.env.HT_REQUIRE_PG_TESTS === "1";

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    ...options,
  });
}

function commandFailure(result) {
  return [result.error?.message, result.stdout, result.stderr]
    .filter(Boolean)
    .join("\n")
    .trim();
}

function dockerAvailable() {
  const result = run("docker", [
    "version",
    "--format",
    "{{.Server.Version}}",
  ]).stdout;
  return result?.trim().length > 0;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function waitForPostgres(container) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const result = run("docker", [
      "exec",
      container,
      "pg_isready",
      "-U",
      "ht",
      "-d",
      "ht_migrations",
    ]);
    if (result.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.fail("throwaway PostgreSQL did not become ready within 30 seconds");
}

test(
  "migration history matches the current Prisma schema",
  { timeout: 180_000 },
  async (t) => {
    if (!dockerAvailable()) {
      if (requirePostgres) assert.fail("Docker is required for this test");
      t.skip("Docker is unavailable");
      return;
    }

    const port = await freePort();
    const container = `htpr5655-migrations-${process.pid}-${Date.now()}`;
    const databaseUrl = `postgresql://ht:ht@127.0.0.1:${port}/ht_migrations`;
    const env = {
      ...process.env,
      DATABASE_URL: databaseUrl,
      DIRECT_URL: databaseUrl,
    };

    try {
      const start = run("docker", [
        "run",
        "-d",
        "--name",
        container,
        "-e",
        "POSTGRES_USER=ht",
        "-e",
        "POSTGRES_PASSWORD=ht",
        "-e",
        "POSTGRES_DB=ht_migrations",
        "-p",
        `127.0.0.1:${port}:5432`,
        image,
      ]);
      assert.equal(start.status, 0, commandFailure(start));
      await waitForPostgres(container);

      const deploy = run(
        process.execPath,
        [
          prismaCli,
          "migrate",
          "deploy",
          "--config",
          prismaConfig,
          "--schema",
          schema,
        ],
        { env },
      );
      assert.equal(deploy.status, 0, commandFailure(deploy));

      const repeat = run(
        process.execPath,
        [
          prismaCli,
          "db",
          "execute",
          "--config",
          prismaConfig,
          "--file",
          catchupMigration,
        ],
        { env },
      );
      assert.equal(
        repeat.status,
        0,
        `Catch-up migration is not safe on the current schema:\n${commandFailure(repeat)}`,
      );

      const diff = run(
        process.execPath,
        [
          prismaCli,
          "migrate",
          "diff",
          "--config",
          prismaConfig,
          "--from-config-datasource",
          "--to-schema",
          schema,
          "--exit-code",
        ],
        { env },
      );
      assert.equal(
        diff.status,
        0,
        `Committed migrations differ from schema.prisma:\n${commandFailure(diff)}`,
      );

      console.log("migration history matches the current Prisma schema");
    } finally {
      run("docker", ["rm", "-f", container]);
    }
  },
);
