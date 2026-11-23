const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const test = require("node:test");
const { setTimeout } = require("node:timers/promises");

const root = resolve(__dirname, "..");
const CHAT = "QA Sync Chat";

const LOGIN = `import os
def login_for_session(env=None):
    env = os.environ if env is None else env
    name = str(env.get("MULTIPROMPT_TAB") or "").strip()
    if not name:
        return None
    return (name, "/tmp/unused-token")
`;

const STUB = `import json, os, sys, time
home = os.environ["HOME"]
open(os.path.join(home, "called.json"), "w").write(json.dumps(sys.argv))
open(os.path.join(home, "pid"), "w").write(str(os.getpid()) + "\\n" + str(os.getppid()))
time.sleep(30)
`;

function stop(home) {
  const pidFile = join(home, "pid");
  if (!existsSync(pidFile)) return;
  for (const line of readFileSync(pidFile, "utf8").split("\n")) {
    const pid = Number(line);
    if (!pid) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
}

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "board-sync-"));
  const login = join(home, ".claude/skills/hypertask-work/session_login.py");
  mkdirSync(join(login, ".."), { recursive: true });
  writeFileSync(login, LOGIN);
  return home;
}

function installStub(home) {
  const target = join(home, ".claude/skills/board-drain/sync");
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, STUB);
  return target;
}

function hookCommand() {
  const settings = JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8"));
  return settings.hooks.Stop[0].hooks[0].command;
}

function runHook(home, env) {
  return spawnSync("sh", ["-c", hookCommand()], {
    cwd: root,
    env: { ...process.env, HOME: home, ...env },
    timeout: 3000,
    encoding: "utf8",
  });
}

async function called(home) {
  const file = join(home, "called.json");
  for (let i = 0; i < 40; i += 1) {
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
    await setTimeout(50);
  }
  return null;
}

test("the turn-end hook runs board-drain sync and returns without waiting", async () => {
  const home = fixture();
  try {
    installStub(home);
    const result = runHook(home, { MULTIPROMPT_TAB: CHAT, SHIP_SESSION_NAME: "" });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
    const argv = await called(home);
    assert.ok(argv, "board-drain/sync was not called");
    assert.equal(argv[0].endsWith(".claude/skills/board-drain/sync"), true);
    const flag = (name) => argv[argv.indexOf(name) + 1];
    assert.equal(flag("--board"), "15");
    assert.equal(flag("--label"), CHAT);
    assert.equal(flag("--name"), CHAT);
    const parent = Number(readFileSync(join(home, "pid"), "utf8").split("\n")[1]);
    const command = readFileSync(`/proc/${parent}/cmdline`, "utf8").split("\0");
    assert.equal(command[0].endsWith("timeout"), true);
    assert.equal(command[1], "180");
  } finally {
    stop(home);
    rmSync(home, { recursive: true, force: true });
  }
});

test("the turn-end hook fails when board-drain sync is missing", () => {
  const home = fixture();
  try {
    const result = runHook(home, { MULTIPROMPT_TAB: CHAT, SHIP_SESSION_NAME: "" });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /board-drain\/sync/);
    assert.equal(existsSync(join(home, "called.json")), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a chat with no name does not run board-drain sync", async () => {
  const home = fixture();
  try {
    installStub(home);
    const result = runHook(home, { MULTIPROMPT_TAB: "", SHIP_SESSION_NAME: "" });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "");
    assert.equal(await called(home), null);
  } finally {
    stop(home);
    rmSync(home, { recursive: true, force: true });
  }
});
