const { spawn } = require("node:child_process");
const { closeSync, existsSync, mkdirSync, openSync, rmSync } = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { baseUrl, fail, parseArgs, repoRoot, run, runDir, writeJson } = require("../context.cjs");
const { alive, readSession, requireSession, sessionFile, sessionState } = require("../session.cjs");

const usage = `ht-verify session - one persistent headless browser for open, click, fill and shot

Usage:
  ht-verify session start [--state PATH] [--base URL] [--viewport 1440x900] [--dry-run]
  ht-verify session status
  ht-verify session stop [--dry-run]

  start   Launch headless Chromium with CDP on a free loopback port and keep it.
          Default state: browser/state.json in the run folder, else the QA flags
          state. Default base: the run folder env.json, else app.hypertask.ai.
  status  Report whether it is running, its pid and port.
  stop    Kill only this session's process group and forget it.

Console output lands in the run folder session/console.log. A second start is
refused while a session is live.

Examples:
  ht-verify session start
  ht-verify open /my-tasks
  ht-verify session stop`;

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

async function ready(port, deadline) {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1_000) });
      await response.body?.cancel();
      if (response.ok) return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  return false;
}

function stateArgument(values) {
  if (values.state) return path.resolve(values.state);
  const seeded = sessionState();
  if (seeded) return seeded;
  const selected = run(path.join(repoRoot, ".claude/skills/verify-qa/scripts/qa-login"), [values.account || "flags", "--state"], { timeout: 15_000 });
  if (selected.status !== 0) fail("no auth state and qa-login refused the account", "Pass --state with a Playwright storage state file, or --account with a qa-login name.", "usage", 2);
  return selected.stdout.trim();
}

function viewportArgument(value) {
  const match = /^([1-9][0-9]{2,4})x([1-9][0-9]{2,4})$/.exec(value || "1440x900");
  if (!match) fail(`invalid --viewport ${value}`, "Pass WxH, for example 1440x900 or 390x844.", "usage", 2);
  return { width: Number(match[1]), height: Number(match[2]) };
}

module.exports = {
  name: "session",
  summary: "one persistent headless browser for open, click, fill and shot",
  usage,
  async run(argv) {
    const { values, positionals } = parseArgs(argv, { state: "value", base: "value", viewport: "value", account: "value", "dry-run": "bool" });
    const action = positionals[0] || "status";
    const current = readSession();
    if (action === "status") {
      const running = Boolean(current && alive(current.pid));
      const data = running ? { pid: current.pid, port: current.port, base: current.base, log: current.log } : { pid: null, port: null, base: null, log: null };
      return { target: data.base?.includes("127.0.0.1") ? "local" : null, data: { running, ...data } };
    }
    if (action === "stop") {
      if (!current?.pid) return { target: null, data: { stopped: false, reason: "no session recorded" } };
      if (values["dry-run"]) return { target: null, data: { dryRun: true, steps: [`kill ${current.pid}`] } };
      const stopped = [() => process.kill(-current.pid, "SIGTERM"), () => process.kill(current.pid, "SIGTERM")].some((kill) => {
        try {
          kill();
          return true;
        } catch {
          return false;
        }
      });
      rmSync(sessionFile(), { force: true });
      return { target: null, data: { stopped, pid: current.pid } };
    }
    if (action !== "start") fail(`unknown session action ${action}`, "Pass start, status or stop.", "usage", 2);
    if (current && alive(current.pid)) {
      return { target: current.base.includes("127.0.0.1") ? "local" : "production", data: { running: true, existing: true, pid: current.pid, port: current.port, base: current.base, log: current.log } };
    }
    const state = stateArgument(values);
    if (!existsSync(state)) fail(`no auth state at ${state}`, "Run ht-verify seed for a local run, or ht-verify login flags --state to locate the QA state.", "usage", 2);
    const base = values.base || baseUrl();
    const viewport = viewportArgument(values.viewport);
    const port = await freePort();
    const log = path.join(runDir(), "session", "console.log");
    const plan = [`node session-daemon.mjs '{"port":${port},"base":"${base}","state":"${state}"}'`, `log: ${log}`];
    if (values["dry-run"]) return { target: base.includes("127.0.0.1") ? "local" : "production", data: { dryRun: true, steps: plan, port, base, state, viewport } };
    mkdirSync(path.dirname(log), { recursive: true });
    const fd = openSync(log, "a");
    const child = spawn(process.execPath, [path.join(__dirname, "../session-daemon.mjs"), JSON.stringify({ port, base, state, viewport, log, repo: repoRoot })], {
      detached: true,
      stdio: ["ignore", fd, fd],
    });
    child.unref();
    closeSync(fd);
    if (!(await ready(port, Date.now() + 30_000))) {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        process.kill(child.pid, "SIGTERM");
      }
      fail("the browser did not open its debugging port within 30s", `Read ${log} for the browser error, then run ht-verify session start again.`, "not-ready");
    }
    writeJson(sessionFile(), { pid: child.pid, port, base, state, viewport, log, startedAt: new Date().toISOString() }, 0o644);
    return { target: base.includes("127.0.0.1") ? "local" : "production", data: { running: true, existing: false, pid: child.pid, port, base, viewport, log } };
  },
};
