"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { CLIENTS, TRANSPORTS, loadCatalog } = require("./catalog.cjs");
const { estimateUsage } = require("./tokens.cjs");
const { gradeObservation } = require("./grade.cjs");

const CLIENT_WALL_MS = {
  claude: { mcp: 18, cli: 11 },
  cursor: { mcp: 20, cli: 12 },
  codex: { mcp: 17, cli: 10 },
};

function replayObservation(task, transport) {
  if (transport === "mcp") {
    return { tools: task.mcp.tools.map((tool) => ({ ...tool })) };
  }
  return {
    commands: task.cli.commands.map((command) => ({ argv: [...command.argv] })),
  };
}

function replayWallMs(task, client, transport) {
  const perCall = CLIENT_WALL_MS[client]?.[transport] ?? 15;
  const calls =
    transport === "mcp" ? task.mcp.tools.length : task.cli.commands.length;
  return perCall * calls;
}

function runLiveCli(task, hypertaskBin, env) {
  const started = Date.now();
  const commands = [];
  for (const command of task.cli.commands) {
    const result = spawnSync(hypertaskBin, command.argv, {
      encoding: "utf8",
      env,
      timeout: 30_000,
    });
    commands.push({
      argv: command.argv,
      status: result.status,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
    });
    if (result.status !== 0) {
      return {
        observation: { commands },
        wallMs: Date.now() - started,
        error: result.stderr || `hypertask exited ${result.status}`,
      };
    }
  }
  return {
    observation: { commands },
    wallMs: Date.now() - started,
    error: null,
  };
}

function shouldExecuteLive(task, mode) {
  if (mode !== "live") return false;
  if (task.mutating && process.env.EVAL_LIVE_WRITES !== "1") return false;
  return true;
}

function runOne({ task, client, transport, mode, hypertaskBin, env }) {
  const usage = estimateUsage(task, client, transport);
  let observation = replayObservation(task, transport);
  let wallMs = replayWallMs(task, client, transport);
  let executed = false;
  let error = null;

  if (
    shouldExecuteLive(task, mode) &&
    transport === "cli" &&
    hypertaskBin
  ) {
    const live = runLiveCli(task, hypertaskBin, env);
    observation = live.observation;
    wallMs = live.wallMs;
    error = live.error;
    executed = true;
  }

  const grade = error
    ? { pass: false, reason: error }
    : gradeObservation(task, transport, observation);

  return {
    taskId: task.id,
    prompt: task.prompt,
    client,
    transport,
    pass: grade.pass,
    reason: grade.reason,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    wallMs,
    toolCalls: usage.toolCalls,
    mutating: Boolean(task.mutating),
    mode: executed ? "live" : "replay",
  };
}

function summarize(rows) {
  const byClient = {};
  for (const client of CLIENTS) {
    byClient[client] = {};
    for (const transport of TRANSPORTS) {
      const subset = rows.filter(
        (row) => row.client === client && row.transport === transport,
      );
      const passed = subset.filter((row) => row.pass).length;
      byClient[client][transport] = {
        tasks: subset.length,
        passed,
        failed: subset.length - passed,
        successRate: subset.length === 0 ? 0 : passed / subset.length,
        tokensIn: subset.reduce((sum, row) => sum + row.tokensIn, 0),
        tokensOut: subset.reduce((sum, row) => sum + row.tokensOut, 0),
        wallMs: subset.reduce((sum, row) => sum + row.wallMs, 0),
        toolCalls: subset.reduce((sum, row) => sum + row.toolCalls, 0),
      };
    }
  }
  const passed = rows.filter((row) => row.pass).length;
  return {
    tasks: rows.length,
    passed,
    failed: rows.length - passed,
    successRate: rows.length === 0 ? 0 : passed / rows.length,
    byClient,
  };
}

function runEval(options = {}) {
  const catalog = loadCatalog(options.catalogPath);
  const mode = options.mode || "replay";
  const hypertaskBin = options.hypertaskBin || process.env.HYPERTASK_BIN || "hypertask";
  const env = options.env || process.env;
  const rows = [];
  for (const task of catalog.tasks) {
    for (const client of CLIENTS) {
      for (const transport of TRANSPORTS) {
        rows.push(
          runOne({
            task,
            client,
            transport,
            mode,
            hypertaskBin,
            env,
          }),
        );
      }
    }
  }
  return {
    generatedAt: options.now || new Date().toISOString(),
    label: options.label || "mcp-client-eval",
    baseline: options.baseline || null,
    mode,
    catalogVersion: catalog.version,
    rows,
    summary: summarize(rows),
  };
}

function writeReport(report, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${JSON.stringify(report, null, 2)}\n`);
}

module.exports = {
  CLIENT_WALL_MS,
  replayObservation,
  runOne,
  runEval,
  summarize,
  writeReport,
};
