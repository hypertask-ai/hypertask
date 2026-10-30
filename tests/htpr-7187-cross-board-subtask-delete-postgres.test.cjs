const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const PG_IMAGE = process.env.HTPR_PG_IMAGE || "ghcr.io/hypertask-ai/ci-postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea";
const PG_USER = "ht";
const PG_PASSWORD = "ht";
const PG_DB = "ht_test";
const REQUIRE_PG = process.env.HT_REQUIRE_PG_TESTS === "1";
let state = {};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (command, args, options = {}) =>
  spawnSync(command, args, { encoding: "utf8", ...options });

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

async function provision() {
  const docker = run("docker", ["version", "--format", "{{.Server.Version}}"]);
  if (docker.status !== 0 || !docker.stdout.trim()) {
    return { skipReason: "docker is not available on this machine" };
  }

  let port;
  try {
    port = await freePort();
  } catch (error) {
    return { skipReason: `could not reserve a local port: ${error.message}` };
  }
  const container = `htpr7187-delete-${process.pid}-${Date.now()}`;
  const url = `postgresql://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${port}/${PG_DB}`;
  let searchServer;
  const cleanup = async () => {
    if (searchServer) await new Promise((resolve) => searchServer.close(resolve));
    run("docker", ["rm", "-f", container]);
  };
  const start = run("docker", [
    "run", "-d", "--name", container,
    "-e", `POSTGRES_USER=${PG_USER}`,
    "-e", `POSTGRES_PASSWORD=${PG_PASSWORD}`,
    "-e", `POSTGRES_DB=${PG_DB}`,
    "-p", `127.0.0.1:${port}:5432`, PG_IMAGE,
  ]);
  if (start.status !== 0) {
    return {
      skipReason: `could not start a throwaway postgres container: ${(start.stderr || start.stdout).trim()}`,
      cleanup,
    };
  }

  let schemaSql;
  let prisma;
  try {
    let ready = false;
    for (let i = 0; i < 60; i += 1) {
      const check = run("docker", ["exec", container, "pg_isready", "-U", PG_USER, "-d", PG_DB]);
      if (check.status === 0) {
        ready = true;
        break;
      }
      await sleep(500);
    }
    if (!ready) {
      return { skipReason: "postgres container did not become ready within 30s", cleanup };
    }

    schemaSql = path.join(os.tmpdir(), `htpr7187-schema-${process.pid}-${Date.now()}.sql`);
    const diff = run(process.execPath, [
      path.join(root, "node_modules", "prisma", "build", "index.js"),
      "migrate", "diff", "--from-empty", "--to-schema",
      path.join(root, "src", "prisma", "schema.prisma"),
      "--script", "--output", schemaSql,
    ], { cwd: root, env: { ...process.env, DATABASE_URL: url } });
    if (diff.status !== 0) {
      return { skipReason: `prisma migrate diff failed: ${(diff.stderr || diff.stdout).trim()}`, cleanup };
    }
    const apply = run("docker", [
      "exec", "-i", container, "psql", "-U", PG_USER, "-d", PG_DB, "-v", "ON_ERROR_STOP=1",
    ], { input: fs.readFileSync(schemaSql, "utf8") });
    if (apply.status !== 0) {
      return { skipReason: `applying the Prisma schema failed: ${(apply.stderr || apply.stdout).trim()}`, cleanup };
    }

    process.env.DATABASE_URL = url;
    delete process.env.REDIS_URL;
    searchServer = http.createServer((req, res) => {
      req.resume();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
    await new Promise((resolve, reject) => {
      searchServer.on("error", reject);
      searchServer.listen(0, "127.0.0.1", resolve);
    });
    process.env.TURBOPUFFER_API_KEY = "x";
    process.env.TURBOPUFFER_BASE_URL = `http://127.0.0.1:${searchServer.address().port}`;
    const jiti = require("jiti")(__filename, {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
    });
    prisma = jiti(path.join(root, "src", "lib", "prisma.ts")).default;
    const { permanentlyDeleteTask } = jiti(
      path.join(root, "src", "utils", "controllers", "tasks", "invokeTaskDelete.ts"),
    );
    const { updateTaskAndSubtasks } = jiti(
      path.join(root, "src", "pages", "api", "queues", "tasks", "taskDeleteReminder.ts"),
    );
    return { prisma, permanentlyDeleteTask, updateTaskAndSubtasks, cleanup };
  } catch (error) {
    if (prisma) await prisma.$disconnect();
    await cleanup();
    return { skipReason: `provisioning failed: ${error.message}` };
  } finally {
    if (schemaSql) fs.rmSync(schemaSql, { force: true });
  }
}

before(async () => {
  state = await provision();
  if (state.skipReason && REQUIRE_PG) {
    throw new Error(`HT_REQUIRE_PG_TESTS=1 but the cross-board subtask deletion suite could not run: ${state.skipReason}`);
  }
});

after(async () => {
  try {
    if (state.prisma) await state.prisma.$disconnect();
  } finally {
    if (state.cleanup) await state.cleanup();
  }
});

async function createTree(label) {
  const { prisma } = state;
  const owner = await prisma.user.create({
    data: { uid: `htpr7187-${label}-owner`, email: `${label}@htpr7187.example`, displayName: "Dummy owner" },
  });
  const account = await prisma.googleAccount.create({
    data: { userId: owner.id, stripe_customer_id: `dummy-htpr7187-${label}` },
  });
  const team = await prisma.team.create({
    data: { title: `Dummy ${label} team`, totalSeats: 1, googleAccountId: account.id },
  });
  const boards = [];
  for (const name of ["A", "B"]) {
    boards.push(await prisma.project.create({
      data: { name: `htpr7187-${label}-${name}`, title: `Dummy board ${name}`, ownerId: owner.id, teamId: team.id },
    }));
  }
  const [boardA, boardB] = boards;
  assert.notEqual(boardA.id, boardB.id);
  const tasks = {};
  for (const [name, projectId, parent] of [
    ["P", boardA.id, null],
    ["C1", boardA.id, "P"],
    ["G1", boardA.id, "C1"],
    ["X", boardB.id, "P"],
    ["Y", boardB.id, "X"],
  ]) {
    tasks[name] = await prisma.task.create({
      data: {
        uniqueIndex: Object.keys(tasks).length + 1, section: "Todo", title: `htpr7187-${label}-${name}`,
        description: "", projectId, userId: owner.id, status: "Normal", parentTaskId: parent ? tasks[parent].id : null,
      },
    });
  }
  return { owner, ...tasks };
}

test("permanent deletion removes same-board descendants but preserves and unlinks legacy cross-board subtasks", async (t) => {
  if (state.skipReason) return t.skip(state.skipReason);
  const { prisma, permanentlyDeleteTask } = state;
  const { owner, P, C1, G1, X, Y } = await createTree("hard");
  await prisma.task.update({ where: { id: P.id }, data: { status: "Deleted", deletedAt: new Date() } });

  assert.equal(await permanentlyDeleteTask(P.id, owner.id), "success");
  for (const task of [P, C1, G1]) {
    assert.equal(await prisma.task.findUnique({ where: { id: task.id } }), null, `${task.title} must be permanently deleted`);
  }
  const remainingX = await prisma.task.findUnique({ where: { id: X.id } });
  const remainingY = await prisma.task.findUnique({ where: { id: Y.id } });
  assert.ok(remainingX, "cross-board X must survive permanent deletion");
  assert.ok(remainingY, "cross-board Y must survive permanent deletion");
  assert.equal(remainingX.parentTaskId, null, "X must be unlinked from the deleted parent");
  assert.equal(remainingY.parentTaskId, X.id, "Y must remain a child of X");
  for (const task of [remainingX, remainingY]) {
    assert.equal(task.projectId, X.projectId);
    assert.equal(task.status, "Normal");
    assert.equal(task.deletedAt, null);
    assert.equal(task.permanentlyDeleteAt, null);
    assert.equal(task.hardDeleteProcessingAt, null);
  }
});

test("soft deletion trashes only same-board descendants and leaves legacy cross-board subtasks Normal", async (t) => {
  if (state.skipReason) return t.skip(state.skipReason);
  const { prisma, updateTaskAndSubtasks } = state;
  const { owner, P, C1, G1, X, Y } = await createTree("soft");
  const deletedAt = new Date();
  const permanentlyDeleteAt = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);

  await updateTaskAndSubtasks(P, "Deleted", deletedAt, permanentlyDeleteAt, owner.id);
  for (const task of [P, C1, G1]) {
    const trashed = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(trashed.status, "Deleted", `${task.title} must be trashed`);
    assert.equal(trashed.deletedAt.getTime(), deletedAt.getTime());
    assert.equal(trashed.permanentlyDeleteAt.getTime(), permanentlyDeleteAt.getTime());
  }
  for (const task of [X, Y]) {
    const retained = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(retained.status, "Normal", `${task.title} must stay Normal on the other board`);
    assert.equal(retained.projectId, task.projectId);
    assert.equal(retained.parentTaskId, task.parentTaskId);
    assert.equal(retained.deletedAt, null);
    assert.equal(retained.permanentlyDeleteAt, null);
    assert.equal(retained.hardDeleteProcessingAt, null);
  }
});
