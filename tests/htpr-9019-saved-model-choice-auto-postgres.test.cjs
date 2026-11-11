const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { Client } = require("pg");
const fs = require("node:fs");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

function run(args) {
  const result = spawnSync("docker", args, { encoding: "utf8", timeout: 60000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

async function connect(container) {
  const port = Number(run(["port", container, "5432/tcp"]).split(":").at(-1));
  const client = new Client({ host: "127.0.0.1", port, user: "postgres", database: "postgres", query_timeout: 30000 });
  await client.connect();
  return {
    async query(sql) {
      let result = await client.query(sql);
      if (Array.isArray(result)) result = result.at(-1);
      return result.command === "SELECT"
        ? result.rows.map((row) => Object.values(row).map((value) => value !== null && typeof value === "object" ? JSON.stringify(value) : value).join("|")).join("\n")
        : `${result.command} ${result.rowCount}`;
    },
    close: () => client.end(),
  };
}

const sql = (strings, values) => strings.reduce((text, part, index) => {
  if (index < values.length) assert.ok(Number.isInteger(values[index]));
  return text + part + (index < values.length ? values[index] : "");
}, "");

test("real saved-choice switch backs up exact JSON paths, rolls back failures and preserves later choices", { timeout: 120000 }, async () => {
  const container = `htpr-9019-${process.pid}-${Date.now()}`;
  let db;
  try {
    run(["run", "-d", "--rm", "--name", container, "-p", "127.0.0.1::5432", "--user", "postgres", "--tmpfs", "/tmp:rw,mode=1777",
      process.env.HTPR_PG_IMAGE || "ghcr.io/hypertask-ai/ci-postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea", "tail", "-f", "/dev/null"]);
    run(["exec", container, "sh", "-c", "initdb -D /tmp/db -A trust >/dev/null && pg_ctl -D /tmp/db -l /tmp/log -o \"-c listen_addresses='*' -k /tmp\" -w start >/dev/null"]);
    db = await connect(container);
    await db.query('CREATE TABLE "UserSetting" ("userId" int PRIMARY KEY, "aiModelPreferences" jsonb); CREATE TABLE htpr_7038_model_choice_reset_done(user_id int PRIMARY KEY)');
    await db.query(fs.readFileSync("src/prisma/migrations/20261110140000_htpr_9019_saved_model_choice_auto/migration.sql", "utf8"));
    const original = { aiChat: "old-chat", taskWriter: "old-writer", writeWithAi: "old-write", improveWriting: "old-improve", askAi: "old-ask", imageGeneration: "keep-image", thinking: { mode: "high" }, teams: { 'odd.team,{"': { aiChat: "team-pick", imageGeneration: "team-image" }, broken: null } };
    await db.query(`INSERT INTO "UserSetting" VALUES (1, '${JSON.stringify(original)}'::jsonb), (2, '{}'::jsonb)`);
    let enabled = false, baseEnabled = true, failCache = false;
    const prisma = {
      htpr7038ModelChoiceResetDone: { findUnique: async ({ where }) => (await db.query(`SELECT user_id FROM htpr_7038_model_choice_reset_done WHERE user_id=${where.userId}`)) ? { userId: where.userId } : null },
      htpr9019ModelChoiceAutoDone: { findUnique: async ({ where }) => (await db.query(`SELECT user_id FROM htpr_9019_model_choice_auto_done WHERE user_id=${where.userId}`)) ? { userId: where.userId } : null },
      $transaction: async (callback) => {
        await db.query("BEGIN");
        try {
          const result = await callback({
            $queryRaw: (parts, ...values) => db.query(sql(parts, values)),
            $executeRaw: async (parts, ...values) => Number(/UPDATE (\d+)/.exec(await db.query(sql(parts, values)))?.[1] ?? 0),
            htpr9019ModelChoiceAutoDone: { createMany: async ({ data }) => ({ count: Number(/INSERT (\d+)/.exec(await db.query(`INSERT INTO htpr_9019_model_choice_auto_done(user_id) VALUES (${data.userId}) ON CONFLICT DO NOTHING`))?.[1] ?? 0) }) },
          });
          await db.query("COMMIT");
          return result;
        } catch (error) { await db.query("ROLLBACK"); throw error; }
      },
    };
    const { ensureHtpr9019ModelChoiceAuto: switchChoices } = loadModule("src/lib/ai/htpr9019ModelChoiceAuto.ts", {
      react: { cache: (fn) => fn }, "@/lib/prisma": { default: prisma },
      "@/lib/flags": { isFeatureEnabled: async (key) => key === "htpr-7915-auto-model" ? baseEnabled : enabled },
      "@/lib/redis": { getRedis: async () => ({ setex: async () => { if (failCache) throw new Error("cache unavailable"); } }) },
    });
    const preferences = async () => JSON.parse(await db.query('SELECT "aiModelPreferences" FROM "UserSetting" WHERE "userId"=1'));
    assert.equal(await switchChoices(1), "done");
    assert.deepEqual(await preferences(), original);
    enabled = true;
    baseEnabled = false;
    assert.equal(await switchChoices(1), "done");
    assert.deepEqual(await preferences(), original);
    baseEnabled = true;
    failCache = true;
    assert.equal(await switchChoices(1), "failed");
    assert.deepEqual(await preferences(), original);
    assert.equal(await db.query("SELECT count(*) FROM htpr_9019_model_choice_backup"), "0");
    failCache = false;
    const { ensureHtpr7038ModelReset: reset } = loadModule("src/lib/ai/htpr7038ModelReset.ts", {
      react: { cache: (fn) => fn }, "@/lib/prisma": { default: prisma },
      "@/lib/ai/htpr9019ModelChoiceAuto": { ensureHtpr9019ModelChoiceAuto: switchChoices },
    });
    assert.equal(await reset(1), "done");
    const expected = { ...original, aiChat: "auto", taskWriter: "auto", writeWithAi: "auto", improveWriting: "auto", askAi: "auto", teams: { ...original.teams, 'odd.team,{"': { aiChat: "auto", imageGeneration: "team-image" } } };
    assert.deepEqual(await preferences(), expected);
    const backups = JSON.parse(await db.query("SELECT jsonb_agg(jsonb_build_object('path', location::jsonb, 'value', previous_value)) FROM htpr_9019_model_choice_backup"));
    assert.equal(backups.length, 6);
    for (const backup of backups) assert.equal(backup.path.reduce((value, key) => value[key], original), backup.value);
    await db.query(`UPDATE "UserSetting" SET "aiModelPreferences" = jsonb_set("aiModelPreferences", '{aiChat}', '"later-choice"') WHERE "userId"=1`);
    assert.equal(await switchChoices(1), "done");
    assert.equal((await preferences()).aiChat, "later-choice");
    assert.equal(await switchChoices(2), "done");
    assert.equal(await db.query("SELECT count(*) FROM htpr_7038_model_choice_reset_done"), "2");
    await db.query(fs.readFileSync("scripts/htpr-9019-undo-model-choice-auto.sql", "utf8"));
    assert.deepEqual(await preferences(), { ...original, aiChat: "later-choice" });
  } finally {
    await db?.close();
    spawnSync("docker", ["rm", "-f", container], { stdio: "ignore", timeout: 10000 });
  }
});
