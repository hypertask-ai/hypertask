const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
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
  const container = `htpr7182-inbox-${process.pid}-${Date.now()}`;
  const url = `postgresql://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${port}/${PG_DB}`;
  const cleanup = () => run("docker", ["rm", "-f", container]);
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

    schemaSql = path.join(os.tmpdir(), `htpr7182-schema-${process.pid}-${Date.now()}.sql`);
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
    const jiti = require("jiti")(__filename, {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
    });
    prisma = jiti(path.join(root, "src", "lib", "prisma.ts")).default;
    const notificationGetAll = jiti(
      path.join(root, "src", "utils", "controllers", "notifications", "getAll.ts"),
    ).default;
    const { expandInboxApiResponse } = jiti(
      path.join(root, "src", "utils", "helperFunctions", "inboxHelpers.ts"),
    );
    return { prisma, notificationGetAll, expandInboxApiResponse, cleanup };
  } catch (error) {
    if (prisma) await prisma.$disconnect();
    cleanup();
    return { skipReason: `provisioning failed: ${error.message}` };
  } finally {
    if (schemaSql) fs.rmSync(schemaSql, { force: true });
  }
}

before(async () => {
  state = await provision();
  if (state.skipReason && REQUIRE_PG) {
    throw new Error(`HT_REQUIRE_PG_TESTS=1 but the removed-member inbox suite could not run: ${state.skipReason}`);
  }
});

after(async () => {
  try {
    if (state.prisma) await state.prisma.$disconnect();
  } finally {
    if (state.cleanup) state.cleanup();
  }
});

