// HTPR-5467 — real-PostgreSQL regression test for the task advisory-write lock.
//
// PR #2789 shipped a production-wide task-write outage: it called the
// two-argument `pg_advisory_xact_lock` overload with Prisma-bound bigint
// values. PostgreSQL only accepts `pg_advisory_xact_lock(bigint)` or
// `pg_advisory_xact_lock(int, int)`, so the real database rejected every call
// and every task write failed. CI missed it because the tests mocked Prisma's
// `$queryRaw`/`$executeRaw` and only asserted that a lock call existed and
// appeared in the right order — no test ever executed the SQL.
//
// This file runs the ACTUAL helpers from src/lib/taskCardActions/writeLocks.ts
// (withTaskStarWriteLock / withTaskInboxWriteLock) against a real throwaway
// PostgreSQL server (docker). It does not stub Prisma and does not assert on
// the helper's source text. If docker or PostgreSQL is unavailable the tests
// SKIP (node:test skip) rather than failing or silently passing.
//
// Why the ::int casts matter (verified by hand against this PostgreSQL build):
//   `SELECT pg_advisory_xact_lock($1::int, $2::int)`  -> resolves to (int, int) -> OK
//   `SELECT pg_advisory_xact_lock($1::int8, $2::int8)` -> no such overload -> ERROR
// The helper narrows its arguments to int4 so a bigint-bound parameter can
// never select the missing (bigint, bigint) overload. The "::int" test below
// pins that cast by asserting on the SQL the helper actually executes.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const PG_IMAGE = process.env.HTPR_PG_IMAGE || "postgres:16-alpine";
const PG_USER = "ht";
const PG_PASSWORD = "ht";
const PG_DB = "ht_test";

// Set HT_REQUIRE_PG_TESTS=1 (CI does) to turn "docker unavailable" from a clean
// skip into a hard failure. Locally a missing docker daemon should not block a
// developer; in CI a silent skip would be exactly the false green that let
// PR #2789 through, so there the suite must fail loudly instead.
const REQUIRE_PG = process.env.HT_REQUIRE_PG_TESTS === "1";

// State populated by the `before` hook. `skipReason` is set when docker /
// PostgreSQL provisioning is not possible; every test then skips cleanly.
let state = {
  prisma: null,
  writeLocks: null,
  url: null,
  skipReason: null,
  cleanup: null,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), ms),
    ),
  ]);
}

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: "utf8", ...opts });
}

function dockerLogs(container) {
  // `docker logs` forwards the container's stdout to this process's stdout and
  // the container's stderr (where the postgres server writes its log) to this
  // process's stderr — concatenate both in a fixed order.
  const res = run("docker", ["logs", container]);
  return `${res.stdout ?? ""}${res.stderr ?? ""}`;
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

  const container = `htpr5467-writelock-${process.pid}-${Date.now()}`;
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
    // Statement logging is on from startup so the ::int test can observe the
    // SQL the helper actually executes (see the test below). The image's
    // entrypoint forwards these args to the postgres server.
    "-c",
    "log_statement=all",
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
    // Wait for the server to accept connections.
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
      return {
        skipReason: "postgres container did not become ready within 30s",
        cleanup,
      };
    }

    // Materialise the Prisma schema as SQL, then apply it with the container's
    // own psql. `prisma migrate diff` is read-only, so it works without any
    // destructive-action consent and cannot touch anything outside the
    // throwaway container.
    const schemaSql = path.join(
      os.tmpdir(),
      `htpr5467-schema-${process.pid}-${Date.now()}.sql`,
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
      { cwd: root, env: { ...process.env, DATABASE_URL: url } },
    );
    if (diff.status !== 0) {
      fs.rmSync(schemaSql, { force: true });
      return {
        skipReason: `prisma migrate diff failed: ${(
          diff.stderr || diff.stdout
        ).trim()}`,
        cleanup,
      };
    }

    const apply = run(
      "docker",
      [
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
      ],
      { input: fs.readFileSync(schemaSql, "utf8") },
    );
    fs.rmSync(schemaSql, { force: true });
    if (apply.status !== 0) {
      return {
        skipReason: `applying the Prisma schema failed: ${(
          apply.stderr || apply.stdout
        ).trim()}`,
        cleanup,
      };
    }

    // Point the real Prisma singleton at the throwaway database, then load the
    // real helpers. The `@` alias resolves the helpers' own imports.
    process.env.DATABASE_URL = url;
    const jiti = require("jiti")(
      path.join(root, "tests", path.basename(__filename)),
      {
        interopDefault: true,
        alias: { "@": path.join(root, "src") },
      },
    );
    const prisma = jiti(path.join(root, "src", "lib", "prisma.ts")).default;
    const writeLocks = jiti(
      path.join(root, "src", "lib", "taskCardActions", "writeLocks.ts"),
    );
    const attachmentLinker = jiti(
      path.join(root, "src", "lib", "storage", "linkTaskAttachment.ts"),
    );

    return { prisma, writeLocks, attachmentLinker, url, container, cleanup };
  } catch (err) {
    cleanup();
    return { skipReason: `provisioning failed: ${err.message}` };
  }
}

