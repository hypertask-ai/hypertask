const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const { closeSync, existsSync, lstatSync, openSync, readFileSync, unlinkSync } = require("node:fs");
const path = require("node:path");
const {
  ensureRunDir,
  fail,
  httpStatus,
  localSecrets,
  parseArgs,
  readJson,
  repoRoot,
  run,
  runDir,
  writeJson,
} = require("../context.cjs");
const { escapingSymlink, fatalLine } = require("../up-guards.cjs");

const usage = `ht-verify up - start the disposable local stack (Postgres, Redis, Soketi, Next production)

Usage:
  ht-verify up [--port 3000] [--db-port 5678] [--dry-run]

  --port      Next server port. Default 3000.
  --db-port   Postgres port, bound to 127.0.0.1 only. Default 5678.
  --dry-run   Print the exact commands and write nothing.

Repeat runs reuse containers and the server and wait up to 240s for /login 200.
A symlinked node_modules, a dead server or a fatal line in dev.log stops it in
seconds instead of at the timeout. Up builds Next unless the build matches this
port, HEAD and the working tree; edits or a branch switch rebuild, so a run
never serves code from before the change. State: env.json, dev.log, dev.pid.
Secrets are placeholders. Needs Docker and node_modules here; a symlink fails.

Example:
  ht-verify up`;
const dbName = "hypertask-verify-db";
const redisName = "hypertask-verify-redis";
const soketiName = "hypertask-verify-soketi";
const redisImage = "ghcr.io/hypertask-ai/ci-redis:7-alpine@sha256:ff02b58f971e7d7d156a1267e283fcbbeee91773b6aa36c49dac28ecfe28eadf";
const soketiImage = "ghcr.io/hypertask-ai/ci-soketi:1.6-16-alpine@sha256:5e45fe1adbf2d4ef8022d0126a3c7e4371b7b08f35784b76a2dc353954ee885c";
const redisPort = 6380;
const soketiPort = 6002;
const pusherSecret = "local-verify-secret";
const readyTimeout = 240_000;

function nodeModulesSymlinked() {
  try { return lstatSync(path.join(repoRoot, "node_modules")).isSymbolicLink(); } catch { return false; }
}

function serverAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function readText(file) {
  try { return readFileSync(file, "utf8"); } catch { return ""; }
}

