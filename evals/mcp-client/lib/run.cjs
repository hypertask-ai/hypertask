"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CLIENTS, TRANSPORTS, loadCatalog } = require("./catalog.cjs");
const { measuredUsage } = require("./tokens.cjs");
const { gradeObservation } = require("./grade.cjs");
const { createBoard, writeBoardFile } = require("./fixture.cjs");
const { startProductionHarness, resolveHypertaskBin } = require("./production.cjs");
const {
  clientAvailable,
  isTransientNetworkError,
  runClientAdapter,
  runCliSurface,
  runMcpSurface,
} = require("./executors.cjs");
const {
  bindTask,
  liveIsolationFromEnv,
  missingRequiredClients,
} = require("./isolation.cjs");
const {
  indexTranscripts,
  isIndependentRecording,
  loadTranscripts,
  recordingKey,
  transcriptsPath,
  writeTranscripts,
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

async function executeSurfaceOnce(task, transport, ctx) {
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
    apiUrl: ctx.env?.EVAL_API_URL,
    token: ctx.token || ctx.env?.EVAL_TOKEN,
  });
}

async function executeSurface(task, transport, ctx) {
  let live = await executeSurfaceOnce(task, transport, ctx).catch((error) => ({
    error: error.message,
    observation: {},
    wallMs: 0,
    executor: transport,
  }));
  if (!task.mutating && live.error && isTransientNetworkError(live.error)) {
    live = await executeSurfaceOnce(task, transport, ctx).catch((error) => ({
      error: error.message,
      observation: {},
      wallMs: 0,
      executor: transport,
    }));
  }
  return live;
}

