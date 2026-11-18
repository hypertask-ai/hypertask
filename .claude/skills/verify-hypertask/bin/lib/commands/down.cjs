const { unlinkSync } = require("node:fs");
const path = require("node:path");
const { dryRun, fail, localEnv, parseArgs, readJson, run, runDir } = require("../context.cjs");

const usage = `ht-verify down - stop only what ht-verify up started

Usage:
  ht-verify down [--dry-run] [--keep-db]

  --dry-run   Print what would be killed and removed, change nothing.
  --keep-db   Keep the Postgres container and volume, for a faster next run.

Kills only the pid recorded in dev.pid, then removes the hypertask-verify-db
container and volume. Never kills by process name or another session's server.

Examples:
  ht-verify down
  ht-verify down --keep-db`;

module.exports = {
  name: "down",
  summary: "stop only what ht-verify up started",
  usage,
  async run(argv) {
    const { values } = parseArgs(argv, { "dry-run": "bool", "keep-db": "bool" });
    const env = localEnv();
    const pidFile = readJson(path.join(runDir(), "dev.pid"), {});
    const pid = Number(pidFile.pid);
    if (pidFile.pid !== undefined && (!Number.isInteger(pid) || pid <= 0)) {
      fail(`refusing to kill a non-positive pid from dev.pid: ${pidFile.pid}`, "Remove the file by hand, then ht-verify up.", "refused", 2);
    }
    const container = env.dbContainer || "hypertask-verify-db";
    const steps = [];
    if (pid) steps.push(`kill ${pid}`);
    if (!values["keep-db"]) steps.push(`docker rm -f ${container}`, `docker volume rm ${container}`);
    if (values["dry-run"]) return { target: "local", data: dryRun("down", steps, { keptDatabase: Boolean(values["keep-db"]) }).data };
    const stopped = [];
    if (pid) {
      try {
        process.kill(pidFile.pid, "SIGTERM");
        stopped.push(`pid ${pidFile.pid}`);
      } catch {
        stopped.push(`pid ${pidFile.pid} was already gone`);
      }
      try {
        unlinkSync(path.join(runDir(), "dev.pid"));
      } catch {
        fail(`could not remove ${path.join(runDir(), "dev.pid")}`, "Remove it by hand so the next up does not reuse a dead pid.", "unreadable", 2);
      }
    }
    if (!values["keep-db"]) {
      run("docker", ["rm", "-f", container]);
      run("docker", ["volume", "rm", container]);
      stopped.push(`container and volume ${container}`);
    }
    return { target: "local", data: { stopped, keptDatabase: Boolean(values["keep-db"]) } };
  },
};
