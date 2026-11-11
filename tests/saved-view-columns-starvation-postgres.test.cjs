const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { withSchemaExtensions } = require("./helpers/schema-extensions.cjs");

const root = path.resolve(__dirname, "..");
const PG_IMAGE = process.env.HTPR_PG_IMAGE || "ghcr.io/hypertask-ai/ci-postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea";
const PG_USER = "ht";
const PG_PASSWORD = "ht";
const PG_DB = "ht_test";
const REQUIRE_PG = process.env.HT_REQUIRE_PG_TESTS === "1";
const BATCH = 200;

let state = {};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (command, args, options = {}) => spawnSync(command, args, { encoding: "utf8", ...options });

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
  if (docker.status !== 0 || !docker.stdout.trim()) return { skipReason: "docker is not available on this machine" };

  let port;
  try {
    port = await freePort();
  } catch (error) {
    return { skipReason: `could not reserve a local port: ${error.message}` };
  }

  const container = `htpr9058-saved-views-${process.pid}-${Date.now()}`;
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
    return { skipReason: `could not start the postgres container: ${(start.stderr || start.stdout).trim()}`, cleanup };
  }

  let schemaSql;
  let prisma;
  try {
    let ready = false;
    for (let i = 0; i < 60; i += 1) {
      if (run("docker", ["exec", container, "pg_isready", "-U", PG_USER, "-d", PG_DB]).status === 0) {
        ready = true;
        break;
      }
      await sleep(500);
    }
    if (!ready) return { skipReason: "the postgres container did not become ready within 30s", cleanup };

    schemaSql = path.join(os.tmpdir(), `htpr9058-schema-${process.pid}-${Date.now()}.sql`);
    const diff = run(process.execPath, [
      path.join(root, "node_modules", "prisma", "build", "index.js"),
      "migrate", "diff", "--from-empty", "--to-schema",
      path.join(root, "src", "prisma", "schema.prisma"),
      "--script", "--output", schemaSql,
    ], { cwd: root, env: { ...process.env, DATABASE_URL: url } });
    if (diff.status !== 0) return { skipReason: `prisma migrate diff failed: ${(diff.stderr || diff.stdout).trim()}`, cleanup };

    const apply = run("docker", [
      "exec", "-i", container, "psql", "-U", PG_USER, "-d", PG_DB, "-v", "ON_ERROR_STOP=1",
    ], { input: withSchemaExtensions(fs.readFileSync(schemaSql, "utf8")) });
    if (apply.status !== 0) return { skipReason: `applying the Prisma schema failed: ${(apply.stderr || apply.stdout).trim()}`, cleanup };

    process.env.DATABASE_URL = url;
    delete process.env.REDIS_URL;
    const jiti = require("jiti")(__filename, {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
    });
    prisma = jiti(path.join(root, "src", "lib", "prisma.ts")).default;
    const repair = jiti(path.join(root, "src", "lib", "savedViews", "repairEmptyViewColumns.ts"));
    return { prisma, repair, cleanup };
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
    throw new Error(`HT_REQUIRE_PG_TESTS=1 but the saved view repair suite could not run: ${state.skipReason}`);
  }
});

after(async () => {
  try {
    if (state.prisma) await state.prisma.$disconnect();
  } finally {
    if (state.cleanup) state.cleanup();
  }
});

async function makeBoard(prisma, owner, { name, liveColumns }) {
  const project = await prisma.project.create({
    data: { name, title: name, ownerId: owner.id },
  });
  await prisma.project_View.create({ data: { projectId: project.id } });
  await prisma.section.create({
    data: { section_title: "Todo", projectId: project.id, deleted: !liveColumns },
  });
  return project;
}

async function makeView(prisma, owner, project, title) {
  const projectView = await prisma.project_View.findUnique({ where: { projectId: project.id } });
  return prisma.view.create({
    data: { userId: owner.id, project_view_id: projectView.id, title },
  });
}

async function makeBlankViews(prisma, owner, project, count) {
  const projectView = await prisma.project_View.findUnique({ where: { projectId: project.id } });
  await prisma.view.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      userId: owner.id,
      project_view_id: projectView.id,
      title: `Blank ${index}`,
    })),
  });
}

test("a full batch of boards with no live columns no longer starves a repairable board below it", { timeout: 240_000 }, async (t) => {
  if (state.skipReason) return t.skip(state.skipReason);
  const { prisma, repair } = state;
  const owner = await prisma.user.create({
    data: { uid: "htpr9058-owner", email: "owner@htpr9058.example", displayName: "Dummy owner" },
  });

  const deadA = await makeBoard(prisma, owner, { name: "htpr9058-dead-a", liveColumns: false });
  const deadB = await makeBoard(prisma, owner, { name: "htpr9058-dead-b", liveColumns: false });
  const live = await makeBoard(prisma, owner, { name: "htpr9058-live", liveColumns: true });

  for (const board of [deadA, deadB]) await makeBlankViews(prisma, owner, board, BATCH / 2);
  await makeView(prisma, owner, live, "Sprint");

  const repairResult = await repair.repairEmptyViewColumns();
  const remainingSkipped = await repair.countBoardsWithoutLiveColumns();

  assert.equal(repairResult.viewsFound, 1, "the batch must be spent on views that can be repaired");
  assert.equal(repairResult.viewsRepaired, 1, "the repairable view must be repaired in one run");
  assert.deepEqual(repairResult.boards.map((board) => board.projectId), [live.id]);
  assert.equal(repairResult.truncated, false);
  assert.equal(repairResult.boardsWithoutColumns, 2, "both dead boards are still reported");

  const repaired = await prisma.view.findFirst({ where: { title: "Sprint" } });
  assert.ok(Array.isArray(repaired.board_columns_view), "the repairable view gained a column list");
  assert.equal(repaired.board_columns_view.length, 1);
  assert.equal(repaired.board_columns_view[0].section_title, "Todo");

  const [{ untouched }] = await prisma.$queryRaw`SELECT COUNT(*)::int AS "untouched" FROM "View" WHERE "title" LIKE 'Blank%' AND "board_columns_view" IS NULL`;
  assert.equal(untouched, BATCH, "boards with no live columns are left untouched");
  assert.equal(remainingSkipped, 2, "the skipped board count covers the whole queue, not the batch");
});
