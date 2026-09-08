// HTPR-6279 — real-PostgreSQL regression test for the assignees uniqueness fix.
//
// Two concurrent assign calls could both pass the check-then-insert path and
// create identical assignee rows (duplicated assignee chips, e.g. HTPR-6277).
// The fix is the 20260908160000 migration: deduplicate existing rows, then add
// partial unique indexes for person rows (agentId IS NULL) and agent rows
// (agentId IS NOT NULL); the assign controller maps the losing insert to an
// idempotent "already-assigned" outcome.
//
// This suite runs against a real throwaway PostgreSQL server (docker):
//   1. the migration dedupes pre-existing duplicate rows (oldest survives) and
//      creates both partial unique indexes;
//   2. a duplicate insert is rejected with P2002 after the migration;
//   3. two concurrent assigneesAssign calls produce exactly one row, one
//      "created" outcome and one "already-assigned" outcome, both HTTP 200
//      (the per-task mutation fence serializes the two transactions, so the
//      loser reports already-assigned through the in-transaction recheck).
// If docker or PostgreSQL is unavailable the tests SKIP (node:test skip)
// rather than failing; CI sets HT_REQUIRE_PG_TESTS=1 to turn that into a hard
// failure (same contract as tests/task-write-lock-postgres.test.cjs).
//
// The FIREBASE_SERVICE_ACCOUNT_B64 / REDIS_URL env set here are throwaway
// values generated at runtime — firebase-admin only needs a parseable key to
// initialize, and the fire-and-forget AI-summary scheduler rejects harmlessly
// when Redis is unreachable (tracked below so unexpected rejections still fail
// the suite).

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const PG_IMAGE = process.env.HTPR_PG_IMAGE || "postgres:16-alpine";
const PG_USER = "ht";
const PG_PASSWORD = "ht";
const PG_DB = "ht_test";
const MIGRATION = path.join(
  root,
  "src/prisma/migrations/20260908160000_assignees_unique_indexes/migration.sql"
);

const REQUIRE_PG = process.env.HT_REQUIRE_PG_TESTS === "1";

let state = {
  prisma: null,
  assigneesAssign: null,
  url: null,
  skipReason: null,
  cleanup: null,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function withTimeout(promise, ms, label) {
  let timer;
  const cleanup = () => {
    if (timer) clearTimeout(timer);
  };
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), ms);
    }),
  ]).finally(cleanup);
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}