before(async () => {
  state = await provision();
  if (state.skipReason && REQUIRE_PG) {
    throw new Error(
      `HT_REQUIRE_PG_TESTS=1 but the task-write-lock suite could not run: ${state.skipReason}`,
    );
  }
});

after(async () => {
  if (state?.prisma) {
    try {
      await state.prisma.$disconnect();
    } catch {
      /* already disconnected */
    }
  }
  if (state?.cleanup) {
    state.cleanup();
  }
});

let seedCounter = 0;

// Create a fresh, isolated user/project/task triple for one test. Everything
// is written through the real Prisma client so the tests exercise the same
// model/enum/default handling as production.
async function seedTask() {
  seedCounter += 1;
  const stamp = `${process.pid}-${Date.now()}-${seedCounter}`;
  const user = await state.prisma.user.create({
    data: { uid: `wt-${stamp}`, email: `wt-${stamp}@example.com` },
  });
  const project = await state.prisma.project.create({
    data: { name: `wt-proj-${stamp}`, ownerId: user.id },
  });
  const task = await state.prisma.task.create({
    data: {
      uniqueIndex: seedCounter,
      section: "Todo",
      title: `write-lock task ${stamp}`,
      description: "",
      projectId: project.id,
      userId: user.id,
    },
  });
  return { user, project, task };
}

test("task attachment linking acquires its receipt lock on real PostgreSQL", async (t) => {
  if (state.skipReason) return t.skip(state.skipReason);

  const receipt = {
    userId: 6,
    key: "tasks/attachments/receipt-lock-regression.txt",
    fileName: "receipt-lock-regression.txt",
    contentType: "text/plain",
    fileSize: 1,
  };

  await assert.rejects(
    state.attachmentLinker.linkTaskAttachment(2147483647, 6, receipt),
    (error) =>
      error?.name === "TaskAttachmentLinkError" &&
      error.status === 404 &&
      error.message === "Task not found or access denied",
  );
});

test("withTaskStarWriteLock runs a real archive on PostgreSQL and commits it", async (t) => {
  if (state.skipReason) return t.skip(state.skipReason);

  const { prisma, writeLocks } = state;
  const { task } = await seedTask();

  const returned = await writeLocks.withTaskStarWriteLock(
    task.id,
    async (tx) => {
      const updated = await tx.task.update({
        where: { id: task.id },
        data: { status: "Archive" },
      });
      return updated.status;
    },
  );

  assert.equal(returned, "Archive");
  const persisted = await prisma.task.findUnique({ where: { id: task.id } });
  assert.equal(persisted.status, "Archive");
});

test("withTaskInboxWriteLock runs a real section move on PostgreSQL and commits it", async (t) => {
  if (state.skipReason) return t.skip(state.skipReason);

  const { prisma, writeLocks } = state;
  const { task } = await seedTask();

  const returned = await writeLocks.withTaskInboxWriteLock(
    task.id,
    async (tx) => {
      const updated = await tx.task.update({
        where: { id: task.id },
        data: { section: "Doing" },
      });
      return updated.section;
    },
  );

  assert.equal(returned, "Doing");
  const persisted = await prisma.task.findUnique({ where: { id: task.id } });
  assert.equal(persisted.section, "Doing");
});

