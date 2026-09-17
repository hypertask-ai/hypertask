"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CLIENTS, TRANSPORTS, loadCatalog } = require("./catalog.cjs");
const { measuredUsage } = require("./tokens.cjs");
const { gradeObservation } = require("./grade.cjs");
const {
  createBoard,
  startFixtureServer,
  fixtureBinPath,
  writeBoardFile,
} = require("./fixture.cjs");
const {
  clientAvailable,
  runClientAdapter,
  runCliSurface,
  runMcpSurface,
} = require("./executors.cjs");
const {
  indexTranscripts,
  isIndependentRecording,
  loadTranscripts,
  recordingKey,
  transcriptsPath,
} = require("./transcripts.cjs");

function toolCallsFor(task, transport) {
  return transport === "mcp" ? task.mcp.tools.length : task.cli.commands.length;
}

function emptyUsage(source) {
  return { tokensIn: null, tokensOut: null, source };
}

function rowFromParts({
  task,
  client,
  transport,
  grade,
  usage,
  wallMs,
  wallSource,
  mode,
  executor,
}) {
  return {
    taskId: task.id,
    prompt: task.prompt,
    client,
    transport,
    pass: grade.pass,
    reason: grade.reason,
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    usageSource: usage.source,
    wallMs,
    wallSource,
    toolCalls: toolCallsFor(task, transport),
    mutating: Boolean(task.mutating),
    mode,
    executor,
  };
}

function replayFromTranscript(task, client, transport, recording) {
  if (!recording) {
    return rowFromParts({
      task,
      client,
      transport,
      grade: { pass: false, reason: "missing independent transcript" },
      usage: emptyUsage("unavailable"),
      wallMs: null,
      wallSource: "unavailable",
      mode: "replay",
      executor: "transcript",
    });
  }
  if (!isIndependentRecording(task, recording, transport)) {
    return rowFromParts({
      task,
      client,
      transport,
      grade: { pass: false, reason: "transcript is a copy of the expected plan" },
      usage: emptyUsage("unavailable"),
      wallMs: null,
      wallSource: "unavailable",
      mode: "replay",
      executor: "transcript",
    });
  }
  const grade = gradeObservation(task, transport, recording.observation);
  const usage = measuredUsage(recording.usage, recording.usage?.source || "transcript");
  return rowFromParts({
    task,
    client,
    transport,
    grade,
    usage,
    wallMs: Number.isFinite(recording.wallMs) ? recording.wallMs : null,
    wallSource: recording.wallSource || "transcript",
    mode: "replay",
    executor: "transcript",
  });
}

async function executeSurface(task, transport, ctx) {
  if (transport === "mcp") {
    return runMcpSurface(task, {
      url: ctx.mcpUrl,
      token: ctx.token,
      board: ctx.board,
    });
  }
  return runCliSurface(task, {
    hypertaskBin: ctx.hypertaskBin,
    env: ctx.env,
    board: ctx.board,
  });
}

