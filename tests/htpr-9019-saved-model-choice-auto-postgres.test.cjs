const assert = require("node:assert/strict");
const { spawnSync, execFileSync } = require("node:child_process");
const { Client } = require("pg");
const { NextRequest } = require("next/server");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const fs = require("node:fs");
const test = require("node:test");
const { loadModule } = require("./helpers/loadModule.cjs");

const run = (args) => execFileSync("docker", args, { encoding: "utf8", timeout: 60000 }).trim();

test("real Prisma reset backs up exact JSON, retries failures, sweeps dormant accounts and preserves later picks", { timeout: 120000 }, async () => {
  const container = `htpr-9019-${process.pid}-${Date.now()}`;
  let db, prisma;
  try {
    run(["run", "-d", "--rm", "--name", container, "-p", "127.0.0.1::5432", "--user", "postgres", "--tmpfs", "/tmp:rw,mode=1777",
      process.env.HTPR_PG_IMAGE || "ghcr.io/hypertask-ai/ci-postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea", "tail", "-f", "/dev/null"]);
    run(["exec", container, "sh", "-c", "initdb -D /tmp/db -A trust >/dev/null && echo 'host all all 0.0.0.0/0 trust' >> /tmp/db/pg_hba.conf && pg_ctl -D /tmp/db -l /tmp/log -o \"-c listen_addresses='*' -k /tmp\" -w start >/dev/null"]);
    const connectionString = `postgresql://postgres@127.0.0.1:${run(["port", container, "5432/tcp"]).split(":").at(-1)}/postgres`;
    db = new Client({ connectionString, query_timeout: 30000 });
    await db.connect();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    const scalar = async (sql, values = []) => Object.values((await db.query(sql, values)).rows[0])[0];
    const preferences = (id = 1) => scalar('SELECT "aiModelPreferences" FROM "UserSetting" WHERE "userId"=$1', [id]);
    const backup = (id = 1) => scalar('SELECT previous_preferences FROM htpr_9019_model_choice_auto_done WHERE user_id=$1', [id]);
    await db.query('CREATE TABLE "UserSetting" ("userId" int PRIMARY KEY, "aiModelPreferences" jsonb); CREATE TABLE htpr_7038_model_choice_reset_done(user_id int PRIMARY KEY)');
    await db.query(fs.readFileSync("src/prisma/migrations/20261110140000_htpr_9019_saved_model_choice_auto/migration.sql", "utf8"));
    const original = { aiChat: "old-chat", taskWriter: "old-writer", writeWithAi: "old-write", improveWriting: "old-improve", askAi: "old-ask", imageGeneration: "keep-image", thinking: { mode: "high" }, teams: { 'odd.team,{"': { aiChat: "team-pick", imageGeneration: "team-image" }, broken: null } };
    await db.query('INSERT INTO "UserSetting" VALUES (1, $1), (2, $1), (3, \'{}\')', [original]);
    let enabled = false, baseEnabled = true, failCache = false, everyone = false;
    const { ensureHtpr9019ModelChoiceAuto: switchChoices, sweepHtpr9019ModelChoices: sweep } = loadModule("src/lib/ai/htpr9019ModelChoiceAuto.ts", {
      react: { cache: (fn) => fn }, "@/lib/prisma": { default: prisma },
      "@/lib/flags": {
        isFeatureEnabled: async (key) => key === "htpr-7915-auto-model" ? baseEnabled : enabled,
        featureFlagCandidateUserIds: async (key) => key === "htpr-7915-auto-model" ? (baseEnabled ? null : []) : (everyone ? null : [1]),
      },
      "@/lib/redis": { getRedis: async () => ({ setex: async () => { if (failCache) throw new Error("cache unavailable"); } }) },
    });
    for (const [flag, base, cacheFailure, result] of [[false, true, false, "done"], [true, false, false, "done"], [true, true, true, "failed"]]) {
      enabled = flag; baseEnabled = base; failCache = cacheFailure;
      assert.equal(await switchChoices(1), result);
      assert.deepEqual(await preferences(), original);
      assert.equal(await scalar("SELECT count(*) FROM htpr_9019_model_choice_auto_done"), "0");
    }
    failCache = false;
    const { ensureHtpr7038ModelReset: reset } = loadModule("src/lib/ai/htpr7038ModelReset.ts", {
      react: { cache: (fn) => fn }, "@/lib/prisma": { default: prisma },
      "@/lib/ai/htpr9019ModelChoiceAuto": { ensureHtpr9019ModelChoiceAuto: switchChoices },
    });
    assert.equal(await reset(1), "done");
    const expected = { ...original, aiChat: "auto", taskWriter: "auto", writeWithAi: "auto", improveWriting: "auto", askAi: "auto", teams: { ...original.teams, 'odd.team,{"': { aiChat: "auto", imageGeneration: "team-image" } } };
    assert.deepEqual(await preferences(), expected);
    assert.deepEqual(await backup(), original);
    for (const choice of ["later-choice", "auto"]) {
      await db.query('UPDATE "UserSetting" SET "aiModelPreferences" = jsonb_set("aiModelPreferences", \'{aiChat}\', $1) WHERE "userId"=1', [JSON.stringify(choice)]);
      assert.equal(await switchChoices(1), "done");
      assert.equal((await preferences()).aiChat, choice);
    }
    assert.equal(await switchChoices(2), "switched");
    assert.equal(await switchChoices(3), "done");
    assert.equal(await scalar("SELECT count(*) FROM htpr_7038_model_choice_reset_done"), "3");
    await db.query('INSERT INTO "UserSetting" VALUES (4, $1), (5, $1)', [original]);
    assert.deepEqual(await sweep(), { skipped: "waiting for Everyone" });
    assert.equal(await scalar("SELECT count(*) FROM htpr_9019_model_choice_auto_done"), "3");
    everyone = true; baseEnabled = false;
    assert.deepEqual(await sweep(), { skipped: "waiting for Everyone" });
    baseEnabled = true; failCache = true;
    assert.deepEqual(await sweep(), { scanned: 2, switched: 0, failed: [4, 5], remaining: 2 });
    assert.equal(await scalar("SELECT count(*) FROM htpr_9019_model_choice_auto_done"), "3");
    failCache = false;
    assert.deepEqual(await sweep(), { scanned: 2, switched: 2, failed: [], remaining: 0 });
    assert.deepEqual(await preferences(4), expected);
    assert.deepEqual(await backup(4), original);
    await db.query('UPDATE "UserSetting" SET "aiModelPreferences" = jsonb_set("aiModelPreferences", \'{aiChat}\', \'"dormant-later-choice"\') WHERE "userId"=4');
    assert.deepEqual(await sweep(), { scanned: 0, switched: 0, failed: [], remaining: 0 });
    assert.equal((await preferences(4)).aiChat, "dormant-later-choice");
    assert.deepEqual(await backup(4), original);
    await db.query('INSERT INTO "UserSetting" SELECT id, \'{}\'::jsonb FROM generate_series(6, 106) id');
    assert.deepEqual(await sweep(), { scanned: 100, switched: 0, failed: [], remaining: 1 });
    assert.deepEqual(await sweep(), { scanned: 1, switched: 0, failed: [], remaining: 0 });
    assert.equal(await scalar("SELECT count(*) FROM htpr_9019_model_choice_auto_done"), "106");
    await db.query(fs.readFileSync("scripts/htpr-9019-undo-model-choice-auto.sql", "utf8"));
    assert.deepEqual(await preferences(), expected, "later explicit Auto is not migration-owned");
    assert.deepEqual(await preferences(2), original, "untouched migration-owned choices are restored");
    assert.equal((await preferences(4)).aiChat, "dormant-later-choice");
  } finally {
    await Promise.all([prisma?.$disconnect(), db?.end()]);
    spawnSync("docker", ["rm", "-f", container], { stdio: "ignore", timeout: 10000 });
  }
});

test("saved-model cron rejects missing, wrong and unconfigured credentials but allows the scheduler", async () => {
  const before = process.env.CRON_SECRET;
  let calls = 0;
  const result = { scanned: 100, switched: 12, failed: [], remaining: 1141 };
  const { GET } = loadModule("src/app/api/cron/saved-model-auto/route.ts", {
    "@/lib/ai/htpr9019ModelChoiceAuto": { sweepHtpr9019ModelChoices: async () => { calls++; return result; } },
  });
  try {
    for (const [secret, token, status, expectedCalls] of [["secret", undefined, 401, 0], ["secret", "wrong", 401, 0], ["secret", "secret", 200, 1], [undefined, "undefined", 401, 1]]) {
      if (secret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = secret;
      const response = await GET(new NextRequest("https://app.hypertask.ai/api/cron/saved-model-auto", { headers: token ? { authorization: `Bearer ${token}` } : {} }));
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), status === 200 ? result : { error: "unauthorized" });
      assert.equal(calls, expectedCalls);
    }
  } finally {
    if (before === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = before;
  }
});
