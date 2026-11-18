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

Example:
  ht-verify down --keep-db`;

function ownsPid(pid) {
  const result = run("ps", ["-p", String(pid), "-o", "command="]);
  return result.status === 0 && /next/.test(result.stdout);
}

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
    let skipped = null;
    if (pid && !ownsPid(pid)) {
      skipped = `pid ${pid} no longer runs Next, left alone`;
    } else if (pid) {
      const signalled = [-pid, pid].some((target) => {
        try {
          process.kill(target, "SIGTERM");
          return true;
        } catch {
          return false;
        }
      });
      stopped.push(signalled ? `process group ${pid}` : `pid ${pid} was already gone`);
      try {
        unlinkSync(path.join(runDir(), "dev.pid"));
      } catch {
        fail(`could not remove ${path.join(runDir(), "dev.pid")}`, "Remove it by hand so the next up does not reuse a dead pid.", "unreadable", 2);
      }
    }
    if (!values["keep-db"]) {
      const results = [run("docker", ["rm", "-f", container]), run("docker", ["volume", "rm", container])];
      const failed = results.filter((result) => result.status !== 0 && !/no such (container|volume)/i.test(result.stderr));
      if (failed.length) {
        fail(`docker could not remove ${container}: ${(failed[0].stderr || failed[0].stdout).trim().split("\n").pop()}`, "Run docker rm -f hypertask-verify-db by hand, then retry.", "failed");
      }
      if (results.some((result) => result.status === 0)) stopped.push(`container and volume ${container}`);
    }
    return { target: "local", data: { stopped, skipped, keptDatabase: Boolean(values["keep-db"]) } };
  },
};