async function runLiveRow(task, client, transport, ctx) {
  if (!clientAvailable(client, ctx.env)) {
    return {
      skipped: true,
      reason: `${client} adapter did not run`,
    };
  }
  if (task.mutating && ctx.env.EVAL_LIVE_WRITES !== "1") {
    return { skipped: true, reason: "mutating live writes are disabled" };
  }
  const live = runClientAdapter(client, task, transport, { env: ctx.env });
  if (!live.executed) {
    return { skipped: true, reason: live.error };
  }
  const grade = live.error
    ? { pass: false, reason: live.error }
    : gradeObservation(task, transport, live.observation);
  return {
    skipped: false,
    row: rowFromParts({
      task,
      client,
      transport,
      grade,
      usage: measuredUsage(live.usage, "unavailable"),
      wallMs: live.wallMs,
      wallSource: live.wallSource,
      mode: "live",
      executor: live.executor,
    }),
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
        tokensIn: subset.reduce(
          (sum, row) => sum + (Number.isFinite(row.tokensIn) ? row.tokensIn : 0),
          0,
        ),
        tokensOut: subset.reduce(
          (sum, row) => sum + (Number.isFinite(row.tokensOut) ? row.tokensOut : 0),
          0,
        ),
        wallMs: subset.reduce(
          (sum, row) => sum + (Number.isFinite(row.wallMs) ? row.wallMs : 0),
          0,
        ),
        toolCalls: subset.reduce((sum, row) => sum + row.toolCalls, 0),
        live: subset.filter((row) => row.mode === "live").length,
        usageSource: subset.some((row) => row.usageSource === "provider")
          ? "provider"
          : subset.some((row) => row.usageSource === "transcript")
            ? "transcript"
            : subset.some((row) => row.usageSource === "estimate")
              ? "estimate"
              : "unavailable",
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

function summarizeSurfaces(surfaces) {
  const byTransport = {};
  for (const transport of TRANSPORTS) {
    const subset = surfaces.filter((row) => row.transport === transport);
    const passed = subset.filter((row) => row.pass).length;
    byTransport[transport] = {
      tasks: subset.length,
      passed,
      failed: subset.length - passed,
      successRate: subset.length === 0 ? 0 : passed / subset.length,
      wallMs: subset.reduce((sum, row) => sum + row.wallMs, 0),
      toolCalls: subset.reduce((sum, row) => sum + row.toolCalls, 0),
    };
  }
  return byTransport;
}

async function withIsolatedFixture(run) {
  const board = createBoard();
  const boardFile = path.join(
    os.tmpdir(),
    `mcp-client-eval-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
  writeBoardFile(board, boardFile);
  const fixture = await startFixtureServer(board);
  const env = {
    ...process.env,
    EVAL_FIXTURE_BOARD: boardFile,
  };
  try {
    return await run({
      board,
      boardFile,
      mcpUrl: fixture.url,
      hypertaskBin: fixtureBinPath(),
      env,
      close: fixture.close,
    });
  } finally {
    await fixture.close();
    fs.rmSync(boardFile, { force: true });
  }
}

function resetBoard(board, boardFile) {
  const fresh = createBoard();
  for (const key of Object.keys(board)) delete board[key];
  Object.assign(board, fresh);
  writeBoardFile(board, boardFile);
}

async function runSurfaceCatalog(catalog, options) {
  const surfaces = [];
  const recordings = [];
  await withIsolatedFixture(async (ctx) => {
    for (const task of catalog.tasks) {
      if (task.mutating && options.allowWrites === false) continue;
      for (const transport of TRANSPORTS) {
        resetBoard(ctx.board, ctx.boardFile);
        const live = await executeSurface(task, transport, ctx);
        const grade = live.error
          ? { pass: false, reason: live.error }
          : gradeObservation(task, transport, live.observation);
        surfaces.push({
          taskId: task.id,
          transport,
          pass: grade.pass,
          reason: grade.reason,
          wallMs: live.wallMs,
          wallSource: "measured",
          toolCalls: toolCallsFor(task, transport),
          executor: live.executor,
        });
        if (options.recordTranscripts) {
          for (const client of CLIENTS) {
            recordings.push({
              taskId: task.id,
              client,
              transport,
              observation: live.observation,
              usage: emptyUsage("unavailable"),
              wallMs: live.wallMs,
              wallSource: "measured",
            });
          }
        }
      }
    }
  });
  return { surfaces, recordings };
}

async function runEval(options = {}) {
  const catalog = loadCatalog(options.catalogPath);
  const mode = options.mode || "fixture";
  const env = options.env || process.env;
  let transcripts;
  try {
    transcripts = loadTranscripts(options.transcriptsPath || transcriptsPath());
  } catch (error) {
    if (!options.recordTranscripts) throw error;
    transcripts = { version: catalog.version, recordings: [] };
  }
  let byRecording = indexTranscripts(transcripts);
  const rows = [];
  let surfaces = [];

  if (mode === "fixture" || options.recordTranscripts) {
    const executed = await runSurfaceCatalog(catalog, {
      allowWrites: true,
      recordTranscripts: Boolean(options.recordTranscripts),
    });
    surfaces = executed.surfaces;
    if (options.recordTranscripts) {
      const dest = options.transcriptsOut || transcriptsPath();
      fs.writeFileSync(
        dest,
        `${JSON.stringify({ version: catalog.version, recordings: executed.recordings }, null, 2)}\n`,
      );
      transcripts = loadTranscripts(dest);
      byRecording = indexTranscripts(transcripts);
    }
  }

  for (const task of catalog.tasks) {
    for (const client of CLIENTS) {
      for (const transport of TRANSPORTS) {
        if (mode === "live") {
          const live = await runLiveRow(task, client, transport, {
            env,
            hypertaskBin: options.hypertaskBin,
          });
          if (!live.skipped) {
            rows.push(live.row);
            continue;
          }
        }
        rows.push(
          replayFromTranscript(
            task,
            client,
            transport,
            byRecording.get(recordingKey(task.id, client, transport)),
          ),
        );
      }
    }
  }

  const surfaceSummary = summarizeSurfaces(surfaces);
  const failedSurfaces = surfaces.filter((row) => !row.pass).length;

  return {
    generatedAt: options.now || new Date().toISOString(),
    label: options.label || "mcp-client-eval",
    baseline: options.baseline || null,
    mode,
    catalogVersion: catalog.version,
    rows,
    surfaces,
    summary: {
      ...summarize(rows),
      byTransport: surfaceSummary,
      surfaceFailed: failedSurfaces,
    },
  };
}

function writeReport(report, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${JSON.stringify(report, null, 2)}\n`);
}

module.exports = {
  CLIENTS,
  TRANSPORTS,
  replayFromTranscript,
  runEval,
  summarize,
  writeReport,
  withIsolatedFixture,
};
