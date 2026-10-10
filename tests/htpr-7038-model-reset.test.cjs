const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const migrations = path.join(root, "src/prisma/migrations");
const migrationName = "20261008120000_htpr_7038_reset_saved_model_choices";
const migration = fs.readFileSync(path.join(migrations, migrationName, "migration.sql"), "utf8");
const undo = fs.readFileSync(path.join(root, "scripts/htpr-7038-undo-model-reset.sql"), "utf8");
const haiku = "claude-haiku-5-5";
const surfaces = ["aiChat", "taskWriter", "writeWithAi", "improveWriting", "askAi"];
const oddTeam = 'team.with,braces{and}"quotes\\slashes';
const fixtures = [
  { aiChat: "luna", writeWithAi: "gemini-3-flash", improveWriting: "claude-haiku-4-5", taskWriter: "custom-endpoint", askAi: "gpt-5", theme: "dark", imageGeneration: "nano-banana" },
  { aiChat: haiku, writeWithAi: null, teams: { alpha: { aiChat: "gemini-3-flash", taskWriter: "luna", improveWriting: haiku, note: { keep: true }, imageGeneration: "flux-2-pro" }, [oddTeam]: { askAi: "luna", writeWithAi: "", other: [1, 2] } }, unrelated: 12 },
  null,
  { aiChat: null, askAi: 17, teams: { broken: "not-an-object", nil: null, array: ["luna"], normal: { aiChat: null, askAi: false } }, extra: { model: "leave-me" } },
  {},
  { teams: null, imageGeneration: "nano-banana" },
  { teams: ["luna"], imageGeneration: "flux-2-pro" },
  "not-an-object",
  ["luna"],
  { aiChat: "anthropic/claude-haiku-5.5", futureSurface: "gemini", teams: { alpha: { writeWithAi: "google/gemini-3-flash", enabled: true } } },
];

