const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

for (const stale of [true, false]) {
  test(`app-smoke seeds with the migrated candidate client (${stale ? "stale schema" : "matching cached schema"})`, (t) => {
    const fixture = mkdtempSync(path.join(os.tmpdir(), "app-smoke-schema-"));
    t.after(() => rmSync(fixture, { recursive: true, force: true }));
    const candidate = path.join(fixture, "candidate");
    const trusted = path.join(fixture, "trusted");
    const bin = path.join(fixture, "bin");
    const log = path.join(fixture, "docker.jsonl");
    for (const root of [candidate, trusted]) {
      mkdirSync(path.join(root, "src/prisma/migrations/001"), { recursive: true });
      writeFileSync(path.join(root, "package.json"), "{}");
      writeFileSync(path.join(root, "package-lock.json"), "{}");
      writeFileSync(path.join(root, "src/prisma/schema.prisma"), "model User { id Int @id }\n");
      writeFileSync(path.join(root, "src/prisma/migrations/001/migration.sql"), 'CREATE TABLE "User" (id INTEGER PRIMARY KEY);\n');
    }
    mkdirSync(path.join(trusted, "scripts"));
    mkdirSync(path.join(trusted, "node_modules"));
    if (stale) {
      mkdirSync(path.join(trusted, "src/prisma/migrations/002"));
      writeFileSync(path.join(trusted, "src/prisma/migrations/002/migration.sql"), 'ALTER TABLE "User" ADD COLUMN "newField" TEXT;\n');
      writeFileSync(path.join(trusted, "src/prisma/schema.prisma"), "model User { id Int @id newField String? }\n");
    }
    mkdirSync(bin);
    writeFileSync(path.join(bin, "docker"), `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync(process.env.SMOKE_DOCKER_LOG, JSON.stringify(args) + "\\n");
if (args[0] === "logs") console.log("PostgreSQL init process complete; ready for start up.");
if (args[0] === "run" && args.some(arg => arg.endsWith("seed-core-actions-smoke.mjs"))) process.exit(42);
`, { mode: 0o755 });

    const result = spawnSync("bash", ["scripts/run-app-smoke-isolated.sh", candidate, trusted], {
      encoding: "utf8",
      timeout: 10_000,
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        RUNNER_TEMP: fixture,
        CORE_SMOKE_TRUSTED_DEPENDENCIES: "true",
        SMOKE_DOCKER_LOG: log,
      },
    });
    assert.equal(result.status, 42, `${result.stdout}\n${result.stderr}`);
    const calls = readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line));
    const runs = calls.filter(args => args[0] === "run");
    const migration = runs.find(args => args.includes("deploy"));
    const seed = runs.find(args => args.some(arg => arg.endsWith("seed-core-actions-smoke.mjs")));
    assert.ok(migration, "candidate migrations must run before seeding");
    assert.ok(seed, "trusted seed must be invoked");
    assert.ok(runs.indexOf(migration) < runs.indexOf(seed));
    const volumes = args => args.flatMap((arg, index) => arg === "-v" ? [args[index + 1]] : []);
    const dependencies = volumes(migration).find(mount => mount.endsWith(":/app/node_modules:ro"));
    assert.ok(dependencies);
    assert.ok(volumes(seed).includes(dependencies), "seed and migrations must use the same generated Prisma client");
    assert.ok(volumes(seed).includes(`${candidate}:/app:ro`), "seed must load candidate app modules");
    assert.ok(seed.includes("CORE_SMOKE_APP_ROOT=/app"));
    assert.ok(volumes(seed).includes(`${trusted}/scripts:/trusted:ro`), "seed implementation must stay production-pinned");
    assert.equal(seed.at(-1), "/trusted/seed-core-actions-smoke.mjs");
    assert.ok(seed.includes("--read-only"));
    assert.ok(seed.includes("no-new-privileges"));
    const network = args => args[args.indexOf("--network") + 1];
    assert.equal(network(seed), network(migration));
    assert.ok(calls.some(args => args[0] === "network" && args[1] === "create" && args.includes("--internal") && args.includes(network(seed))));
    const generate = runs.find(args => args.some(arg => arg.includes("./node_modules/.bin/prisma generate")));
    if (stale) {
      assert.ok(generate, "schema mismatch must generate the candidate client instead of using the production cache");
      assert.ok(runs.indexOf(generate) < runs.indexOf(migration));
      assert.ok(volumes(generate).includes(`${candidate}:/app:ro`));
      assert.ok(volumes(generate).includes(dependencies.replace(/:ro$/, "")));
    } else {
      assert.equal(generate, undefined, "matching inputs should reuse the production dependency cache");
      assert.equal(dependencies, `${trusted}/node_modules:/app/node_modules:ro`);
    }
  });
}