test("removed member cannot read private board tasks, comments, or blocked items through old inbox notifications", async (t) => {
  if (state.skipReason) return t.skip(state.skipReason);
  const { prisma, notificationGetAll, expandInboxApiResponse } = state;
  const recipient = await prisma.user.create({
    data: { uid: "htpr7182-recipient", email: "recipient@htpr7182.example", displayName: "Dummy recipient" },
  });
  const owner = await prisma.user.create({
    data: { uid: "htpr7182-owner", email: "owner@htpr7182.example", displayName: "Dummy owner and commenter" },
  });
  const boards = [];
  for (const name of ["A", "B"]) {
    const account = await prisma.googleAccount.create({
      data: { userId: owner.id, stripe_customer_id: `dummy-htpr7182-${name}` },
    });
    const team = await prisma.team.create({
      data: { title: `Dummy team ${name}`, totalSeats: 2, googleAccountId: account.id },
    });
    const project = await prisma.project.create({
      data: { name: `htpr7182-private-board-${name}`, title: `Dummy private board ${name}`, ownerId: owner.id, teamId: team.id },
    });
    await prisma.member_Team.create({
      data: { userId: recipient.id, teamId: team.id, googleAccountId: account.id },
    });
    const member = await prisma.member.create({
      data: { userId: recipient.id, projectId: project.id, agentId: null, role: "Member" },
    });
    const task = await prisma.task.create({
      data: { uniqueIndex: 1, section: "Todo", title: `htpr7182-board-${name}-task`, description: "", projectId: project.id, userId: owner.id },
    });
    const comment = await prisma.comment.create({
      data: { taskId: task.id, creatorId: owner.id, text: `htpr7182-board-${name}-private-comment` },
    });
    const notification = await prisma.notification.create({
      data: { type: "Comment", userId: recipient.id, fromUserId: owner.id, projectId: project.id, taskId: task.id, commentId: comment.id },
    });
    boards.push({ team, project, member, task, comment, notification });
  }
  const [boardA, boardB] = boards;
  assert.notEqual(boardB.project.ownerId, recipient.id);
  assert.equal(boardB.member.agentId, null);
  assert.equal(boardB.member.role, "Member");
  const blocked = await prisma.task.create({
    data: {
      uniqueIndex: 2, section: "Todo", title: "htpr7182-board-B-blocked-task", description: "",
      projectId: boardB.project.id, userId: owner.id,
      waitingOnUserId: recipient.id, waitingOnSetById: owner.id, waitingOnSetAt: new Date(),
    },
  });

  const beforeRemoval = await notificationGetAll(String(recipient.id));
  assert.equal(beforeRemoval.status, 200, "pre-removal controller read must succeed");
  for (const board of boards) {
    const row = beforeRemoval.json.notifications.find((item) => item.id === board.notification.id);
    assert.ok(row, `board ${board.project.name} notification must appear before removal`);
    assert.equal(row.task.id, board.task.id);
    assert.equal(row.task.title, board.task.title);
    assert.equal(row.comment.text, board.comment.text);
  }
  assert.ok(beforeRemoval.json.notifications.some((item) => item.waitingOnSynthetic && item.taskId === blocked.id),
    "board B blocked item must appear before removal");
  const beforeTabs = expandInboxApiResponse(beforeRemoval.json).structuredData.data.flat();
  assert.ok(beforeTabs.some((item) => item.taskId === boardB.task.id), "board B notification must be in structuredData before removal");
  assert.ok(beforeTabs.some((item) => item.waitingOnSynthetic && item.taskId === blocked.id), "board B blocked item must be in structuredData before removal");

  await prisma.member.delete({ where: { id: boardB.member.id } });
  await prisma.member_Team.delete({ where: { userId_teamId: { userId: recipient.id, teamId: boardB.team.id } } });
  const updatedTitle = "htpr7182-board-B-secret-title-after-removal";
  await prisma.task.update({ where: { id: boardB.task.id }, data: { title: updatedTitle } });
  assert.equal(await prisma.member.count({ where: { userId: recipient.id, projectId: boardB.project.id } }), 0);
  assert.equal(await prisma.member_Team.count({ where: { userId: recipient.id, teamId: boardB.team.id } }), 0);
  assert.equal(await prisma.member.count({ where: { userId: recipient.id, projectId: boardA.project.id } }), 1);
  assert.equal(await prisma.member_Team.count({ where: { userId: recipient.id, teamId: boardA.team.id } }), 1);
  assert.ok(await prisma.notification.findUnique({ where: { id: boardB.notification.id } }), "old notification must still exist");
  assert.equal((await prisma.task.findUnique({ where: { id: blocked.id } })).waitingOnUserId, recipient.id);

  const afterRemoval = await notificationGetAll(String(recipient.id));
  assert.equal(afterRemoval.status, 200, "post-removal controller read must succeed");
  const retained = afterRemoval.json.notifications.find((item) => item.id === boardA.notification.id);
  assert.ok(retained, "board A notification must still return after board B removal");
  assert.equal(retained.task.title, boardA.task.title);
  assert.equal(retained.comment.text, boardA.comment.text);

  const json = JSON.stringify(afterRemoval.json);
  for (const secret of [boardB.task.title, updatedTitle, boardB.comment.text, blocked.title, boardB.project.name, boardB.project.title]) {
    assert.ok(!json.includes(secret), `removed board B content leaked anywhere in JSON response: ${secret}`);
  }
  const expanded = expandInboxApiResponse(afterRemoval.json);
  for (const row of [...afterRemoval.json.notifications, ...expanded.structuredData.data.flat()]) {
    assert.ok(row, "structuredData must reference existing notifications");
    assert.notEqual(row.taskId, boardB.task.id, "removed board B task must not be returned");
    assert.notEqual(row.taskId, blocked.id, "removed board B blocked task must not be returned");
    assert.notEqual(row.projectId, boardB.project.id);
    assert.notEqual(row.commentId, boardB.comment.id);
    assert.notEqual(row.task?.id, boardB.task.id);
    assert.notEqual(row.task?.id, blocked.id);
    assert.notEqual(row.comment?.id, boardB.comment.id);
  }
  assert.ok(expanded.structuredData.data.flat().some((item) => item.id === boardA.notification.id), "board A must remain in structuredData");
  assert.ok(!afterRemoval.json.notifications.some((item) => item.waitingOnSynthetic), "removed blocked items must not return");
});
