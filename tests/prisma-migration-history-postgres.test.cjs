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
const ticketIdentityRepairMigration = path.join(
  root,
  "src",
  "prisma",
  "migrations",
  "20260904132500_repair_cross_board_ticket_numbers",
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

function runPsql(container, sql) {
  return run(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "ht",
      "-d",
      "ht_migrations",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
    ],
    { input: sql },
  );
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

      const seedTicketIdentities = runPsql(
        container,
        `
          INSERT INTO "User" ("id", "uid", "email")
          VALUES (910001, 'htpr-6121-user', 'htpr-6121@example.test');

          INSERT INTO "Project" ("id", "name", "ownerId", "uniqueIdentifier")
          VALUES
            (910001, 'HTPR-6121 canonical board', 910001, ' INNE '),
            (910002, 'HTPR-6121 no-prefix board', 910001, NULL),
            (910003, 'HTPR-6121 blank-prefix board', 910001, '   ');

          INSERT INTO "Task" (
            "id", "uniqueIndex", "ticketNumber", "section", "title",
            "description", "projectId", "userId", "updatedAt"
          )
          VALUES
            (912101, 1668, 'INAI-19', 'Todo', 'stale', '', 910001, 910001, TIMESTAMP '2026-01-01 00:00:00'),
            (912102, 1669, 'INNE-1669', 'Todo', 'canonical', '', 910001, 910001, TIMESTAMP '2026-01-01 00:00:00'),
            (912103, 1670, NULL, 'Todo', 'missing', '', 910001, 910001, TIMESTAMP '2026-01-01 00:00:00'),
            (912104, 0, 'OLD-0', 'Todo', 'invalid index', '', 910001, 910001, TIMESTAMP '2026-01-01 00:00:00'),
            (912105, 1, 'OLD-1', 'Todo', 'no prefix', '', 910002, 910001, TIMESTAMP '2026-01-01 00:00:00'),
            (912106, 2, 'OLD-2', 'Todo', 'blank prefix', '', 910003, 910001, TIMESTAMP '2026-01-01 00:00:00');
        `,
      );
      assert.equal(
        seedTicketIdentities.status,
        0,
        commandFailure(seedTicketIdentities),
      );

      const repair = run(
        process.execPath,
        [
          prismaCli,
          "db",
          "execute",
          "--config",
          prismaConfig,
          "--file",
          ticketIdentityRepairMigration,
        ],
        { env },
      );
      assert.equal(repair.status, 0, commandFailure(repair));

      const repairedRows = runPsql(
        container,
        `
          SELECT "id", COALESCE("ticketNumber", '<null>'), xmin::text
          FROM "Task"
          WHERE "id" BETWEEN 912101 AND 912106
          ORDER BY "id";
        `,
      );
      assert.equal(repairedRows.status, 0, commandFailure(repairedRows));
      assert.deepEqual(
        repairedRows.stdout
          .trim()
          .split("\n")
          .map((row) => row.split("|").slice(0, 2).join("|")),
        [
          "912101|INNE-1668",
          "912102|INNE-1669",
          "912103|INNE-1670",
          "912104|OLD-0",
          "912105|OLD-1",
          "912106|OLD-2",
        ],
      );

      const repeatRepair = run(
        process.execPath,
        [
          prismaCli,
          "db",
          "execute",
          "--config",
          prismaConfig,
          "--file",
          ticketIdentityRepairMigration,
        ],
        { env },
      );
      assert.equal(repeatRepair.status, 0, commandFailure(repeatRepair));

      const repeatedRows = runPsql(
        container,
        `
          SELECT "id", COALESCE("ticketNumber", '<null>'), xmin::text
          FROM "Task"
          WHERE "id" BETWEEN 912101 AND 912106
          ORDER BY "id";
        `,
      );
      assert.equal(repeatedRows.status, 0, commandFailure(repeatedRows));
      assert.equal(repeatedRows.stdout, repairedRows.stdout);

      const changedTimestamps = runPsql(
        container,
        `
          SELECT COUNT(*)
          FROM "Task"
          WHERE "id" BETWEEN 912101 AND 912106
            AND "updatedAt" IS DISTINCT FROM TIMESTAMP '2026-01-01 00:00:00';
        `,
      );
      assert.equal(changedTimestamps.status, 0, commandFailure(changedTimestamps));
      assert.equal(changedTimestamps.stdout.trim(), "0");

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
