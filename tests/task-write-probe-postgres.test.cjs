// HTPR-5467 — real-PostgreSQL behavioral tests for the task-write probe.
//
// The probe must catch PR #2789's exact failure mode (a broken advisory-lock
// helper taking down every task write) without ever persisting anything, and it
// must be behind the MCP bearer-token auth. These tests run the REAL modules
// (src/lib/taskCardActions/writeProbe.ts + writeLocks.ts, src/lib/prisma.ts)
// against a throwaway postgres:16-alpine container — no mocked Prisma client,
// no stubbed $executeRaw, no source-text assertions for the DB behavior.
//
// Coverage (all against real PostgreSQL):
//   1. healthy when the write path works
//   2. broken when the advisory-lock helper errors (PR #2789 reproduced with the
//      (bigint, bigint) overload PostgreSQL rejects)
//   3. no new or modified rows after a successful probe (rollback proven)
//   4. unauthenticated calls rejected at the HTTP boundary
//
// If docker/postgres is unavailable the DB tests SKIP cleanly (matching
// tests/task-write-lock-postgres.test.cjs); HT_REQUIRE_PG_TESTS=1 turns that
// skip into a hard failure so CI cannot silently green out.

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");

const PG_IMAGE = process.env.HTPR_PG_IMAGE || "postgres:16-alpine";
const PG_USER = "ht";
const PG_PASSWORD = "ht";
const PG_DB = "ht_test";
const REQUIRE_PG = process.env.HT_REQUIRE_PG_TESTS === "1";

let state = {
  prisma: null,
  writeProbe: null,
  probeHandler: null,
  url: null,
  cleanup: null,
  skipReason: null,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

const prismaCli = () =>
  path.join(root, "node_modules", "prisma", "build", "index.js");

function loadProbeHandler() {
  // The handler imports only next/server + a type — no database, no auth module —
  // so it loads without a configured DATABASE_URL and without a running DB.
  const jiti = require("jiti")(
    path.join(root, "tests", "task-write-probe-handler.cjs"),
    { interopDefault: true, alias: { "@": path.join(root, "src") } },
  );
  return jiti(path.join(root, "src", "lib", "mcp", "taskWriteProbe", "probeHandler.ts"));
}

async function provision() {
  state.probeHandler = loadProbeHandler();

  if (!dockerAvailable()) {
    return { skipReason: "docker is not available on this machine" };
  }

  let port;
  try {
    port = await freePort();
  } catch (err) {
    return { skipReason: `could not reserve a local port: ${err.message}` };
  }

  const container = `htpr5467-writeprobe-${process.pid}-${Date.now()}`;
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
      return {
        skipReason: "postgres container did not become ready within 30s",
        cleanup,
      };
    }

    const schemaSql = path.join(
      os.tmpdir(),
      `htpr5467-writeprobe-schema-${process.pid}-${Date.now()}.sql`,
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
      ["exec", "-i", container, "psql", "-U", PG_USER, "-d", PG_DB, "-v", "ON_ERROR_STOP=1"],
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

    process.env.DATABASE_URL = url;
    const jiti = require("jiti")(
      path.join(root, "tests", path.basename(__filename)),
      {
        interopDefault: true,
        alias: { "@": path.join(root, "src") },
      },
    );
    const prisma = jiti(path.join(root, "src", "lib", "prisma.ts")).default;
    const writeProbe = jiti(
      path.join(root, "src", "lib", "taskCardActions", "writeProbe.ts"),
    );
    const { withTaskStarWriteLock } = jiti(
      path.join(root, "src", "lib", "taskCardActions", "writeLocks.ts"),
    );

    return { prisma, writeProbe, withTaskStarWriteLock, url, container, cleanup };
  } catch (err) {
    cleanup();
    return { skipReason: `provisioning failed: ${err.message}` };
  }
}

