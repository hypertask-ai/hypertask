const { existsSync } = require("node:fs");
const path = require("node:path");
const {
  baseUrl: defaultBase,
  fail,
  httpStatus,
  localEnv,
  parseArgs,
  repoRoot,
  run,
  runDir,
  stateFile: defaultState,
  tcpReachable,
} = require("../context.cjs");

const usage = `ht-verify doctor - is this instance worth driving?

Usage:
  ht-verify doctor [--target local|production]
  ht-verify doctor --target local [--base URL] [--state PATH]
  ht-verify doctor --target production --ticket HTPR-9471 [--account flags] [--state PATH] [--expect 985]

  --target     local (default): the stack from ht-verify up. production: app.hypertask.ai.
  --base       local only: base URL, default from the run folder env.json.
  --state      auth state to verify. local default browser/state.json, production default qa-login.
  --account    production account name for qa-login. Default flags (user 985).
  --expect     expected user id. Read from qa-login unless given.
  --ticket     production only: requires ship-check deployed to print deployed ok.

Local needs /login 200, a reachable database and a live recorded dev pid. Production
needs the merge deployment success and the QA identity. Read-only: it writes nothing.

Examples:
  ht-verify doctor
  ht-verify doctor --target production --ticket HTPR-9471
  ht-verify doctor --target production --ticket HTPR-9471 --account plain`;

function recorded(check) {
  return { name: check.name, ok: check.ok, detail: check.detail };
}

async function localChecks(values) {
  const env = localEnv();
  const base = values.base || defaultBase();
  const state = values.state || defaultState();
  const status = await httpStatus(`${base}/login`);
  const checks = [recorded({ name: "page /login", ok: status === 200, detail: `${base}/login answered ${status || "no response"}` })];
  if (env.databaseUrl) {
    let target = null;
    try {
      target = new URL(env.databaseUrl);
    } catch {
      target = null;
    }
    const reachable = target ? await tcpReachable(target.hostname, Number(target.port || 5432)) : false;
    checks.push(recorded({ name: "database", ok: reachable, detail: target ? `${target.hostname}:${target.port || 5432} reachable: ${reachable}` : "databaseUrl in env.json is not a URL" }));
  } else {
    checks.push(recorded({ name: "database", ok: false, detail: "no databaseUrl in the run folder env.json; run ht-verify up first" }));
  }
  const pid = Number(env.pid);
  let pidAlive = false;
  try {
    pidAlive = Number.isInteger(pid) && pid > 0 && (process.kill(pid, 0), true);
  } catch {
    pidAlive = false;
  }
  checks.push(recorded({ name: "dev pid", ok: pidAlive, detail: Number.isInteger(pid) && pid > 0 ? `pid ${pid} alive: ${pidAlive}` : "no dev pid recorded" }));
  let origin = null;
  try {
    origin = new URL(base).origin;
  } catch {
    origin = null;
  }
  if (state && existsSync(state) && origin) {
    const identity = run(path.join(repoRoot, ".claude/skills/verify-hypertask/scripts/qa-identity"), [state, "--base-url", origin], { timeout: 30_000 });
    checks.push(recorded({ name: "identity", ok: identity.status === 0, detail: (identity.stdout || identity.stderr).trim().split("\n").pop() }));
  } else {
    checks.push(recorded({ name: "identity", ok: false, detail: origin ? `no auth state at ${state}; run ht-verify seed` : `base URL is not a URL: ${base}` }));
  }
  if (status !== 200) {
    const symlink = env.nodeModulesSymlink;
    checks.push(recorded({ name: "node_modules", ok: !symlink, detail: symlink ? "symlinked to another checkout, Next cannot compile; run npm ci here" : "installed in this checkout" }));
  }
  return { target: "local", data: { baseUrl: base, state, checks, ok: checks.every((check) => check.ok) }, all: checks.every((check) => check.ok) };
}

function productionChecks(values) {
  if (!values.ticket) fail("production doctor needs --ticket", "Pass --ticket HTPR-9471 so the deployment check reads that ticket's merge sha.", "usage", 2);
  if (!/^[A-Z]+-[0-9]+$/.test(values.ticket)) fail(`invalid --ticket ${values.ticket}`, "Pass the board ticket key, for example HTPR-9471.", "usage", 2);
  const deployed = run(path.join(repoRoot, ".claude/skills/ship/scripts/ship-check"), ["deployed", values.ticket], { timeout: 60_000 });
  const checks = [recorded({ name: "deployment", ok: deployed.status === 0, detail: (deployed.stdout || deployed.stderr).trim().split("\n").pop() })];
  let state = values.state;
  let expect = values.expect;
  if (!state) {
    const account = values.account || "flags";
    const selected = run(path.join(repoRoot, ".claude/skills/verify-hypertask/scripts/qa-login"), [account], { timeout: 15_000 });
    if (selected.status !== 0) fail(`qa-login refused ${account}`, "Run ht-verify login <account> to list the accounts it accepts.", "usage", 2);
    let parsed;
    try {
      parsed = JSON.parse(selected.stdout);
    } catch {
      fail(`qa-login printed something other than JSON for ${account}`, "Run ht-verify login without --no-verify to see the error, then retry.", "unreadable", 2);
    }
    state = parsed.stateFile;
    expect = expect ?? String(parsed.userId);
  }
  if (!state) fail("guest has no auth state", "Pick a signed-in account with --account, for example flags.", "usage", 2);
  const identity = run(path.join(repoRoot, ".claude/skills/verify-hypertask/scripts/qa-identity"), [state, ...(expect ? ["--expect", String(expect)] : [])], { timeout: 30_000 });
  checks.push(recorded({ name: "identity", ok: identity.status === 0, detail: (identity.stdout || identity.stderr).trim().split("\n").pop() }));
  return { target: "production", data: { ticket: values.ticket, state, checks, ok: checks.every((check) => check.ok) }, all: checks.every((check) => check.ok) };
}

module.exports = {
  name: "doctor",
  summary: "check that the instance is worth driving",
  usage,
  async run(argv) {
    const { values } = parseArgs(argv, { target: "value", base: "value", state: "value", account: "value", expect: "value", ticket: "value" });
    const target = values.target || "local";
    if (!["local", "production"].includes(target)) fail(`unknown --target ${target}`, "Pass --target local or --target production.", "usage", 2);
    const result = target === "local" ? await localChecks(values) : productionChecks(values);
    const failed = result.data.checks.filter((check) => !check.ok);
    return {
      ok: result.all,
      target: result.target,
      data: { ...result.data, failed: failed.map((check) => check.name) },
      error: result.all ? null : {
        code: "not-ready",
        message: `doctor failed: ${failed.map((check) => check.name).join(", ")}`,
        next: target === "local" ? "Run ht-verify up, then ht-verify seed and ht-verify login flags; re-run ht-verify doctor." : "Fix the failing check above, then run ht-verify doctor again.",
      },
    };
  },
};
