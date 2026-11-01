const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { readFileSync, existsSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const yaml = require("js-yaml");
const pg = require("pg");

const root = path.resolve(__dirname, "..");
const load = () => import("../scripts/schema-drift-check.mjs");
const postgresUrlPrefix = "postgresql://";
const env = {
  SCHEMA_READER_DATABASE_URL: `${postgresUrlPrefix}fixture:not-a-secret%21@example.invalid/app`,
  SCHEMA_SHADOW_DATABASE_URL: "postgresql://ht:ht@127.0.0.1:5432/shadow",
};

function fakeClients(relations = []) {
  const clients = [];
  class Client {
    constructor(options) { this.options = options; this.queries = []; clients.push(this); }
    async connect() {}
    async end() { this.ended = true; }
    async query(sql) {
      this.queries.push(sql);
      return { rows: sql.includes("SELECT c.oid") ? relations : [] };
    }
  }
  return { Client, clients };
}

test("reports clean, named drift and failed comparisons distinctly, always cleans the local snapshot", async () => {
  const { checkDrift } = await load();
  for (const status of [0, 2, 1, null]) {
    const { Client, clients } = fakeClients();
    const messages = [];
    let config;
    const run = checkDrift({ env, Client, log: (s) => messages.push(s), spawn: (command, args, options) => {
      config = args[args.indexOf("--config") + 1];
      assert.ok(existsSync(config));
      assert.ok(args.includes("--exit-code"));
      assert.ok(args.includes("--from-migrations"));
      assert.ok(args.includes("--to-config-datasource"));
      assert.ok(!args.some((arg) => arg.includes("not-a-secret")));
      assert.ok(!readFileSync(config, "utf8").includes("postgresql://"));
      assert.equal(options.env.SCHEMA_READER_DATABASE_URL, env.SCHEMA_READER_DATABASE_URL);
      return { status, stdout: status === 2 ? '[*] Changed the `AiUsage` table\n  [*] Altered column `userId` (changed from Nullable to Required)' : "No difference.", stderr: env.SCHEMA_READER_DATABASE_URL };
    } });
    if ([0, 2].includes(status)) assert.equal(await run, status);
    else await assert.rejects(run, /comparison failed/);
    assert.ok(messages.every((s) => !s.includes("not-a-secret") && !s.includes("postgresql://")));
    if (status === 2) assert.ok(messages.some((s) => s.includes("AiUsage.userId")));
    assert.match(clients[0].queries[0], /REPEATABLE READ READ ONLY/);
    assert.ok(clients[0].queries.every((q) => /^(BEGIN|COMMIT|\s*SELECT)/.test(q)));
    assert.ok(clients[1].queries.some((q) => q.startsWith("DROP DATABASE")));
    assert.ok(clients.every((c) => c.ended));
    assert.ok(!existsSync(config));
  }
});

test("configuration errors fail closed and never connect to a remote shadow", async () => {
  const { checkDrift, redact } = await load();
  await assert.rejects(checkDrift({ env: {} }), /are required/);
  await assert.rejects(checkDrift({ env: { ...env, SCHEMA_SHADOW_DATABASE_URL: env.SCHEMA_READER_DATABASE_URL } }), /disposable local/);
  assert.equal(redact("invalid-connection", ["invalid-connection"]), "[DATABASE_URL]");
  const text = redact(`${env.SCHEMA_READER_DATABASE_URL} not-a-secret%21 not-a-secret! ${postgresUrlPrefix}fixture:not-a-secret@example.invalid/db`, [env.SCHEMA_READER_DATABASE_URL]);
  assert.ok(!/not-a-secret|postgresql/.test(text));
});

test("unsupported schema kinds fail visibly instead of silently reporting clean", async () => {
  const { catalogSchema } = await load();
  const { Client } = fakeClients([{ relname: "partition", relkind: "p" }]);
  await assert.rejects(catalogSchema(new Client({})), /incomplete schema audit/);
});

test("catalog snapshot retains FKs backed by unique indexes and skips only documented legacy objects", async () => {
  const { catalogSchema } = await load();
  const queries = [];
  const client = { query: async (sql) => {
    queries.push(sql);
    if (sql.includes("SELECT c.oid")) return { rows: ["Cycle", "Task", "AiUsage", "UserSetting", "AI_Knowledge_Source"].map((relname) => ({ relname, relkind: "r" })) };
    if (sql.includes("a.attname")) return { rows: [
      { relname: "AiUsage", attname: "cacheReadInputTokens", type: "integer", attnotnull: true },
      { relname: "AiUsage", attname: "cacheWriteInputTokens", type: "integer", attnotnull: true, default_expr: "0" },
      { relname: "UserSetting", attname: "savedCrossBoardViews", type: "jsonb" },
    ] };
    if (sql.includes("con.conname")) return { rows: [{ relname: "Task", conname: "Task_cycle_fkey", contype: "f", definition: 'FOREIGN KEY ("cycleId") REFERENCES "Cycle" ("id")' }] };
    if (sql.includes("pg_get_indexdef")) return { rows: [{ relname: "Cycle", definition: 'CREATE UNIQUE INDEX "Cycle_id_key" ON "Cycle" ("id")' }] };
    return { rows: [] };
  } };
  const ddl = await catalogSchema(client, { log: () => {} });
  assert.ok(!ddl.includes("cacheReadInputTokens"));
  assert.ok(!ddl.includes("savedCrossBoardViews"));
  assert.ok(!ddl.includes("AI_Knowledge_Source"));
  assert.ok(ddl.includes('"cacheWriteInputTokens" integer DEFAULT 0 NOT NULL'));
  assert.ok(ddl.indexOf("CREATE UNIQUE INDEX") < ddl.indexOf("FOREIGN KEY"));
  assert.ok(queries.some((sql) => sql.includes("con.contype IN ('p','u','x')")));
  const full = await catalogSchema(client, { includeLegacy: true });
  assert.ok(full.includes("cacheReadInputTokens") && full.includes("savedCrossBoardViews") && full.includes("AI_Knowledge_Source"));
});

test("workflow is production-only, least-privilege monitoring, not a required check", () => {
  const workflow = yaml.load(readFileSync(path.join(root, ".github/workflows/schema-drift.yml"), "utf8"));
  assert.ok(workflow.on.schedule[0].cron && "workflow_dispatch" in workflow.on && "deployment_status" in workflow.on);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.equal(workflow.jobs.drift["runs-on"], "ubuntu-latest");
  assert.match(workflow.jobs.drift.if, /deployment_status.state == 'success'/);
  assert.match(workflow.jobs.drift.if, /deployment.environment == 'Production'/);
  assert.match(workflow.jobs.drift.if, /github.ref == 'refs\/heads\/production'/);
  const checkout = workflow.jobs.drift.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  assert.equal(checkout.with.ref, "production");
  assert.equal(checkout.with["persist-credentials"], false);
  assert.ok(workflow.jobs.drift.services.postgres);
  const policy = yaml.load(readFileSync(path.join(root, "docs/ci-policy.yml"), "utf8"));
  assert.equal(policy.schema_drift_monitor.required_check, false);
  assert.ok(!policy.required_checks.contexts.includes("Production Schema Drift"));
});

test("disposable PostgreSQL positive control and cache-column repair", { timeout: 240_000 }, async (t) => {
  const databaseUrl = process.env.SCHEMA_DRIFT_TEST_DATABASE_URL;
  const shadowUrl = process.env.SCHEMA_DRIFT_TEST_SHADOW_URL;
  if (!databaseUrl || !shadowUrl) { t.skip("Set disposable local SCHEMA_DRIFT_TEST_DATABASE_URL and SCHEMA_DRIFT_TEST_SHADOW_URL"); return; }
  assert.equal(new URL(databaseUrl).hostname, "127.0.0.1");
  const { checkDrift, redact } = await load();
  const deploy = spawnSync(process.execPath, [path.join(root, "node_modules/prisma/build/index.js"), "migrate", "deploy"], { cwd: root, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: "utf8", timeout: 180_000 });
  assert.equal(deploy.status, 0, redact(`${deploy.stdout}\n${deploy.stderr}`, [databaseUrl]));
  console.log("All committed migrations deployed: exit=0");
  const admin = new pg.Client({ connectionString: databaseUrl });
  await admin.connect();
  try {
    await admin.query(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='drift_test_reader') THEN CREATE ROLE drift_test_reader LOGIN PASSWORD 'test-only' NOSUPERUSER NOCREATEDB NOCREATEROLE; END IF; END $$;
      GRANT CONNECT ON DATABASE "${new URL(databaseUrl).pathname.slice(1)}" TO drift_test_reader;
      GRANT USAGE ON SCHEMA public TO drift_test_reader;
      GRANT SELECT ON public."_prisma_migrations" TO drift_test_reader;
      ALTER ROLE drift_test_reader SET default_transaction_read_only=on;`);
    const readerUrl = new URL(databaseUrl); readerUrl.username = "drift_test_reader"; readerUrl.password = "test-only";
    const reader = new pg.Client({ connectionString: readerUrl.href });
    await reader.connect();
    try {
      await assert.rejects(reader.query('SELECT "id" FROM "Task" WHERE false'), /permission denied/);
      await assert.rejects(reader.query('DELETE FROM "_prisma_migrations" WHERE false'), /read-only transaction/);
    } finally { await reader.end(); }
    const runEnv = { ...process.env, SCHEMA_READER_DATABASE_URL: readerUrl.href, SCHEMA_SHADOW_DATABASE_URL: shadowUrl };
    await admin.query('ALTER TABLE "AiUsage" ALTER COLUMN "userId" SET NOT NULL');
    const failed = spawnSync(process.execPath, [path.join(root, "scripts/schema-drift-check.mjs")], { env: runEnv, encoding: "utf8", timeout: 180_000 });
    assert.equal(failed.status, 2, redact(`${failed.stdout}\n${failed.stderr}`, [readerUrl.href, shadowUrl]));
    const line = failed.stdout.split("\n").find((s) => s.includes("Schema drift: AiUsage.userId"));
    assert.ok(line);
    console.log(`Positive control: exit=${failed.status}; ${line}`);
    await admin.query('ALTER TABLE "AiUsage" ALTER COLUMN "userId" DROP NOT NULL');
    const restored = spawnSync(process.execPath, [path.join(root, "scripts/schema-drift-check.mjs")], { env: runEnv, encoding: "utf8", timeout: 180_000 });
    assert.equal(restored.status, 0, redact(`${restored.stdout}\n${restored.stderr}`, [readerUrl.href, shadowUrl]));
    assert.match(restored.stdout, /Schema drift check: clean\./);
    console.log("Restored userId: exit=0; Schema drift check: clean.");
    await admin.query('ALTER TABLE "AiUsage" ALTER COLUMN "cacheWriteInputTokens" SET NOT NULL, ALTER COLUMN "cacheWriteInputTokens" SET DEFAULT 0');
    const sql = readFileSync(path.join(root, "src/prisma/migrations/20261012130000_yper4_322_schema_drift_repair/migration.sql"), "utf8");
    await admin.query(sql); await admin.query(sql);
    assert.equal(await checkDrift({ env: runEnv, log: () => {} }), 0);
    console.log("Cache drift repaired twice (idempotent): exit=0; Schema drift check: clean.");
  } finally { await admin.end(); }
});