function dockerAvailable() {
  try {
    const res = run("docker", ["version", "--format", "{{.Server.Version}}"]);
    return res.status === 0 && res.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function throwawayFirebaseEnv() {
  // Runtime-generated key so the FCM module can initialize; nothing sensitive
  // is committed (the key exists only in this process's memory).
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  return Buffer.from(
    JSON.stringify({
      project_id: "htpr6279-test",
      client_email: "test@htpr6279-test.iam.gserviceaccount.com",
      private_key: pem,
    })
  ).toString("base64");
}

const prismaCli = () =>
  path.join(root, "node_modules", "prisma", "build", "index.js");

async function provision() {
  if (!dockerAvailable()) {
    return { skipReason: "docker is not available on this machine" };
  }

  let port;
  try {
    port = await freePort();
  } catch (err) {
    return { skipReason: `could not reserve a local port: ${err.message}` };
  }

  const container = `htpr6279-assignees-${process.pid}-${Date.now()}`;
  const host = "127.0.0.1";
  const url = `postgresql://${PG_USER}:${PG_PASSWORD}@${host}:${port}/${PG_DB}`;
  const cleanup = () => {
    try {
      run("docker", ["rm", "-f", container]);
    } catch {
      /* best effort */
    }
  };

  const start = run("docker", [
    "run",
    "-d",
    "--name",
    container,
    "-e",
    `POSTGRES_USER=${PG_USER}`,
    "-e",
    `POSTGRES_PASSWORD=${PG_PASSWORD}`,
    "-e",
    `POSTGRES_DB=${PG_DB}`,
    "-p",
    `${host}:${port}:5432`,
    PG_IMAGE,
  ]);
  if (start.status !== 0) {
    return {
      skipReason: `could not start a throwaway postgres container: ${(
        start.stderr || start.stdout
      ).trim()}`,
      cleanup,
    };
  }

  try {
    let ready = false;
    for (let i = 0; i < 60; i += 1) {
      const check = run("docker", [
        "exec",
        container,
        "pg_isready",
        "-U",
        PG_USER,
        "-d",
        PG_DB,
      ]);
      if (check.status === 0) {
        ready = true;
        break;
      }
      await sleep(500);
    }
    if (!ready) {
      return { skipReason: "postgres container did not become ready within 30s", cleanup };
    }

    // Materialise the Prisma schema as SQL and apply it with the container's
    // own psql (read-only diff, nothing outside the throwaway container).
    const schemaSql = path.join(
      os.tmpdir(),
      `htpr6279-schema-${process.pid}-${Date.now()}.sql`
    );
    const diff = run(
      process.execPath,
      [
        prismaCli(),
        "migrate",
        "diff",
        "--from-empty",
        "--to-schema",
        path.join(root, "src", "prisma", "schema.prisma"),
        "--script",
        "--output",
        schemaSql,
      ],
      { cwd: root, env: { ...process.env, DATABASE_URL: url } }
    );
    if (diff.status !== 0) {
      fs.rmSync(schemaSql, { force: true });
      return {
        skipReason: `prisma migrate diff failed: ${(diff.stderr || diff.stdout).trim()}`,
        cleanup,
      };
    }
    const apply = psql(container, fs.readFileSync(schemaSql, "utf8"));
    fs.rmSync(schemaSql, { force: true });
    if (apply.status !== 0) {
      return {
        skipReason: `applying the Prisma schema failed: ${(apply.stderr || apply.stdout).trim()}`,
        cleanup,
      };
    }

    process.env.DATABASE_URL = url;
    process.env.FIREBASE_SERVICE_ACCOUNT_B64 = throwawayFirebaseEnv();
    // The fire-and-forget AI-summary scheduler needs a redis URL to reject
    // against; nothing connects to it in this suite.
    process.env.REDIS_URL = "redis://127.0.0.1:9/htpr6279";

    const jiti = require("jiti")(path.join(root, "tests", path.basename(__filename)), {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
    });
    const prisma = jiti(path.join(root, "src", "lib", "prisma.ts")).default;
    const assigneesAssign = jiti(
      path.join(root, "src", "utils", "controllers", "assignees", "assign.ts")
    ).default;

    return { prisma, assigneesAssign, jiti, url, container, cleanup };
  } catch (err) {
    cleanup();
    return { skipReason: `provisioning failed: ${err.message}` };
  }
}

function psql(container, sql) {
  return run("docker", [
    "exec",
    "-i",
    container,
    "psql",
    "-U",
    PG_USER,
    "-d",
    PG_DB,
    "-v",
    "ON_ERROR_STOP=1",
  ], { input: sql });
}

// The assign path schedules an AI-summary job fire-and-forget; with no real
// Redis that promise rejects. Record rejections here and let the suite assert
// that only this known-benign one happened.
const unhandledRejections = [];
const onUnhandledRejection = (reason) => {
  unhandledRejections.push(reason);
  return true; // prevent the default crash
};
process.on("unhandledRejection", onUnhandledRejection);

function assertNoUnexpectedRejections() {
  const unexpected = unhandledRejections.filter(
    (reason) =>
      !/REDIS_URL|QStash|Redis/i.test(
        (reason && reason.message) || String(reason)
      )
  );
  assert.deepEqual(
    unexpected,
    [],
    `unexpected unhandled rejections: ${unexpected.map((r) => r && r.message).join("; ")}`
  );
}

function currentUserFor(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName ?? undefined,
    photoURL: undefined,
    uid: "",
    stripe_customer_id: "",
    joinedAt: new Date(),
    UserSettingId: "",
    UserSetting: {},
  };
}

before(async () => {
  state = await provision();
  if (state.skipReason && REQUIRE_PG) {
    throw new Error(
      `HT_REQUIRE_PG_TESTS=1 but the assignees-uniqueness suite could not run: ${state.skipReason}`
    );
  }
});

after(async () => {
  // The fire-and-forget summary scheduler constructs an ioredis client that
  // retries forever against the unreachable REDIS_URL and would keep this
  // process (and node --test) alive; disconnect it before exiting.
  try {
    globalThis.redis?.disconnect?.();
  } catch {
    /* not connected */
  }
  if (state?.prisma) {
    try {
      await state.prisma.$disconnect();
    } catch {
      /* already disconnected */
    }
  }
  if (state?.cleanup) state.cleanup();
});

test("migration dedupes assignees and blocks duplicates", async (t) => {
  if (state.skipReason) return t.skip(state.skipReason);
  const { prisma, container } = state;

  const owner = await prisma.user.create({
    data: { uid: "htpr6279-owner", email: "owner@htpr6279.test", displayName: "Owner" },
  });
  const person = await prisma.user.create({
    data: { uid: "htpr6279-person", email: "person@htpr6279.test", displayName: "Person" },
  });
  const agent = await prisma.agent.create({
    data: { displayName: "Test agent", userId: person.id, visibility: "PRIVATE" },
  });
  const project = await prisma.project.create({
    data: { name: `htpr6279-${Date.now()}`, title: "Dedupe board", ownerId: owner.id },
  });
  const task = await prisma.task.create({
    data: {
      uniqueIndex: 1,
      section: "Todo",
      title: "Dedupe task",
      description: "",
      projectId: project.id,
      userId: owner.id,
    },
  });

  // Pre-migration duplicates: two person rows and two agent rows.
  const personFirst = await prisma.assignees.create({
    data: { taskId: task.id, userId: person.id, assignerId: owner.id },
  });
  await prisma.assignees.create({
    data: { taskId: task.id, userId: person.id, assignerId: owner.id },
  });
  const agentFirst = await prisma.assignees.create({
    data: { taskId: task.id, userId: person.id, agentId: agent.id, agentAssignerId: null, assignerId: owner.id },
  });
  await prisma.assignees.create({
    data: { taskId: task.id, userId: person.id, agentId: agent.id, agentAssignerId: null, assignerId: owner.id },
  });

  const applied = psql(container, fs.readFileSync(MIGRATION, "utf8"));
  assert.equal(
    applied.status,
    0,
    `migration failed: ${(applied.stderr || applied.stdout).trim()}`
  );

  const rows = await prisma.assignees.findMany({
    where: { taskId: task.id },
    orderBy: { id: "asc" },
  });
  assert.equal(rows.length, 2, "exactly one person row and one agent row survive");
  assert.equal(rows[0].id, personFirst.id, "oldest person row survives");
  assert.equal(rows[0].agentId, null);
  assert.equal(rows[1].id, agentFirst.id, "oldest agent row survives");
  assert.equal(rows[1].agentId, agent.id, "agent row keeps its identity");

  const indexes = await prisma.$queryRawUnsafe(
    "SELECT indexname FROM pg_indexes WHERE tablename = 'Assignees'"
  );
  const names = indexes.map((r) => r.indexname).sort();
  assert.ok(names.includes("Assignees_taskId_userId_person_key"), names.join(","));
  assert.ok(names.includes("Assignees_taskId_agentId_key"), names.join(","));

  // Post-migration, a duplicate insert is rejected by the database itself, and
  // the real error shape (Prisma pg driver adapter) satisfies the controller's
  // idempotency predicate.
  const assignModule = state.jiti(
    path.join(root, "src", "utils", "controllers", "assignees", "assign.ts")
  );
  await assert.rejects(
    () =>
      prisma.assignees.create({
        data: { taskId: task.id, userId: person.id, assignerId: owner.id },
      }),
    (err) => {
      assert.equal(err.code, "P2002");
      assert.equal(
        assignModule.isAssigneeUniqueIndexError(err),
        true,
        `real P2002 must match the predicate: ${JSON.stringify(err.meta)}`
      );
      return true;
    }
  );
  await assert.rejects(
    () =>
      prisma.assignees.create({
        data: { taskId: task.id, userId: person.id, agentId: agent.id, assignerId: owner.id },
      }),
    (err) => err && err.code === "P2002"
  );
  assertNoUnexpectedRejections();
});

test("concurrent assigns produce one row and an already-assigned outcome", async (t) => {
  if (state.skipReason) return t.skip(state.skipReason);
  const { prisma, assigneesAssign } = state;

  const owner = await prisma.user.create({
    data: { uid: "htpr6279-racer", email: "racer@htpr6279.test", displayName: "Racer" },
  });
  const project = await prisma.project.create({
    data: { name: `htpr6279-race-${Date.now()}`, title: "Race board", ownerId: owner.id },
  });
  const task = await prisma.task.create({
    data: {
      uniqueIndex: 2,
      section: "Todo",
      title: "Race task",
      description: "",
      projectId: project.id,
      userId: owner.id,
    },
  });

  const actor = currentUserFor(owner);
  const [first, second] = await withTimeout(
    Promise.all([
      // Self-assign: the owner is a member, and notifications are skipped for
      // self-assignment so no external side effects run in the test.
      assigneesAssign(actor, owner.id, task.id, undefined, undefined, { intent: "assign" }),
      assigneesAssign(actor, owner.id, task.id, undefined, undefined, { intent: "assign" }),
    ]),
    15000,
    "concurrent assigns"
  );

  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(second.status, 200, JSON.stringify(second.json));
  const outcomes = [first.json.assignmentOutcome, second.json.assignmentOutcome].sort();
  assert.deepEqual(outcomes, ["already-assigned", "created"], JSON.stringify(outcomes));

  const rows = await prisma.assignees.findMany({ where: { taskId: task.id } });
  assert.equal(rows.length, 1, "the unique index collapsed the race to one row");
  assert.equal(rows[0].userId, owner.id);

  assertNoUnexpectedRejections();
});