async function waitForLogin(baseUrl, pid, logFile, deadline) {
  while (Date.now() < deadline) {
    if ((await httpStatus(`${baseUrl}/login`)) === 200) return { ready: true };
    const fatal = fatalLine(readText(logFile));
    if (fatal) return { ready: false, reason: fatal, logFile };
    if (!serverAlive(pid)) return { ready: false, reason: `the Next server (pid ${pid}) exited`, logFile };
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return { ready: false, reason: `Next did not answer 200 on ${baseUrl}/login within ${readyTimeout / 1000}s`, logFile };
}

async function poll(check, deadline, interval) {
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return false;
}

function startServer(env, port) {
  const fd = openSync(path.join(runDir(), "dev.log"), "a");
  const child = spawn("npx", ["next", "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: repoRoot,
    detached: true,
    stdio: ["ignore", fd, fd],
    env: { ...process.env, ...env },
  });
  child.unref();
  closeSync(fd);
  writeJson(path.join(runDir(), "dev.pid"), { pid: child.pid, port, startedAt: new Date().toISOString() });
  return child.pid;
}

function docker(args, next) {
  const result = run("docker", args, { timeout: 180_000 });
  if (result.status !== 0) {
    fail(`docker ${args[0]} failed: ${(result.stderr || result.stdout).trim().split("\n").pop()}`, next, "failed");
  }
  return result;
}

function prisma(env, args) {
  const result = run("npx", args, { env, timeout: 300_000, clear: ["DIRECT_URL", "SHADOW_DATABASE_URL"] });
  if (result.status !== 0) {
    fail(`npx ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim().split("\n").slice(-3).join(" ").slice(0, 400)}`, "Run the same command by hand with DATABASE_URL from the run folder env.json and fix the first error.", "failed");
  }
}

function ensureContainer(name, runArgs, startHint) {
  if (run("docker", ["container", "inspect", name]).status !== 0) {
    docker(runArgs, startHint);
    return;
  }
  if (!run("docker", ["container", "inspect", "-f", "{{.State.Running}}", name]).stdout.includes("true")) {
    docker(["start", name], `Run docker logs ${name} and read the first error.`);
  }
}

function sourceStamp() {
  const head = run("git", ["rev-parse", "HEAD"], { timeout: 60_000 }).stdout.trim();
  const diff = run("git", ["diff", "HEAD"], { timeout: 60_000 }).stdout;
  const untracked = run("git", ["ls-files", "--others", "--exclude-standard"], { timeout: 60_000 }).stdout
    .split("\n")
    .filter(Boolean)
    .sort()
    .map((file) => `${file}\u0000${readText(path.join(repoRoot, file))}`)
    .join("\n");
  return createHash("sha256").update(`${head}\n${diff}\n${untracked}`).digest("hex");
}

function buildReusable(buildId, builtBaseUrl, baseUrl, builtStamp, stamp) {
  return buildId && builtBaseUrl === baseUrl && builtStamp === stamp;
}

function reuseServer({ owned, answered, built }) {
  const reused = owned && answered && !built;
  return { reused, stop: owned && answered && !reused, conflict: !owned && answered };
}

async function stopServer(pid) {
  for (const target of [-pid, pid]) {
    try { process.kill(target, "SIGTERM"); } catch {}
  }
  try { unlinkSync(path.join(runDir(), "dev.pid")); } catch {}
  await poll(async () => !serverAlive(pid), Date.now() + 10_000, 250);
}

function ensureProductionBuild(env, baseUrl, previous, stamp) {
  const current = buildReusable(existsSync(path.join(repoRoot, ".next", "BUILD_ID")), previous.builtBaseUrl, baseUrl, previous.buildStamp, stamp);
  if (current) return false;
  const result = run("npx", ["next", "build"], { env, timeout: 900_000 });
  if (result.status !== 0) {
    fail(
      `next build failed: ${(result.stderr || result.stdout).trim().split("\n").slice(-5).join(" ").slice(0, 400)}`,
      "Run npx next build in this checkout with the same env as env.json and fix the first error.",
      "failed",
    );
  }
  return true;
}

function verifyPusherEnv(baseUrl) {
  return {
    REDIS_URL: `redis://127.0.0.1:${redisPort}`,
    NEXT_PUBLIC_BASEURL: baseUrl,
    BETTER_AUTH_URL: baseUrl,
    NEXT_TELEMETRY_DISABLED: "1",
    NEXT_PUBLIC_HT_LOCAL_REALTIME: "1",
    NEXT_PUBLIC_PUSHER_KEY: "app-key",
    NEXT_PUBLIC_PUSHER_HOST: "127.0.0.1",
    NEXT_PUBLIC_PUSHER_PORT: String(soketiPort),
    NEXT_PUBLIC_PUSHER_USE_TLS: "false",
    NEXT_PUBLIC_PUSHER_CLUSTER: "mt1",
    PUSHER_APP_ID: "app-id",
    PUSHER_KEY: "app-key",
    PUSHER_SECRET: pusherSecret,
    PUSHER_HOST: "127.0.0.1",
    PUSHER_PORT: String(soketiPort),
    PUSHER_USE_TLS: "false",
    PUSHER_CLUSTER: "mt1",
  };
}

module.exports = {
  buildReusable,
  name: "up",
  reuseServer,
  sourceStamp,
  summary: "start the disposable local stack (Postgres, Redis, Soketi, Next production)",
  usage,
  async run(argv) {
    const { values } = parseArgs(argv, { port: "value", "db-port": "value", "dry-run": "bool" });
    const port = Number(values.port ?? 3000);
    const dbPort = Number(values["db-port"] ?? 5678);
    if (![port, dbPort].every((value) => Number.isInteger(value) && value >= 1024 && value <= 65535)) {
      fail(`invalid port: --port ${port} --db-port ${dbPort}`, "Use ports between 1024 and 65535.", "usage", 2);
    }
    const baseUrl = `http://127.0.0.1:${port}`;
    const databaseUrl = `postgresql://verify:verify@127.0.0.1:${dbPort}/hypertask`;
    const env = {
      DATABASE_URL: databaseUrl,
      ...localSecrets,
      NEXT_PUBLIC_SITE_URL: baseUrl,
      CI: "1",
      PREMERGE_NEXT_BUILD: "1",
      __NEXT_AGENT_UPGRADE: "security",
      ...verifyPusherEnv(baseUrl),
    };
    const plan = [
      `docker volume create ${dbName}`,
      `docker run -d --name ${dbName} -e POSTGRES_USER=verify -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=hypertask -v ${dbName}:/var/lib/postgresql/data -p 127.0.0.1:${dbPort}:5432 postgres:14.0-alpine`,
      `docker run -d --name ${redisName} -p 127.0.0.1:${redisPort}:6379 ${redisImage}`,
      `docker run -d --name ${soketiName} -p 127.0.0.1:${soketiPort}:6001 -e SOKETI_DEFAULT_APP_ID=app-id -e SOKETI_DEFAULT_APP_KEY=app-key -e SOKETI_DEFAULT_APP_SECRET=${pusherSecret} ${soketiImage}`,
      "npx prisma generate",
      "npx prisma migrate deploy",
      "npx next build",
      `npx next start -H 127.0.0.1 -p ${port}`,
    ];
    if (values["dry-run"]) return { target: "local", data: { dryRun: true, steps: plan, baseUrl, databaseUrl } };
    const symlink = escapingSymlink(path.join(repoRoot, "node_modules"), repoRoot);
    if (symlink) {
      try { unlinkSync(path.join(runDir(), "env.json")); } catch {}
      fail(`node_modules is a symlink to ${symlink}; Next resolves from this checkout and cannot find next/package.json`, "Run npm ci in this checkout so node_modules is a real install here, then run ht-verify up.", "node-modules-symlink", 2);
    }
    ensureRunDir();
    if (run("docker", ["info"]).status !== 0) fail("Docker is not reachable on this machine", "Start Docker, then re-run ht-verify up.", "unreadable", 2);
    docker(["volume", "create", dbName], "Run ht-verify up --dry-run and check each docker command by hand.");
    const previous = readJson(path.join(runDir(), "env.json"), {});
    if (previous.dbPort && previous.dbPort !== dbPort) {
      fail(`the existing ${dbName} container publishes port ${previous.dbPort}, not ${dbPort}`, `Run ht-verify down, then ht-verify up --db-port ${dbPort}.`, "refused");
    }
    if (run("docker", ["container", "inspect", dbName]).status !== 0) {
      docker(["run", "-d", "--name", dbName, "-e", "POSTGRES_USER=verify", "-e", "POSTGRES_PASSWORD=verify", "-e", "POSTGRES_DB=hypertask", "-v", `${dbName}:/var/lib/postgresql/data`, "-p", `127.0.0.1:${dbPort}:5432`, "postgres:14.0-alpine"], `Free port ${dbPort} or pass --db-port <free port>, then re-run.`);
    } else if (!run("docker", ["container", "inspect", "-f", "{{.State.Running}}", dbName]).stdout.includes("true")) {
      docker(["start", dbName], `Run docker logs ${dbName} and read the first error.`);
    }
    if (!(await poll(() => run("docker", ["exec", dbName, "pg_isready", "-U", "verify"]).status === 0, Date.now() + 60_000, 1_000))) {
      fail("Postgres did not become ready within 60s", `Run docker logs ${dbName} and read the first error.`, "not-ready");
    }
    ensureContainer(
      redisName,
      ["run", "-d", "--name", redisName, "-p", `127.0.0.1:${redisPort}:6379`, redisImage],
      `Free port ${redisPort} or remove ${redisName}, then re-run.`,
    );
    if (!(await poll(() => run("docker", ["exec", redisName, "redis-cli", "ping"]).stdout.includes("PONG"), Date.now() + 60_000, 1_000))) {
      fail("Redis did not become ready within 60s", `Run docker logs ${redisName} and read the first error.`, "not-ready");
    }
    ensureContainer(
      soketiName,
      ["run", "-d", "--name", soketiName, "-p", `127.0.0.1:${soketiPort}:6001`, "-e", "SOKETI_DEFAULT_APP_ID=app-id", "-e", "SOKETI_DEFAULT_APP_KEY=app-key", "-e", `SOKETI_DEFAULT_APP_SECRET=${pusherSecret}`, soketiImage],
      `Free port ${soketiPort} or remove ${soketiName}, then re-run.`,
    );
    prisma(env, ["prisma", "generate"]);
    prisma(env, ["prisma", "migrate", "deploy"]);
    const stamp = sourceStamp();
    const built = ensureProductionBuild(env, baseUrl, previous, stamp);
    const pidFile = readJson(path.join(runDir(), "dev.pid"), {});
    const { reused, stop, conflict } = reuseServer({
      owned: previous.mode === "production" && previous.port === port && serverAlive(pidFile.pid ?? 0),
      answered: (await httpStatus(`${baseUrl}/login`)) === 200,
      built,
    });
    if (conflict) {
      fail(`port ${port} answers /login but this run does not own that server`, `Run ht-verify down, then ht-verify up --port ${port} to serve this checkout's build.`, "refused");
    }
    if (stop) await stopServer(pidFile.pid);
    const pid = reused ? pidFile.pid ?? null : startServer(env, port);
    writeJson(path.join(runDir(), "env.json"), {
      baseUrl,
      mode: "production",
      builtBaseUrl: baseUrl,
      buildStamp: stamp,
      databaseUrl,
      dbContainer: dbName,
      redisContainer: redisName,
      soketiContainer: soketiName,
      port,
      dbPort,
      redisPort,
      soketiPort,
      pid,
      nodeModulesSymlink: nodeModulesSymlinked(),
    });
    if (!reused) {
      const outcome = await waitForLogin(baseUrl, pid, path.join(runDir(), "dev.log"), Date.now() + readyTimeout);
      if (!outcome.ready) {
        try { unlinkSync(path.join(runDir(), "env.json")); } catch {}
        fail(`Next is not serving: ${outcome.reason}`, `Read ${outcome.logFile} for the first error, fix it, then run ht-verify up again.`, "not-ready");
      }
    }
    return { target: "local", data: { baseUrl, databaseUrl, dbContainer: dbName, pid, reused, log: path.join(runDir(), "dev.log") } };
  },
};