async function runLiveRow(task, client, transport, ctx) {
  const isolation = liveIsolationFromEnv(ctx.env);
  const bound = bindTask(task, isolation);
  if (!clientAvailable(client, ctx.env)) {
    return {
      skipped: true,
      unavailable: true,
      reason: `${client} adapter is not available`,
    };
  }
  if (task.mutating && ctx.env.EVAL_LIVE_WRITES !== "1") {
    return { skipped: true, unavailable: true, reason: "mutating live writes are disabled" };
  }
  if (task.mutating && !isolation) {
    return {
      skipped: false,
      row: rowFromParts({
        task: bound,
        client,
        transport,
        grade: {
          pass: false,
          reason: "live writes require EVAL_PROJECT_ID for an isolated project",
        },
        usage: emptyUsage("unavailable"),
        wallMs: null,
        wallSource: "unavailable",
        mode: "live",
        executor: `${client}:${transport}`,
      }),
    };
  }
  const live = runClientAdapter(client, bound, transport, {
    env: ctx.env,
    isolation,
    hypertaskBin: ctx.hypertaskBin || resolveHypertaskBin(ctx.env),
  });
  if (!live.attempted) {
    return { skipped: true, unavailable: true, reason: live.error };
  }
  const grade = live.error
    ? { pass: false, reason: live.error }
    : gradeObservation(bound, transport, live.observation);
  return {
    skipped: false,
    recording: {
      taskId: bound.id,
      client,
      transport,
      provenance: `${client}:${transport}`,
      capturedAt: new Date().toISOString(),
      argv: live.argv || [],
      stdoutSha: live.stdoutSha || null,
      observation: live.observation,
      usage: live.usage,
      wallMs: live.wallMs,
      wallSource: live.wallSource,
    },
    row: rowFromParts({
      task: bound,
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
      const tokenRows = subset.filter((row) => Number.isFinite(row.tokensIn) || Number.isFinite(row.tokensOut));
      const wallRows = subset.filter((row) => Number.isFinite(row.wallMs));
      byClient[client][transport] = {
        tasks: subset.length,
        passed,
        failed: subset.length - passed,
        successRate: subset.length === 0 ? 0 : passed / subset.length,
        tokensIn: tokenRows.length
          ? tokenRows.reduce((sum, row) => sum + (Number.isFinite(row.tokensIn) ? row.tokensIn : 0), 0)
          : null,
        tokensOut: tokenRows.length
          ? tokenRows.reduce((sum, row) => sum + (Number.isFinite(row.tokensOut) ? row.tokensOut : 0), 0)
          : null,
        wallMs: wallRows.length
          ? wallRows.reduce((sum, row) => sum + row.wallMs, 0)
          : null,
        toolCalls: subset.reduce((sum, row) => sum + row.toolCalls, 0),
        live: subset.filter((row) => row.mode === "live").length,
        usageSource: tokenRows.some((row) => row.usageSource === "provider")
          ? "provider"
          : tokenRows.some((row) => row.usageSource === "transcript")
            ? "transcript"
            : "unavailable",
        wallSource: wallRows.length ? wallRows[0].wallSource || "measured" : "unavailable",
      };
    }
  }
  const passed = rows.filter((row) => row.pass).length;
  return {
    tasks: rows.length,
    passed,
    failed: rows.length - passed,
    successRate: rows.length === 0 ? null : passed / rows.length,
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

async function withIsolatedFixture(run, env = process.env) {
  const board = createBoard();
  const boardFile = path.join(
    os.tmpdir(),
    `mcp-client-eval-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.json`,
  );
  writeBoardFile(board, boardFile);
  const harness = await startProductionHarness(board, env, { boardFile });
  try {
    return await run({
      board,
      boardFile,
      mcpUrl: harness.mcpUrl,
      token: harness.token,
      hypertaskBin: harness.hypertaskBin,
      env: {
        ...harness.env,
        EVAL_FIXTURE_BOARD: boardFile,
      },
      close: harness.close,
    });
  } finally {
    await harness.close();
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
    if (!ctx.hypertaskBin) {
      throw new Error("native hypertask CLI is required for CLI surface measurements");
    }
    for (const task of catalog.tasks) {
      if (task.mutating && options.allowWrites === false) continue;
      for (const transport of TRANSPORTS) {
        resetBoard(ctx.board, ctx.boardFile);
        const live = await executeSurface(task, transport, ctx).catch((error) => ({
          error: error.message,
          observation: {},
          wallMs: 0,
          executor: transport,
        }));
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
        if (options.record && live.observation) {
          recordings.push({
            taskId: task.id,
            transport,
            provenance: live.executor,
            capturedAt: new Date().toISOString(),
            observation: live.observation,
            wallMs: live.wallMs,
            wallSource: "measured",
          });
        }
      }
    }
  }, options.env);
  return { surfaces, recordings };
}

async function runEval(options = {}) {
  const catalog = loadCatalog(options.catalogPath);
  const mode = options.mode || "fixture";
  const env = options.env || process.env;
  let transcripts = { version: catalog.version, recordings: [] };
  try {
    transcripts = loadTranscripts(options.transcriptsPath || transcriptsPath());
  } catch {
    transcripts = { version: catalog.version, recordings: [] };
  }
  const byRecording = indexTranscripts(transcripts);
  const rows = [];
  const liveRecordings = [];
  let surfaces = [];

  const measureSurfaces =
    mode === "fixture" ||
    (mode === "live" && options.surfaces !== false && (options.surfaces === true || env.EVAL_MEASURE_SURFACES === "1"));
  if (measureSurfaces) {
    const executed = await runSurfaceCatalog(catalog, {
      allowWrites: true,
      env,
      record: Boolean(options.recordTranscripts),
    });
    surfaces = executed.surfaces;
  }

  if (mode === "live") {
    for (const task of catalog.tasks) {
      for (const client of CLIENTS) {
        for (const transport of TRANSPORTS) {
          const live = await runLiveRow(task, client, transport, {
            env,
            hypertaskBin: options.hypertaskBin,
          });
          if (!live.skipped) {
            rows.push(live.row);
            if (live.recording) liveRecordings.push(live.recording);
          }
        }
      }
    }
    const required = String(options.requireClients || env.EVAL_REQUIRE_CLIENTS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const missing = missingRequiredClients(rows, required);
    if (missing.length) {
      throw new Error(
        `required clients did not produce MCP and CLI rows: ${missing.join(", ")}`,
      );
    }
  } else if (mode === "replay") {
    for (const task of catalog.tasks) {
      for (const client of CLIENTS) {
        for (const transport of TRANSPORTS) {
          const recording = byRecording.get(recordingKey(task.id, client, transport));
          if (!recording || recording.provenance !== `${client}:${transport}`) continue;
          rows.push(replayFromTranscript(task, client, transport, recording));
        }
      }
    }
  }

  if (options.recordTranscripts && liveRecordings.length) {
    writeTranscripts(
      {
        version: catalog.version,
        recordings: liveRecordings,
      },
      options.transcriptsPath || transcriptsPath(),
    );
  }

  const surfaceSummary = surfaces.length
    ? summarizeSurfaces(surfaces)
    : rows.length
      ? summarizeSurfaces(
          rows.map((row) => ({
            transport: row.transport,
            pass: row.pass,
            wallMs: row.wallMs || 0,
            toolCalls: row.toolCalls,
          })),
        )
      : undefined;
  const failedSurfaces = surfaces.filter((row) => !row.pass).length;
  const rowSummary = summarize(rows);

  return {
    generatedAt: options.now || new Date().toISOString(),
    label: options.label || "mcp-client-eval",
    baseline: options.baseline || null,
    mode,
    catalogVersion: catalog.version,
    rows,
    surfaces,
    summary: {
      ...rowSummary,
      ...(surfaceSummary ? { byTransport: surfaceSummary } : {}),
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