// The behavioral proof that the helper selected the two-int overload, read from
// PostgreSQL's own lock table rather than from any SQL string. For an advisory
// lock pg_locks reports objsubid = 2 when the lock was taken with
// `pg_advisory_xact_lock(int, int)` and objsubid = 1 for the single-bigint form,
// with classid/objid holding the two int32 arguments. PR #2789 aimed at the
// two-int overload and missed it entirely; this asserts we actually hold the
// lock identity we intended, on the exact key we intended.
test("the helper holds a real two-int advisory lock on the task's own key", async (t) => {
  if (state.skipReason) return t.skip(state.skipReason);

  const { writeLocks } = state;
  const { task } = await seedTask();

  // A bigint-bound task id reproduces PR #2789's binding shape; the lock the
  // server ends up holding must still be the (int, int) one on this task's key.
  const held = await writeLocks.withTaskInboxWriteLock(
    BigInt(task.id),
    async (tx) => tx.$queryRaw`
      SELECT classid, objid, objsubid
      FROM pg_locks
      WHERE locktype = 'advisory' AND pid = pg_backend_pid()`,
  );

  assert.equal(held.length, 1, "exactly one advisory lock must be held");
  const [lock] = held;
  assert.equal(
    Number(lock.objsubid),
    2,
    "advisory lock must be the two-int form, not the single-bigint form",
  );
  assert.equal(Number(lock.classid), writeLocks.TASK_INBOX_REMINDER_LOCK_CLASS);
  assert.equal(Number(lock.objid), task.id);
});

// The `::int` casts are a semantic no-op under @prisma/adapter-pg: the driver
// text-binds parameters (OID 0), so PostgreSQL infers `int` from the unknown
// literals either way and the helper succeeds with or without the cast. The
// casts only matter on a stack that binds bigint values with a declared int8
// type (the Rust query engine PR #2789 ran on), where the two-arg call would
// select the missing (bigint, bigint) overload and every write would fail.
//
// This one is a canary, not a behavioral test, and is deliberately kept as one:
// on this stack no observable behavior changes when the cast is removed, so the
// only way to keep the defense from being deleted as dead weight is to assert it
// is still on the wire. It reads the SQL the helper ACTUALLY executed against the
// real server (PostgreSQL's statement log, enabled on the container at startup)
// rather than grepping the helper's source. If the driver ever goes back to
// declaring int8 parameter types, the cast becomes load-bearing again and the
// overload test above starts failing first.
test("canary: the SQL the helper executes still narrows both args with ::int", async (t) => {
  if (state.skipReason) return t.skip(state.skipReason);

  const { writeLocks, container } = state;

  // `log_statement=all` was enabled on the container at startup, so the lines
  // appended while this test runs contain the exact SQL the helper sent.
  const before = dockerLogs(container);

  const { task } = await seedTask();
  await writeLocks.withTaskStarWriteLock(task.id, async () => "locked");

  const executed = dockerLogs(container).slice(before.length);
  assert.match(
    executed,
    /pg_advisory_xact_lock\(\$1::int, \$2::int\)/,
    "the advisory lock the helper runs must cast both arguments to int",
  );
});

test("two writers on the SAME task serialize on the advisory lock", async (t) => {
  if (state.skipReason) return t.skip(state.skipReason);

  const { prisma, writeLocks } = state;
  const { task } = await seedTask();

  // Hold the star lock open from inside the transaction. `entered` resolves
  // once the first writer has actually acquired the lock (and is inside the
  // transaction), `release` commits the first transaction and drops the lock.
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let markEntered;
  const entered = new Promise((resolve) => {
    markEntered = resolve;
  });

  const first = writeLocks.withTaskStarWriteLock(task.id, async () => {
    markEntered();
    await gate;
    return "first";
  });
  await withTimeout(entered, 5000, "first lock acquisition");

  let secondRan = false;
  const second = writeLocks.withTaskStarWriteLock(task.id, async () => {
    secondRan = true;
    return "second";
  });

  // Give the second writer a real chance to run while the first still holds
  // the lock. If the lock were a no-op the second writer would run here.
  await sleep(600);
  assert.equal(
    secondRan,
    false,
    "second writer must block while the first holds the same-task lock",
  );

  release();
  await Promise.all([first, second]);
  assert.equal(secondRan, true, "second writer must proceed after release");
});

test("two writers on DIFFERENT tasks do not block each other", async (t) => {
  if (state.skipReason) return t.skip(state.skipReason);

  const { prisma, writeLocks } = state;
  const a = await seedTask();
  const b = await seedTask();

  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let markEntered;
  const entered = new Promise((resolve) => {
    markEntered = resolve;
  });

  const first = writeLocks.withTaskStarWriteLock(a.task.id, async () => {
    markEntered();
    await gate;
    return "first";
  });
  await withTimeout(entered, 5000, "first lock acquisition");

  // A different task id maps to a different advisory-lock key, so this must
  // complete promptly even while the first lock is still held.
  const other = await withTimeout(
    writeLocks.withTaskStarWriteLock(b.task.id, async () => "other"),
    2000,
    "different-task writer",
  );
  assert.equal(other, "other");

  release();
  await first;
});