before(async () => {
  const provisioned = await provision();
  Object.assign(state, provisioned);
  if (state.skipReason && REQUIRE_PG) {
    throw new Error(
      `HT_REQUIRE_PG_TESTS=1 but the task-write-probe suite could not run: ${state.skipReason}`,
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

// A task belonging to somebody who is NOT the probe caller. Seeded in every
// probe test so a regression back to "lock the lowest-id task" is caught: this
// row is always older (lower id) than the caller's probe task.
async function seedTask({ updatedAt } = {}) {
  seedCounter += 1;
  const stamp = `${process.pid}-${Date.now()}-${seedCounter}`;
  const user = await state.prisma.user.create({
    data: { uid: `wp-${stamp}`, email: `wp-${stamp}@example.com` },
  });
  const project = await state.prisma.project.create({
    data: { name: `wp-proj-${stamp}`, ownerId: user.id },
  });
  const task = await state.prisma.task.create({
    data: {
      uniqueIndex: seedCounter,
      section: "Todo",
      title: `write-probe task ${stamp}`,
      description: "",
      projectId: project.id,
      userId: user.id,
      ...(updatedAt ? { updatedAt } : {}),
    },
  });
  return { user, project, task };
}

// The health identity the probe authenticates as. It owns no data until the
// probe creates its own probe board.
async function seedCaller() {
  seedCounter += 1;
  const stamp = `${process.pid}-${Date.now()}-caller-${seedCounter}`;
  return state.prisma.user.create({
    data: { uid: `wp-${stamp}`, email: `wp-${stamp}@example.com` },
  });
}

const probeTaskOf = (userId) =>
  state.prisma.task.findFirst({
    where: {
      userId,
      title: state.writeProbe.PROBE_TASK_TITLE,
      project: { name: state.writeProbe.probeProjectName(userId) },
    },
  });

// A faithful reproduction of PR #2789 running REAL SQL against the real server:
// the two-argument advisory-lock call selects the (bigint, bigint) overload and
// PostgreSQL rejects it. The current writeLocks.ts casts to ::int and works;
// this broken variant proves the probe detects the historical failure instead of
// reporting healthy.
function brokenLock(taskId, operation) {
  return state.prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(1::int8, ${taskId}::int8)`;
    return operation(tx);
  });
}

// 1. Healthy: the real lock helper + real writes succeed and roll back.
test("the probe reports healthy when the task-write path works", async (t) => {
  if (state.skipReason) return t.skip(state.skipReason);
  const foreign = await seedTask({ updatedAt: new Date("2024-01-01T00:00:00Z") });
  const caller = await seedCaller();
  const fixture = await state.writeProbe.ensureTaskWriteProbeFixture(caller.id);

  const result = await state.writeProbe.runTaskWriteProbe(caller.id);

  assert.equal(result.status, "healthy");
  assert.equal(result.rolledBack, true);
  assert.equal(result.lockedTaskId, fixture.id);
  assert.equal((await probeTaskOf(caller.id)).id, fixture.id);
  assert.notEqual(
    result.lockedTaskId,
    foreign.task.id,
    "the probe must never lock another tenant's task",
  );
  assert.equal(typeof result.probeRowId, "string");
  assert.ok(result.probeRowId.length > 0, "probe row id must be set");

  // The throwaway row must not have survived the rollback.
  const leftover = await state.prisma.savedContent.findUnique({
    where: { id: result.probeRowId },
  });
  assert.equal(leftover, null, "throwaway SavedContent row must be rolled back");

  // The foreign row must be byte-identical: not locked, not touched.
  const foreignAfter = await state.prisma.task.findUnique({ where: { id: foreign.task.id } });
  assert.deepEqual(foreignAfter, foreign.task, "another tenant's task must be untouched");
});

// 1b. The health endpoint creates nothing: without a provisioned fixture it
// reports inconclusive and leaves the database exactly as it found it.
test("the probe creates no records and reports misconfigured without a fixture", async (t) => {
  if (state.skipReason) return t.skip(state.skipReason);
  await seedTask();
  const caller = await seedCaller();
  const before = {
    tasks: await state.prisma.task.count(),
    projects: await state.prisma.project.count(),
  };

  const result = await state.writeProbe.runTaskWriteProbe(caller.id);

  assert.equal(result.status, "misconfigured");
  assert.match(result.reason, /probe fixture missing/);
  assert.equal(await state.prisma.task.count(), before.tasks, "no Task may be created");
  assert.equal(await state.prisma.project.count(), before.projects, "no Project may be created");
});

// 1c. Cross-tenant guard: a probe board that belongs to somebody else never
// matches, so the probe can neither read nor write through it.
test("a probe board owned by another account is never used", async (t) => {
  if (state.skipReason) return t.skip(state.skipReason);
  const caller = await seedCaller();
  const squatter = await seedCaller();
  const project = await state.prisma.project.create({
    data: { name: state.writeProbe.probeProjectName(caller.id), ownerId: squatter.id },
  });
  // Even a task carrying the probe title, on that board, under the caller's own
  // userId must not qualify: the board is not theirs.
  await state.prisma.task.create({
    data: {
      uniqueIndex: 1,
      section: "Todo",
      title: state.writeProbe.PROBE_TASK_TITLE,
      description: "",
      projectId: project.id,
      userId: caller.id,
    },
  });

  const result = await state.writeProbe.runTaskWriteProbe(caller.id);

  assert.equal(result.status, "misconfigured");
  assert.match(result.reason, /probe fixture missing/);
  await assert.rejects(
    state.writeProbe.ensureTaskWriteProbeFixture(caller.id),
    /owned by another account/,
    "provisioning must refuse a board owned by somebody else",
  );
});

// 1d. Ownership is revalidated inside the transaction: a fixture that changes
// hands mid-probe is inconclusive, never written to, and never `broken` (which
// would roll the deployment back over a fixture problem).
test("a fixture that changes hands mid-probe is never written to", async (t) => {
  if (state.skipReason) return t.skip(state.skipReason);
  const caller = await seedCaller();
  const newOwner = await seedCaller();
  const fixture = await state.writeProbe.ensureTaskWriteProbeFixture(caller.id);
  const before = await state.prisma.task.findUnique({ where: { id: fixture.id } });

  // Hand the board over between the lookup and the transactional re-read.
  const stealBoard = async (taskId, operation) => {
    await state.prisma.project.update({
      where: { name: state.writeProbe.probeProjectName(caller.id) },
      data: { ownerId: newOwner.id },
    });
    return state.withTaskStarWriteLock(taskId, operation);
  };

  const result = await state.writeProbe.runTaskWriteProbe(caller.id, { lock: stealBoard });

  assert.equal(result.status, "inconclusive");
  assert.match(result.reason, /changed while the probe was running/);
  assert.deepEqual(
    await state.prisma.task.findUnique({ where: { id: fixture.id } }),
    before,
    "the handed-over task must be untouched",
  );
});

// 1f. Provisioning is one transaction: a board that changed hands leaves no
// orphan project behind when the bootstrap aborts.
test("a failed bootstrap leaves no orphan probe board", async (t) => {
  if (state.skipReason) return t.skip(state.skipReason);
  const caller = await seedCaller();
  const squatter = await seedCaller();
  await state.prisma.project.create({
    data: { name: state.writeProbe.probeProjectName(caller.id), ownerId: squatter.id },
  });
  const projects = await state.prisma.project.count();

  await assert.rejects(state.writeProbe.ensureTaskWriteProbeFixture(caller.id));

  assert.equal(await state.prisma.project.count(), projects, "no Project may be left behind");
  assert.equal(await state.prisma.task.count({ where: { userId: caller.id } }), 0);
});

// 1g. A soft-deleted fixture must be restorable. @@unique([projectId,
// uniqueIndex]) means a replacement alongside it would fail forever, so the
// probe would stay misconfigured with no way back.
test("provisioning restores a soft-deleted fixture", async (t) => {
  if (state.skipReason) return t.skip(state.skipReason);
  const caller = await seedCaller();
  const fixture = await state.writeProbe.ensureTaskWriteProbeFixture(caller.id);
  await state.prisma.task.update({
    where: { id: fixture.id },
    data: { status: "Deleted", deletedAt: new Date() },
  });

  const missing = await state.writeProbe.runTaskWriteProbe(caller.id);
  assert.equal(missing.status, "misconfigured");

  const restored = await state.writeProbe.ensureTaskWriteProbeFixture(caller.id);
  assert.equal(restored.id, fixture.id, "the same row must be restored, not duplicated");

  const result = await state.writeProbe.runTaskWriteProbe(caller.id);
  assert.equal(result.status, "healthy", result.reason ?? result.error);
  assert.equal(await state.prisma.task.count({ where: { userId: caller.id } }), 1);
});

// 1h. The board's lifecycle counts too: a soft-deleted board must stop serving
// targets, and provisioning must bring it back.
test("a soft-deleted probe board is not a valid target and is restored on provisioning", async (t) => {
  if (state.skipReason) return t.skip(state.skipReason);
  const caller = await seedCaller();
  const fixture = await state.writeProbe.ensureTaskWriteProbeFixture(caller.id);
  await state.prisma.project.update({
    where: { name: state.writeProbe.probeProjectName(caller.id) },
    data: { status: "Deleted" },
  });

  const missing = await state.writeProbe.runTaskWriteProbe(caller.id);
  assert.equal(missing.status, "misconfigured");

  const restored = await state.writeProbe.ensureTaskWriteProbeFixture(caller.id);
  assert.equal(restored.id, fixture.id);
  const result = await state.writeProbe.runTaskWriteProbe(caller.id);
  assert.equal(result.status, "healthy", result.reason ?? result.error);
});

// 1i. A live board or task carrying the reserved name is somebody's real work,
// not a fixture. Provisioning must refuse it rather than archive it, and the
// probe must never write to it.
test("provisioning refuses a live board carrying the reserved name", async (t) => {
  if (state.skipReason) return t.skip(state.skipReason);
  const caller = await seedCaller();
  const project = await state.prisma.project.create({
    data: { name: state.writeProbe.probeProjectName(caller.id), ownerId: caller.id },
  });
  const live = await state.prisma.task.create({
    data: {
      uniqueIndex: 1,
      section: "Todo",
      title: state.writeProbe.PROBE_TASK_TITLE,
      description: "real work",
      projectId: project.id,
      userId: caller.id,
    },
  });

  await assert.rejects(
    state.writeProbe.ensureTaskWriteProbeFixture(caller.id),
    /not the reserved fixture/,
  );
  const result = await state.writeProbe.runTaskWriteProbe(caller.id);
  assert.equal(result.status, "misconfigured");
  assert.deepEqual(
    await state.prisma.task.findUnique({ where: { id: live.id } }),
    live,
    "a live task must not be touched or archived",
  );
});

// 1e. Provisioning is idempotent, so re-running the setup script is safe.
test("provisioning the fixture twice reuses the same rows", async (t) => {
  if (state.skipReason) return t.skip(state.skipReason);
  const caller = await seedCaller();

  const first = await state.writeProbe.ensureTaskWriteProbeFixture(caller.id);
  const projects = await state.prisma.project.count();
  const second = await state.writeProbe.ensureTaskWriteProbeFixture(caller.id);

  assert.equal(second.id, first.id);
  assert.equal(await state.prisma.project.count(), projects);
});

// 2. Broken: the probe must FAIL (not report healthy) when the lock helper errors.
test("the probe reports broken when the advisory-lock helper errors (PR #2789)", async (t) => {
  if (state.skipReason) return t.skip(state.skipReason);
  const { task } = await seedTask();
  const caller = await seedCaller();
  await state.writeProbe.ensureTaskWriteProbeFixture(caller.id);

  // Confirm the broken lock simulation is actually broken against real PG.
  await assert.rejects(
    brokenLock(task.id, async () => "unused"),
    /pg_advisory_xact_lock\(bigint, bigint\) does not exist/i,
  );

  const result = await state.writeProbe.runTaskWriteProbe(caller.id, { lock: brokenLock });
  assert.equal(result.status, "broken");
  // The caller gets a fixed string: raw Prisma/PostgreSQL text names tables,
  // constraints and SQL, and this endpoint answers any authenticated caller.
  assert.equal(result.error, "task-write probe failed");
  assert.doesNotMatch(result.error, /pg_advisory_xact_lock|prisma|postgres/i);
});

// 3. Rollback: a successful probe leaves the database untouched.
test("a successful probe leaves no new or modified rows", async (t) => {
  if (state.skipReason) return t.skip(state.skipReason);
  await seedTask({ updatedAt: new Date("2024-02-02T00:00:00Z") });
  const caller = await seedCaller();

  const snapshot = async () => ({
    tasks: (await state.prisma.task.findMany({
      select: { id: true, status: true, title: true, section: true, updatedAt: true },
      orderBy: { id: "asc" },
    })).map((row) => ({ ...row, updatedAtTs: row.updatedAt ? row.updatedAt.getTime() : null })),
    savedContentCount: await state.prisma.savedContent.count(),
  });

  // Provision out of band, exactly as the setup script does; from here on the
  // probe itself must change nothing at all, including its own probe task.
  const fixture = await state.writeProbe.ensureTaskWriteProbeFixture(caller.id);

  const before = await snapshot();
  const result = await state.writeProbe.runTaskWriteProbe(caller.id);
  const after = await snapshot();

  assert.equal(result.status, "healthy");
  assert.equal(result.lockedTaskId, fixture.id, "the provisioned fixture must be reused");
  assert.deepEqual(after.tasks, before.tasks, "no Task row may be created, modified, or deleted");
  assert.equal(
    after.savedContentCount,
    before.savedContentCount,
    "no SavedContent row may be created, modified, or deleted",
  );
  assert.equal(
    await state.prisma.savedContent.findUnique({ where: { id: result.probeRowId } }),
    null,
    "the probe's throwaway row must not exist after rollback",
  );
});

// 3b. Verification failure: a post-rollback verification read error must never
// be reported as healthy (the false-green class HTPR-5467 removes). The
// write/lock path itself succeeded here; only the confirmation read failed, so
// the correct verdict is `inconclusive` (warn, never roll back) — not `broken`
// (which the workflow would roll back on) and never `healthy`.
test("the probe reports inconclusive (never healthy) when rollback verification fails", async (t) => {
  if (state.skipReason) return t.skip(state.skipReason);
  await seedTask();
  const caller = await seedCaller();
  await state.writeProbe.ensureTaskWriteProbeFixture(caller.id);

  const result = await state.writeProbe.runTaskWriteProbe(caller.id, {
    verifyRollback: async () => {
      throw new Error("simulated verification outage: relation savedContent");
    },
  });

  assert.equal(result.status, "inconclusive");
  assert.equal(result.reason, "post-rollback verification query failed");
  // The underlying database message stays in the server log, never in the body.
  assert.doesNotMatch(result.reason, /simulated verification outage|relation/i);
});

// 3c. False-positive pin: SavedContent declares only @@index([taskId, userId,
// commentId]) and @@index([commentId, taskId, userId, type]) — no @@unique — so
// a duplicate (userId, taskId, commentId) tuple is legal and the probe's INSERT
// cannot collide with an existing row. (The probe inserts commentId: null.)
test("the probe's SavedContent insert succeeds alongside an existing (userId, taskId, commentId) tuple", async (t) => {
  if (state.skipReason) return t.skip(state.skipReason);
  await seedTask();
  const caller = await seedCaller();

  // Pin the duplicate tuple to the fixture row so the probe's throwaway INSERT
  // shares (userId, taskId, commentId) with an existing row.
  await state.writeProbe.ensureTaskWriteProbeFixture(caller.id);
  const target = await probeTaskOf(caller.id);
  await state.prisma.savedContent.create({
    data: {
      userId: target.userId,
      taskId: target.id,
      projectId: target.projectId,
      commentId: null,
      type: "Private",
    },
  });

  const result = await state.writeProbe.runTaskWriteProbe(caller.id);
  assert.equal(result.status, "healthy", result.reason ?? result.error);
});

// 4. Auth: unauthenticated calls are rejected before any probe work happens.
test("unauthenticated calls are rejected with 401 and never run the probe", async () => {
  let probeCalls = 0;
  const GET = state.probeHandler.createTaskWriteProbeHandler({
    checkRateLimit: async () => null,
    validateAuth: async () => null,
    runProbe: async () => {
      probeCalls += 1;
      return {
        status: "healthy",
        rolledBack: true,
        lockedTaskId: 1,
        probeRowId: "00000000-0000-0000-0000-000000000000",
      };
    },
  });

  const request = new NextRequest(
    "https://example.test/api/ops/task-write-probe",
    { method: "GET" },
  );
  const response = await GET(request);

  assert.equal(response.status, 401);
  assert.equal(probeCalls, 0);
  assert.equal((await response.json()).success, false);
});

// 4b. The probe runs as the authenticated principal, so it can only ever reach
// that principal's own probe task.
test("the probe runs as the authenticated principal", async () => {
  const seen = [];
  const GET = state.probeHandler.createTaskWriteProbeHandler({
    checkRateLimit: async () => null,
    validateAuth: async () => ({ user: { id: 4242, email: "ops@example.test" }, agentId: null }),
    runProbe: async (userId) => {
      seen.push(userId);
      return { status: "healthy", rolledBack: true, lockedTaskId: 1, probeRowId: "p" };
    },
  });

  const response = await GET(
    new NextRequest("https://example.test/api/ops/task-write-probe", { method: "GET" }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(seen, [4242]);
});

// Bonus: the HTTP boundary distinguishes the three verdicts for the workflow —
// healthy 200, inconclusive 200 (but never `success: true`), broken 500.
test("the handler maps healthy/inconclusive/misconfigured/broken to distinct responses", async () => {
  const ctx = { user: { id: 6, email: "owner@example.test" }, agentId: null };
  const make = (runProbe) =>
    state.probeHandler.createTaskWriteProbeHandler({
      checkRateLimit: async () => null,
      validateAuth: async () => ctx,
      runProbe,
    });

  const request = new NextRequest(
    "https://example.test/api/ops/task-write-probe",
    { method: "GET" },
  );

  const healthy = await make(async () => ({
    status: "healthy",
    rolledBack: true,
    lockedTaskId: 1,
    probeRowId: "p",
  }))(request);
  assert.equal(healthy.status, 200);
  assert.equal((await healthy.json()).success, true);

  const inconclusive = await make(async () => ({
    status: "inconclusive",
    reason: "no task",
  }))(request);
  assert.equal(inconclusive.status, 200);
  const inconclusiveBody = await inconclusive.json();
  assert.equal(inconclusiveBody.success, false);
  assert.equal(inconclusiveBody.probe.status, "inconclusive");

  // 503, distinct from both: the gate is unusable, but nothing is broken and no
  // rollback should follow.
  const misconfigured = await make(async () => ({
    status: "misconfigured",
    reason: "probe fixture missing",
  }))(request);
  assert.equal(misconfigured.status, 503);
  const misconfiguredBody = await misconfigured.json();
  assert.equal(misconfiguredBody.success, false);
  assert.equal(misconfiguredBody.probe.status, "misconfigured");

  const broken = await make(async () => ({
    status: "broken",
    error: "boom",
  }))(request);
  assert.equal(broken.status, 500);
  const brokenBody = await broken.json();
  assert.equal(brokenBody.success, false);
  assert.equal(brokenBody.probe.status, "broken");
});