function sqlValue(value) {
  return `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
}

function snapshot(label) {
  return `SELECT '${label}:' || jsonb_build_object(
    'settings', (SELECT jsonb_agg(jsonb_build_object('userId', "userId", 'value', "aiModelPreferences", 'xmin', xmin::text) ORDER BY "userId") FROM "UserSetting"),
    'done', (SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY user_id), '[]'::jsonb) FROM htpr_7038_model_choice_reset_done d),
    'backup', (SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY user_id, location), '[]'::jsonb) FROM htpr_7038_model_choice_backup b),
    'outside', jsonb_build_object(
      'team', (SELECT "aiProviderSettings" FROM "Team" WHERE id = 'htpr-7038-team'),
      'board', (SELECT model_selected FROM "AI_Custom_Instructions" WHERE "projectId" = 703801),
      'agent', (SELECT "modelOptionId" FROM "Agent" WHERE id = 'htpr-7038-agent'))
  )::text;`;
}

function expectedReset(values) {
  const result = structuredClone(values);
  const backups = [];
  function reset(object, userId, prefix) {
    if (!object || typeof object !== "object" || Array.isArray(object)) return;
    for (const surface of surfaces) {
      if (typeof object[surface] === "string" && object[surface] !== haiku) {
        backups.push({ userId, path: [...prefix, surface], value: object[surface] });
        object[surface] = haiku;
      }
    }
  }
  result.forEach((value, index) => {
    reset(value, index + 1, []);
    if (value?.teams && typeof value.teams === "object" && !Array.isArray(value.teams)) {
      for (const [teamId, choices] of Object.entries(value.teams)) reset(choices, index + 1, ["teams", teamId]);
    }
  });
  return { values: result, backups };
}

function assertValues(snapshot, expected) {
  assert.deepEqual(snapshot.settings.map((row) => row.value), expected);
}

test("reset oracle rejects changed unrelated keys and missed picker choices", () => {
  const expected = expectedReset(fixtures).values;
  const rows = expected.map((value) => ({ value }));
  assertValues({ settings: rows }, expected);
  const changed = structuredClone(rows);
  changed[0].value.theme = "changed";
  assert.throws(() => assertValues({ settings: changed }, expected), assert.AssertionError);
  const missed = structuredClone(rows);
  missed[1].value.teams.alpha.aiChat = "gemini-3-flash";
  assert.throws(() => assertValues({ settings: missed }, expected), assert.AssertionError);
});


// psql stays in one session per transaction over a network-disabled Unix socket.
// Its output is synthetic test data only and is never included in diagnostics.
function session(container) {
  const child = spawn("docker", ["exec", "-i", container, "sh", "-c",
    "exec psql -X -h /tmp -U postgres -At 2>&1"], { stdio: ["pipe", "pipe", "ignore"] });
  let buffer = "";
  let pending;
  let sequence = 0;
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    if (!pending || !buffer.includes(`${pending.marker}\n`)) return;
    const output = buffer.slice(0, buffer.indexOf(`${pending.marker}\n`));
    buffer = buffer.slice(buffer.indexOf(`${pending.marker}\n`) + pending.marker.length + 1);
    const current = pending;
    pending = undefined;
    clearTimeout(current.timer);
    if (/ERROR:|FATAL:/.test(output)) current.reject(new Error("Disposable SQL statement failed"));
    else current.resolve(output.trim());
  });
  child.on("error", () => pending?.reject(new Error("Disposable psql could not start")));
  child.on("exit", () => pending?.reject(new Error("Disposable psql exited early")));
  return {
    query(sql) {
      assert.equal(pending, undefined, "queries use one session sequentially");
      return new Promise((resolve, reject) => {
        const marker = `HTPR_END_${++sequence}`;
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error("Disposable SQL timed out"));
        }, 30_000);
        pending = { marker, resolve, reject, timer };
        child.stdin.write(`${sql};\n\\echo ${marker}\n`);
      });
    },
    close() { child.stdin.end(); },
  };
}

function rawSql(strings, values) {
  assert.ok(values.every(Number.isInteger), "raw parameters are synthetic integer user IDs");
  return strings.reduce((sql, part, index) => sql + part + (index < values.length ? values[index] : ""), "");
}

function loadReset(prisma, enabled, redis) {
  const source = fs.readFileSync(path.join(root, "src/lib/ai/htpr7038ModelReset.ts"), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const loadedModule = { exports: {} };
  const stubs = {
    react: { cache: (fn) => fn },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
      assert.equal(key, "htpr-7038-reset-saved-model-choices");
      return enabled(userId);
    } },
    "@/lib/flags/keys": { HTPR_7038_RESET_SAVED_MODEL_CHOICES_FLAG: "htpr-7038-reset-saved-model-choices" },
    "@/lib/redis": { getRedis: async () => redis },
  };
  new Function("module", "exports", "require", javascript)(loadedModule, loadedModule.exports, (id) => {
    assert.ok(stubs[id], "reset has only mocked server dependencies");
    return stubs[id];
  });
  return loadedModule.exports.ensureHtpr7038ModelReset;
}

function loadPreferences(reset, prisma, userId) {
  const load = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false });
  const stubs = {
    "@/lib/ai/htpr7038ModelReset": { ensureHtpr7038ModelReset: reset },
    "@/lib/auth/currentUser": { loadCurrentUser: async () => ({ userId, user: { id: userId } }) },
    "@/lib/flags": { isFeatureEnabled: async () => true },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "next/server": { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    "@/lib/mcp/readJsonBody": { readJsonBody: async (request) => ({ ok: true, body: await request.json() }) },
    "@/utils/controllers/users/fetch_preferences": { invalidateUserPreferenceCache: async () => {} },
    "@/lib/aiModelPreferences": load(path.join(root, "src/lib/aiModelPreferences.ts")),
    "@/lib/aiModelOptions": load(path.join(root, "src/lib/aiModelOptions.ts")),
  };
  const loadedModule = { exports: {} };
  const javascript = ts.transpileModule(fs.readFileSync(path.join(root, "src/app/api/users/preferences/route.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("module", "exports", "require", javascript)(loadedModule, loadedModule.exports, (id) => stubs[id] ?? {});
  return loadedModule.exports.POST;
}

function database(container, admin, afterRowLock = async () => {}) {
  let lookups = 0;
  const prisma = {
    htpr7038ModelChoiceResetDone: { findUnique: async ({ where }) => {
      lookups++;
      const value = await admin.query(`SELECT user_id FROM htpr_7038_model_choice_reset_done WHERE user_id = ${where.userId}`);
      return value ? { userId: where.userId } : null;
    } },
    $transaction: async (callback) => {
      const connection = session(container);
      try {
        await connection.query("BEGIN");
        const result = await callback({
          $executeRaw: async (strings, ...values) => {
            const output = await connection.query(rawSql(strings, values));
            return Number(/UPDATE (\d+)/.exec(output)?.[1] ?? 0);
          },
          $queryRaw: async (strings, ...values) => {
            const result = await connection.query(rawSql(strings, values));
            await afterRowLock();
            return result;
          },
          htpr7038ModelChoiceResetDone: { createMany: async ({ data, skipDuplicates }) => {
            assert.equal(skipDuplicates, true);
            const output = await connection.query(`INSERT INTO htpr_7038_model_choice_reset_done(user_id) VALUES (${data.userId}) ON CONFLICT DO NOTHING`);
            return { count: Number(/INSERT 0 (\d+)/.exec(output)?.[1] ?? 0) };
          } },
        });
        await connection.query("COMMIT");
        return result;
      } catch {
        await connection.query("ROLLBACK");
        throw new Error("Disposable reset transaction failed");
      } finally {
        connection.close();
      }
    },
  };
  return { prisma, lookupCount: () => lookups };
}

test("flagged server reset, migration history, exact backups, once-only execution and undo on disposable Postgres", { timeout: 180_000 }, async () => {
  const history = fs.readdirSync(migrations).filter((name) => name < migrationName && fs.existsSync(path.join(migrations, name, "migration.sql"))).sort();
  assert.ok(history.length > 0);
  assert.doesNotMatch(migration, /\b(UPDATE|INSERT|DELETE|DO)\b/, "migration contains no data-changing SQL");
  assert.throws(() => assert.doesNotMatch("UPDATE users SET model = 'haiku'", /\b(UPDATE|INSERT|DELETE|DO)\b/), assert.AssertionError);
  const schemaSql = spawnSync(process.execPath, [
    path.join(root, "node_modules/prisma/build/index.js"), "migrate", "diff",
    "--from-empty", "--to-schema", path.join(root, "src/prisma/schema.prisma"), "--script",
  ], { cwd: root, encoding: "utf8", timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(schemaSql.status, 0, "offline Prisma schema SQL generation failed");
  const container = `htpr-7038-reset-${process.pid}-${Date.now()}`;
  let admin;
  try {
    await new Promise((resolve, reject) => {
      const start = spawn("docker", [
        "run", "--rm", "--name", container, "--network", "none", "--user", "postgres", "--tmpfs", "/tmp:rw,mode=1777",
        "--mount", `type=bind,source=${migrations},target=/migrations,readonly`,
        process.env.HTPR_PG_IMAGE || "ghcr.io/hypertask-ai/ci-postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea", "sh", "-c",
        "initdb -D /tmp/htpr-7038-db -A trust >/dev/null 2>&1 && pg_ctl -D /tmp/htpr-7038-db -l /tmp/postgres.log -o \"-c listen_addresses='' -k /tmp\" -w start >/dev/null && echo HTPR_READY && exec tail -f /dev/null",
      ], { stdio: ["ignore", "pipe", "ignore"] });
      const timer = setTimeout(() => reject(new Error("Disposable PostgreSQL readiness timed out")), 30_000);
      start.stdout.on("data", (chunk) => {
        if (chunk.toString().includes("HTPR_READY")) { clearTimeout(timer); resolve(); }
      });
      start.on("error", () => { clearTimeout(timer); reject(new Error("Disposable PostgreSQL could not start")); });
      start.on("exit", () => { clearTimeout(timer); reject(new Error("Disposable PostgreSQL exited early")); });
    });
    admin = session(container);
    await admin.query(history.map((name) => `\\i /migrations/${name}/migration.sql`).join("\n"));
    await admin.query(undo);
    const seed = fixtures.map((value, index) => `
      INSERT INTO "User" (id, uid, email) VALUES (${index + 1}, 'htpr-7038-${index + 1}', 'fixture-${index + 1}@example.test');
      INSERT INTO "UserSetting" (id, "userId", notification, "aiModelPreferences") VALUES ('setting-${index + 1}', ${index + 1}, true, ${index === 2 ? "NULL" : sqlValue(value)});
    `).join("\n");
    await admin.query(`${seed}
      INSERT INTO "GoogleAccount" (id, "userId", stripe_customer_id) VALUES ('htpr-7038-account', 1, 'fixture-account');
      INSERT INTO "Team" (id, "totalSeats", "googleAccountId", "aiProviderSettings") VALUES ('htpr-7038-team', 1, 'htpr-7038-account', '{"featureModels":{"aiChat":"luna","taskWriter":"gemini-3-flash"},"providers":{"anthropic":{"enabled":false}},"customEndpoint":{"model":"local-model"}}');
      INSERT INTO "Project" (id, name, "ownerId", "teamId") VALUES (703801, 'fixture-board', 1, 'htpr-7038-team');
      INSERT INTO "AI_Custom_Instructions" ("projectId", "customInstruction", model_selected, source_selected) VALUES (703801, 'fixture', 'gemini-3-flash', 'google');
      INSERT INTO "Agent" (id, "displayName", "userId", "modelOptionId") VALUES ('htpr-7038-agent', 'fixture', 1, 'luna')`);
    const before = await admin.query('SELECT jsonb_agg(jsonb_build_object(\'value\', "aiModelPreferences", \'xmin\', xmin::text) ORDER BY "userId") FROM "UserSetting"');
    await admin.query(migration);
    const snap = async () => JSON.parse((await admin.query(snapshot("snapshot"))).split("snapshot:")[1]);
    const migrated = await snap();
    assert.deepEqual(migrated.settings.map(({ value, xmin }) => ({ value, xmin })), JSON.parse(before));
    assert.deepEqual(migrated.backup, []);
    assert.deepEqual(migrated.done, []);

    for (const table of ["htpr_7038_model_choice_backup", "htpr_7038_model_choice_reset_done"]) {
      const ddl = schemaSql.stdout.match(new RegExp(`CREATE TABLE [^;]*${table}[^;]*;`))?.[0];
      assert.ok(ddl, "both reset tables are Prisma-modelled");
      await admin.query(ddl.replaceAll(table, `${table}_expected`));
      const shape = (name) => `SELECT jsonb_agg(jsonb_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod), 'notNull', a.attnotnull, 'default', pg_get_expr(d.adbin, d.adrelid)) ORDER BY a.attnum) FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum WHERE a.attrelid = '${name}'::regclass AND a.attnum > 0 AND NOT a.attisdropped`;
      assert.equal(await admin.query(shape(table)), await admin.query(shape(`${table}_expected`)), "migration column shape matches Prisma");
      const pk = (name) => `SELECT to_jsonb(conkey) FROM pg_constraint WHERE conrelid = '${name}'::regclass AND contype = 'p'`;
      assert.equal(await admin.query(pk(table)), await admin.query(pk(`${table}_expected`)), "migration primary key matches Prisma");
      await admin.query(`DROP TABLE ${table}_expected`);
    }

    const db = database(container, admin);
    let flag = false;
    let failCache = false;
    const invalidations = [];
    const reset = loadReset(db.prisma, () => flag, { setex: async (...args) => {
      if (failCache) throw new Error("Synthetic invalidation failure");
      invalidations.push(args);
    } });
    assert.equal(await reset(1), "disabled");
    assert.equal(db.lookupCount(), 0, "flag off has no marker lookup or database writes");
    assert.deepEqual(await snap(), migrated);
    flag = true;
    failCache = true;
    assert.equal(await reset(1), "failed", "reset failure is distinct from disabled or completed");
    assert.deepEqual(await snap(), migrated, "failed reset rolls back preferences, backups and completion");
    failCache = false;
    for (let id = 1; id <= fixtures.length; id++) await reset(id);
    const first = await snap();
    const expected = expectedReset(fixtures);
    assertValues(first, expected.values);
    assert.equal(first.done.length, fixtures.length, "even empty or malformed choices get a marker");
    assert.equal(first.backup.length, expected.backups.length);
    for (const backup of expected.backups) {
      const actual = first.backup.find((row) => row.user_id === backup.userId && JSON.stringify(JSON.parse(row.location)) === JSON.stringify(backup.path));
      assert.ok(actual, "changed choice has an exact backup");
      assert.equal(actual.previous_value, backup.value);
      assert.ok(Number.isFinite(Date.parse(actual.backed_up_at)));
    }
    const changedUsers = new Set(expected.backups.map((row) => row.userId));
    for (const entry of first.settings) {
      assert.equal(entry.xmin === migrated.settings.find((row) => row.userId === entry.userId).xmin, !changedUsers.has(entry.userId));
    }
    assert.equal(invalidations.length, changedUsers.size);
    const lookups = db.lookupCount();
    for (let id = 1; id <= fixtures.length; id++) assert.equal(await reset(id), "done");
    assert.equal(db.lookupCount() - lookups, fixtures.length, "completed users need only one marker lookup per read");
    assert.deepEqual(await snap(), first, "second calls change no values, backups, marker timestamps or row versions");
    await admin.query(`UPDATE "UserSetting" SET "aiModelPreferences" = jsonb_set("aiModelPreferences", '{aiChat}', '"gemini-3-flash"') || '{"newPreference":"keep"}'::jsonb WHERE "userId" = 1;
      UPDATE "UserSetting" SET "aiModelPreferences" = "aiModelPreferences" #- '{teams,alpha,taskWriter}' WHERE "userId" = 2`);
    const later = await snap();
    await reset(1);
    await reset(2);
    assert.deepEqual(await snap(), later, "later user choices stay untouched");
    await admin.query(undo);
    const restored = structuredClone(fixtures);
    restored[0].aiChat = "gemini-3-flash";
    restored[0].newPreference = "keep";
    delete restored[1].teams.alpha.taskWriter;
    const undone = await snap();
    assertValues(undone, restored);
    assert.deepEqual(undone.backup, first.backup);
    assert.deepEqual(undone.done, first.done, "undo keeps completion markers");
    assert.deepEqual(undone.outside, migrated.outside, "team, board, agent and provider settings never change");
    await admin.query(undo);
    for (let id = 1; id <= fixtures.length; id++) await reset(id);
    assert.deepEqual(await snap(), undone, "undo and subsequent reads never reset again");

    // Separate sessions exercise simultaneous first reads of one new user.
    await admin.query(`INSERT INTO "User" (id, uid, email) VALUES (11, 'later-user', 'later@example.test');
      INSERT INTO "UserSetting" (id, "userId", notification, "aiModelPreferences") VALUES ('later-setting', 11, true, '{"aiChat":"luna"}')`);
    const otherAdmin = session(container);
    try {
      const otherDb = database(container, otherAdmin);
      const otherReset = loadReset(otherDb.prisma, () => true, { setex: async () => {} });
      const results = await Promise.all([reset(11), otherReset(11)]);
      assert.equal(results.filter((result) => result === "reset").length, 1, "racing first reads execute one reset");
      const concurrent = await snap();
      assert.equal(concurrent.backup.filter((row) => row.user_id === 11).length, 1);
      assert.equal(concurrent.backup.find((row) => row.user_id === 11).previous_value, "luna");
      assert.equal(concurrent.done.filter((row) => row.user_id === 11).length, 1);
    } finally { otherAdmin.close(); }
    // Execute the real preferences POST against the disposable database.
    await admin.query(`INSERT INTO "User" (id, uid, email) VALUES (13, 'save-user', 'save@example.test');
      INSERT INTO "UserSetting" (id, "userId", notification, "aiModelPreferences") VALUES ('save-setting', 13, true, '{"aiChat":"luna"}')`);
    let saves = 0;
    const preferencesPrisma = {
      userSetting: {
        findUnique: async () => ({ aiModelPreferences: JSON.parse(await admin.query('SELECT "aiModelPreferences" FROM "UserSetting" WHERE "userId" = 13')) }),
        update: async ({ data }) => {
          saves++;
          if (data.aiModelPreferences !== undefined) {
            await admin.query(`UPDATE "UserSetting" SET "aiModelPreferences" = ${sqlValue(data.aiModelPreferences)} WHERE "userId" = 13`);
          }
          return data;
        },
      },
    };
    const post = loadPreferences(reset, preferencesPrisma, 13);
    const choose = (updates, teamId) => post({ json: async () => ({ aiModelPreferences: updates, aiModelPreferencesTeamId: teamId }) });
    const beforeFailedSave = await snap();
    failCache = true;
    for (const teamId of [undefined, "alpha"]) {
      const response = await choose({ aiChat: "gemini-3.8-flash" }, teamId);
      assert.equal(response.status, 503);
      assert.match(response.body.error, /retry/i);
      assert.equal(saves, 0, "failed reset must not save a new model choice");
      assert.deepEqual(await snap(), beforeFailedSave, "failed save leaves choices, backups and completion untouched");
    }
    assert.equal((await post({ json: async () => ({ playGifs: false }) })).status, 200, "non-model saves remain available on reset failure");
    failCache = false;
    assert.equal((await choose({ aiChat: "gemini-3.8-flash" })).status, 200);
    assert.equal(await reset(13), "done");
    assert.equal((await snap()).settings.find((row) => row.userId === 13).value.aiChat, "gemini-3.8-flash", "recovery resets before saving and later reads preserve the subsequent pick");
    assert.equal((await snap()).backup.find((row) => row.user_id === 13).previous_value, "luna");

    // Pause after reset's row lock, then let undo block before reset's UPDATE.
    for (const userId of [11, 14]) {
      if (userId === 14) {
        await admin.query(`INSERT INTO "User" (id, uid, email) VALUES (14, 'undo-user', 'undo@example.test');
          INSERT INTO "UserSetting" (id, "userId", notification, "aiModelPreferences") VALUES ('undo-setting', 14, true, '{"aiChat":"luna"}')`);
      } else {
        await admin.query(`DELETE FROM htpr_7038_model_choice_reset_done WHERE user_id = 11;
          UPDATE "UserSetting" SET "aiModelPreferences" = '{"aiChat":"luna"}' WHERE "userId" = 11`);
      }
      let release;
      let locked;
      const paused = new Promise((resolve) => { locked = resolve; });
      const resume = new Promise((resolve) => { release = resolve; });
      const resetAdmin = session(container);
      const undoAdmin = session(container);
      let resetting;
      let undoing;
      try {
        const pausedDb = database(container, resetAdmin, async () => { locked(); await resume; });
        const pausedReset = loadReset(pausedDb.prisma, () => true, { setex: async () => {} });
        resetting = pausedReset(userId);
        await paused;
        const application = `htpr_7038_undo_${userId}`;
        undoing = undoAdmin.query(`SET application_name = '${application}'; SET lock_timeout = '10s'; ${undo}`);
        let waiting = false;
        for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
          waiting = (await admin.query(`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE application_name = '${application}' AND cardinality(pg_blocking_pids(pid)) > 0)`)) === "t";
        }
        assert.equal(waiting, true, "undo must overlap the paused reset");
        release();
        assert.equal(await resetting, "reset", "reset completes without deadlock or rollback");
        await undoing;
        const concurrentUndo = await snap();
        assert.equal(concurrentUndo.settings.find((row) => row.userId === userId).value.aiChat, "luna", "undo reads committed backups, including a first reset's new backup");
        assert.ok(concurrentUndo.done.some((row) => row.user_id === userId));
      } finally {
        release();
        await Promise.allSettled([resetting, undoing]);
        resetAdmin.close();
        undoAdmin.close();
      }
    }
    await reset(12);
    await admin.query(`INSERT INTO "User" (id, uid, email) VALUES (12, 'no-setting', 'empty@example.test');
      INSERT INTO "UserSetting" (id, "userId", notification, "aiModelPreferences") VALUES ('no-setting', 12, true, '{"aiChat":"luna"}')`);
    await reset(12);
    assert.equal((await snap()).settings.find((row) => row.userId === 12).value.aiChat, "luna", "no saved preferences still completes once");
    await admin.query('DELETE FROM "UserSetting" WHERE "userId" = 10');
    await admin.query(undo);
    assert.equal((await snap()).backup.filter((row) => row.user_id === 10).length, expected.backups.filter((row) => row.userId === 10).length);
  } finally {
    admin?.close();
    spawnSync("docker", ["rm", "-f", "-v", container], { stdio: "ignore", timeout: 30_000 });
  }
  const remaining = spawnSync("docker", ["ps", "-a", "--filter", `name=^/${container}$`, "--format", "{{.Names}}"], { encoding: "utf8", timeout: 30_000 });
  assert.equal(remaining.status, 0);
  assert.equal(remaining.stdout.trim(), "", "disposable container was removed");
  console.log("HTPR-7038 model reset tests passed");
});
