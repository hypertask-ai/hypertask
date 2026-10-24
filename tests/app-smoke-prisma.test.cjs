const assert = require("node:assert/strict");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const image = process.env.HTPR_PG_IMAGE || "ghcr.io/hypertask-ai/ci-postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea";

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, ...env },
  });
  assert.equal(result.status, 0, [result.error?.message, result.stdout, result.stderr].filter(Boolean).join("\n"));
  return result.stdout.trim();
}

test("a client generated from the stale candidate seeds its migrated schema instead of P2022", { timeout: 180_000 }, async (t) => {
  const docker = spawnSync("docker", ["info", "--format", "{{.ServerVersion}}"], { encoding: "utf8", timeout: 10_000 });
  if (docker.status !== 0) {
    assert.notEqual(process.env.HT_REQUIRE_PG_TESTS, "1", "Docker is required for this test");
    t.skip("Docker is unavailable");
    return;
  }
  mkdirSync(path.join(root, "node_modules/.cache"), { recursive: true });
  const scratch = mkdtempSync(path.join(root, "node_modules/.cache/stale-prisma-"));
  const container = `yper4-680-${process.pid}`;
  const password = randomBytes(24).toString("hex");
  try {
    run("docker", ["run", "-d", "--name", container,
      "-e", "POSTGRES_USER=smoke", "-e", `POSTGRES_PASSWORD=${password}`, "-e", "POSTGRES_DB=smoke",
      "-p", "127.0.0.1::5432", image]);
    run("docker", ["exec", container, "sh", "-c", "until pg_isready -U smoke -d smoke >/dev/null 2>&1; do sleep 0.2; done"]);
    const port = run("docker", ["port", container, "5432/tcp"]).split(":").at(-1);
    const databaseUrl = new URL(`postgresql://127.0.0.1:${port}/smoke`);
    databaseUrl.username = "smoke";
    databaseUrl.password = password;
    const env = { DATABASE_URL: databaseUrl.href };
    for (const name of ["candidate", "production"]) {
      const dir = path.join(scratch, name);
      mkdirSync(dir);
      writeFileSync(path.join(dir, "schema.prisma"), `generator client {
  provider = "prisma-client-js"
  output = "./client"
}
datasource db {
  provider = "postgresql"
}
model SmokeUser {
  id Int @id @default(autoincrement())
  displayName String
  ${name === "production" ? "newField String?" : ""}
}
`);
      writeFileSync(path.join(dir, "prisma.config.ts"), 'export default { schema: "./schema.prisma", datasource: { url: process.env.DATABASE_URL } };\n');
      run(process.execPath, ["node_modules/prisma/build/index.js", "generate", "--config", path.join(dir, "prisma.config.ts")], env);
    }
    const candidate = path.join(scratch, "candidate");
    mkdirSync(path.join(candidate, "migrations/001"), { recursive: true });
    writeFileSync(path.join(candidate, "migrations/001/migration.sql"), 'CREATE TABLE "SmokeUser" (id SERIAL PRIMARY KEY, "displayName" TEXT NOT NULL);');
    writeFileSync(path.join(candidate, "migrations/migration_lock.toml"), 'provider = "postgresql"\n');
    run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy", "--config", path.join(candidate, "prisma.config.ts")], env);
    const { PrismaPg } = require("@prisma/adapter-pg");
    for (const name of ["production", "candidate"]) {
      const { PrismaClient } = require(path.join(scratch, name, "client"));
      const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) });
      try {
        if (name === "production") {
          await assert.rejects(client.smokeUser.create({ data: { displayName: "stale candidate" } }), error => error.code === "P2022");
          console.log("production client + candidate migrations: P2022 reproduced");
        } else {
          const user = await client.smokeUser.create({ data: { displayName: "stale candidate" } });
          assert.equal(user.displayName, "stale candidate");
          console.log("candidate client + candidate migrations: seed passed");
        }
      } finally {
        await client.$disconnect();
      }
    }
  } finally {
    spawnSync("docker", ["rm", "-f", container], { stdio: "ignore", timeout: 30_000 });
    rmSync(scratch, { recursive: true, force: true });
  }
});
