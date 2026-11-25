const test = require("node:test");
const assert = require("node:assert/strict");
const { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const isolated = path.join(path.resolve(__dirname, ".."), "scripts/run-app-smoke-isolated.sh");

function dockerFixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "htpr-9698-redis-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const candidate = path.join(dir, "candidate");
  const trusted = path.join(dir, "trusted");
  const bin = path.join(dir, "bin");
  mkdirSync(candidate, { recursive: true });
  mkdirSync(path.join(trusted, "scripts"), { recursive: true });
  mkdirSync(bin, { recursive: true });
  const log = path.join(dir, "docker.log");
  writeFileSync(log, "");
  const docker = path.join(bin, "docker");
  writeFileSync(
    docker,
    [
      "#!/bin/bash",
      'printf \'%s\\n\' "$*" >> "$SMOKE_DOCKER_LOG"',
      'if [ "$1" = "logs" ]; then printf "PostgreSQL init process complete; ready for start up.\\n"; exit 0; fi',
      'case " $* " in',
      '  *" --name ht-smoke-seed-"*) exit 1 ;;',
      "esac",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  chmodSync(docker, 0o755);
  return { candidate, trusted, bin, log };
}

test("the isolated stack starts a Redis container and hands its URL to the seed", (t) => {
  const fixture = dockerFixture(t);
  const env = { ...process.env, PATH: `${fixture.bin}${path.delimiter}${process.env.PATH}`, SMOKE_DOCKER_LOG: fixture.log };
  delete env.NODE_OPTIONS;
  const result = spawnSync("bash", [isolated, fixture.candidate, fixture.trusted], { encoding: "utf8", env, timeout: 60000 });
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  const calls = readFileSync(fixture.log, "utf8").split("\n");
  const redisRun = calls.find((line) => line.startsWith("run -d --name ht-smoke-redis-"));
  assert.ok(redisRun, calls.join("\n"));
  assert.match(redisRun, /--network ht-smoke-net-/);
  assert.match(redisRun, /--user 999:1000/);
  assert.match(redisRun, /--cap-drop ALL/);
  assert.match(redisRun, /ghcr\.io\/hypertask-ai\/ci-redis:7-alpine@sha256:[0-9a-f]{64}/);
  const redisName = redisRun.match(/--name (ht-smoke-redis-\S+)/)[1];
  const seedRun = calls.find((line) => line.includes("--name ht-smoke-seed-"));
  assert.ok(seedRun, calls.join("\n"));
  assert.ok(seedRun.includes(`-e REDIS_URL=redis://${redisName}:6379`), seedRun);
});
