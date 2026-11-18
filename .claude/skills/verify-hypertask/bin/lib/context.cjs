const { spawnSync } = require("node:child_process");
const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const net = require("node:net");
const { homedir } = require("node:os");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../../../..");

class CliError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.code = options.code || "failed";
    this.next = options.next || "";
    this.exit = options.exit ?? 1;
    this.data = options.data || {};
  }
}

function fail(message, next, code = "failed", exit = 1) {
  throw new CliError(message, { next, code, exit });
}

function parseArgs(argv, spec = {}) {
  const values = {};
  const positionals = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      values.help = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const [name, inline] = arg.slice(2).split("=", 2);
    const kind = spec[name];
    if (!kind) fail(`unknown option --${name}`, "Run ht-verify help <command> for the flags it takes.", "usage", 2);
    if (kind === "bool") {
      values[name] = true;
      continue;
    }
    const value = inline ?? argv[(index += 1)];
    if (value === undefined || (inline === undefined && value.startsWith("--"))) {
      fail(`--${name} needs a value`, `Pass it as --${name} <value>.`, "usage", 2);
    }
    values[name] = value;
  }
  return { values, positionals };
}

function runDir() {
  return process.env.HT_VERIFY_RUN || path.join(process.env.HT_VERIFY_HOME || path.join(homedir(), ".local/state/ht-verify"), "default");
}

function ensureRunDir() {
  mkdirSync(runDir(), { recursive: true });
  return runDir();
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value, mode = 0o644) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { mode });
}

function run(file, args, options = {}) {
  const result = spawnSync(file, args, {
    cwd: options.cwd || repoRoot,
    encoding: "utf8",
    timeout: options.timeout || 120_000,
    env: { ...process.env, ...(options.env || {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) {
    fail(`could not run ${path.basename(file)}: ${result.error.message}`, options.next || "Check the helper path and retry.", "unreadable", 2);
  }
  return { status: result.status, stdout: result.stdout || "", stderr: result.stderr || "" };
}

async function httpStatus(url, timeout = 5_000) {
  try {
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(timeout) });
    await response.body?.cancel();
    return response.status;
  } catch {
    return 0;
  }
}

function tcpReachable(host, port, timeout = 2_000) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeout);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function localEnv() {
  return readJson(path.join(runDir(), "env.json"), {});
}

function baseUrl() {
  return process.env.HT_VERIFY_BASE || localEnv().baseUrl || "http://127.0.0.1:3000";
}

function stateFile() {
  return process.env.HT_VERIFY_STATE || path.join(runDir(), "browser/state.json");
}

function dryRun(command, steps, data = {}) {
  return { command, ok: true, target: data.target || null, run: runDir(), data: { dryRun: true, steps, ...data }, evidence: [], error: null };
}

module.exports = {
  CliError,
  baseUrl,
  dryRun,
  ensureRunDir,
  fail,
  httpStatus,
  localEnv,
  parseArgs,
  readJson,
  repoRoot,
  run,
  runDir,
  stateFile,
  tcpReachable,
  writeJson,
};
