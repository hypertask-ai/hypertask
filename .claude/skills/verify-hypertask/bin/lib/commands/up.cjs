const { spawn } = require("node:child_process");
const { closeSync, lstatSync, openSync } = require("node:fs");
const path = require("node:path");
const {
  ensureRunDir,
  fail,
  httpStatus,
  parseArgs,
  readJson,
  repoRoot,
  run,
  runDir,
  writeJson,
} = require("../context.cjs");

const usage = `ht-verify up - start the disposable local stack (Postgres, migrations, Next dev)

Usage:
  ht-verify up [--port 3000] [--db-port 5678] [--timeout 240] [--dry-run]

  --port      Next dev port. Default 3000.
  --db-port   Published Postgres port. Default 5678, never production.
  --dry-run   Print the exact commands and write nothing.

Safe to repeat: a running container and dev server are reused. State lands in the
run folder: env.json, dev.log, dev.pid. Secrets are placeholders. Needs Docker and
node_modules installed here; a symlink to another checkout fails Next.

Example:
  ht-verify up`;

const dbName = "hypertask-verify-db";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function nodeModulesSymlinked() {
  try { return lstatSync(path.join(repoRoot, "node_modules")).isSymbolicLink(); } catch { return false; }
}

async function poll(check, deadline, interval) {
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(interval);
  }
  return false;
}

function startDev(env, port) {
  const fd = openSync(path.join(runDir(), "dev.log"), "a");
  const child = spawn("npx", ["next", "dev", "-p", String(port)], {
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
  const result = run("npx", args, { env, timeout: 300_000 });
  if (result.status !== 0) {
    fail(`npx ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim().split("\n").slice(-3).join(" ").slice(0, 400)}`, "Run the same command by hand with DATABASE_URL from the run folder env.json and fix the first error.", "failed");
  }
}

module.exports = {
  name: "up",
  summary: "start the disposable local stack (Postgres, migrations, Next dev)",
  usage,
  async run(argv) {
    const { values } = parseArgs(argv, { port: "value", "db-port": "value", "dry-run": "bool" });
    const port = Number(values.port ?? 3000);
    const dbPort = Number(values["db-port"] ?? 5678);
    for (const [flag, value] of [["--port", port], ["--db-port", dbPort]]) {
      if (!Number.isInteger(value) || value < 1024 || value > 65535) fail(`invalid ${flag} ${value}`, "Use a port between 1024 and 65535.", "usage", 2);
    }
    const baseUrl = `http://127.0.0.1:${port}`;
    const databaseUrl = `postgresql://verify:verify@127.0.0.1:${dbPort}/hypertask`;
    const env = {
      DATABASE_URL: databaseUrl,
      SESSION_SECRET: "local-verification-session-placeholder-32",
      BETTER_AUTH_SECRET: "local-verification-auth-placeholder-32",
      NEXT_PUBLIC_SITE_URL: baseUrl,
      CI: "1",
      __NEXT_AGENT_UPGRADE: "security",
    };
    const plan = [
      `docker volume create ${dbName}`,
      `docker run -d --name ${dbName} -e POSTGRES_USER=verify -e POSTGRES_PASSWORD=verify -e POSTGRES_DB=hypertask -p ${dbPort}:5432 postgres:14.0-alpine`,
      "npx prisma generate",
      "npx prisma migrate deploy",
      `npx next dev -p ${port}`,
    ];
    if (values["dry-run"]) return { target: "local", data: { dryRun: true, steps: plan, baseUrl, databaseUrl } };
    ensureRunDir();
    if (run("docker", ["info"]).status !== 0) fail("Docker is not reachable on this machine", "Start Docker, then re-run ht-verify up.", "unreadable", 2);
    docker(["volume", "create", dbName], "Run ht-verify up --dry-run and check each docker command by hand.");
    if (run("docker", ["container", "inspect", dbName]).status !== 0) {
      docker(["run", "-d", "--name", dbName, "-e", "POSTGRES_USER=verify", "-e", "POSTGRES_PASSWORD=verify", "-e", "POSTGRES_DB=hypertask", "-p", `${dbPort}:5432`, "postgres:14.0-alpine"], `Free port ${dbPort} or pass --db-port <free port>, then re-run.`);
    } else if (!run("docker", ["container", "inspect", "-f", "{{.State.Running}}", dbName]).stdout.includes("true")) {
      docker(["start", dbName], `Run docker logs ${dbName} and read the first error.`);
    }
    if (!(await poll(() => run("docker", ["exec", dbName, "pg_isready", "-U", "verify"]).status === 0, Date.now() + 60_000, 1_000))) {
      fail("Postgres did not become ready within 60s", `Run docker logs ${dbName} and read the first error.`, "not-ready");
    }
    prisma(env, ["prisma", "generate"]);
    prisma(env, ["prisma", "migrate", "deploy"]);
    const pidFile = readJson(path.join(runDir(), "dev.pid"), {});
    const reused = (await httpStatus(`${baseUrl}/login`)) === 200;
    const pid = reused ? pidFile.pid ?? null : startDev(env, port);
    writeJson(path.join(runDir(), "env.json"), { baseUrl, databaseUrl, dbContainer: dbName, port, dbPort, pid, nodeModulesSymlink: nodeModulesSymlinked() });
    if (!reused && !(await poll(async () => (await httpStatus(`${baseUrl}/login`)) === 200, Date.now() + 240_000, 2_000))) {
      fail(`Next dev did not answer 200 on ${baseUrl}/login within 240s`, `Read ${path.join(runDir(), "dev.log")} for the first error; a node_modules symlink needs npm ci in this checkout first.`, "not-ready");
    }
    return { target: "local", data: { baseUrl, databaseUrl, dbContainer: dbName, pid, reused, log: path.join(runDir(), "dev.log") } };
  },
};
