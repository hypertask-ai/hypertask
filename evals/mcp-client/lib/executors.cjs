"use strict";

const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const http = require("node:http");
const { URL } = require("node:url");
const { readBoardFile, snapshotState } = require("./fixture.cjs");
const { boardStateOrCli, liveIsolationFromEnv } = require("./isolation.cjs");

function which(bin) {
  const result = spawnSync("which", [bin], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function liveClientsFromEnv(env = process.env) {
  return String(env.EVAL_LIVE_CLIENTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function isTransientNetworkError(error) {
  return /ECONNRESET|ECONNREFUSED|EPIPE|socket hang up|Network error/i.test(
    String(error?.message || error || ""),
  );
}

function postJsonOnce(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const payload = JSON.stringify(body);
    const req = http.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          accept: "application/json, text/event-stream",
          connection: "close",
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode, raw });
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function postJson(url, body, headers = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await postJsonOnce(url, body, headers);
    } catch (error) {
      lastError = error;
      if (!isTransientNetworkError(error) || attempt === 2) throw error;
    }
  }
  throw lastError;
}

function extractMcpText(raw) {
  try {
    const parsed = JSON.parse(raw);
    const text = parsed?.result?.content?.[0]?.text;
    if (typeof text === "string") return text;
    return raw;
  } catch {
    return raw;
  }
}

async function runMcpSurface(task, { url, token, board } = {}) {
  const started = Date.now();
  const tools = [];
  for (const tool of task.mcp.tools) {
    if (!url) {
      throw new Error("MCP executor needs the production MCP URL");
    }
    let response = await postJson(
      url,
      {
        jsonrpc: "2.0",
        id: tools.length + 1,
        method: "tools/call",
        params: { name: tool.name, arguments: tool.args || {} },
      },
      token ? { authorization: `Bearer ${token}` } : {},
    );
    if (isTransientNetworkError(extractMcpText(response.raw))) {
      response = await postJson(
        url,
        {
          jsonrpc: "2.0",
          id: tools.length + 1,
          method: "tools/call",
          params: { name: tool.name, arguments: tool.args || {} },
        },
        token ? { authorization: `Bearer ${token}` } : {},
      );
    }
    tools.push({
      name: tool.name,
      args: tool.args || {},
      stdout: extractMcpText(response.raw),
      status: response.status,
    });
  }
  return {
    observation: {
      tools,
      state: board ? snapshotState(board) : undefined,
    },
    wallMs: Date.now() - started,
    wallSource: "measured",
    executed: true,
    executor: "mcp",
    error: null,
  };
}

function syncBoardFromFile(board, env) {
  const boardFile = env?.EVAL_FIXTURE_BOARD;
  if (!board || !boardFile) return board;
  const next = readBoardFile(boardFile);
  for (const key of Object.keys(board)) delete board[key];
  Object.assign(board, next);
  return board;
}

function cliArgv(command, { apiUrl, token } = {}) {
  const prefix = ["--json"];
  if (apiUrl) prefix.push("--api-url", apiUrl);
  if (token) prefix.push("--token", token);
  return [...prefix, ...command.argv];
}

function spawnAsync(bin, argv, { env, timeout } = {}) {
  return new Promise((resolve) => {
    const child = spawn(bin, argv, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, timeout || 8_000);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ status: 1, stdout, stderr: error.message });
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

async function runCliSurface(task, { hypertaskBin, env, board, apiUrl, token } = {}) {
  if (!hypertaskBin) {
    return {
      observation: { commands: [], state: board ? snapshotState(board) : undefined },
      wallMs: 0,
      wallSource: "unavailable",
      executed: false,
      executor: "cli",
      error: "native hypertask CLI is not available",
    };
  }
  const started = Date.now();
  const commands = [];
  for (const command of task.cli.commands) {
    const argv = cliArgv(command, {
      apiUrl: apiUrl || env?.EVAL_API_URL,
      token: token || env?.EVAL_TOKEN,
    });
    const result = await spawnAsync(hypertaskBin, argv, { env, timeout: 8_000 });
    commands.push({
      argv: [...command.argv],
      status: result.status,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
    });
    if (result.status !== 0) {
      syncBoardFromFile(board, env);
      return {
        observation: {
          commands,
          state: board ? snapshotState(board) : undefined,
        },
        wallMs: Date.now() - started,
        wallSource: "measured",
        executed: true,
        executor: "cli",
        error: result.stderr || `hypertask exited ${result.status}`,
      };
    }
  }
  syncBoardFromFile(board, env);
  return {
    observation: {
      commands,
      state: board ? snapshotState(board) : undefined,
    },
    wallMs: Date.now() - started,
    wallSource: "measured",
    executed: true,
    executor: "cli",
    error: null,
  };
}

function buildClientPrompt(task, transport) {
  if (transport === "mcp") {
    return [
      task.prompt,
      "Use only Hypertask MCP tools.",
      `Call: ${JSON.stringify(task.mcp.tools)}`,
    ].join("\n");
  }
  return [
    task.prompt,
    "Use only the hypertask CLI.",
    `Run: ${task.cli.commands.map((command) => command.argv.join(" ")).join(" && ")}`,
  ].join("\n");
}

function parseJsonBlobs(text) {
  try {
    return [JSON.parse(text)];
  } catch {
    const matches = String(text || "").match(/\{[\s\S]*\}/g) || [];
    const parsed = [];
    for (const match of matches) {
      try {
        parsed.push(JSON.parse(match));
      } catch {
        // ignore partial objects
      }
    }
    return parsed;
  }
}

function usageFromClientJson(payloads) {
  for (const payload of payloads) {
    const usage = payload?.usage || payload?.response?.usage || payload?.result?.usage;
    const tokensIn = usage?.input_tokens ?? usage?.prompt_tokens ?? usage?.tokensIn;
    const tokensOut = usage?.output_tokens ?? usage?.completion_tokens ?? usage?.tokensOut;
    if (Number.isFinite(tokensIn) || Number.isFinite(tokensOut)) {
      return {
        tokensIn: Number.isFinite(tokensIn) ? tokensIn : null,
        tokensOut: Number.isFinite(tokensOut) ? tokensOut : null,
        source: "provider",
      };
    }
  }
  return { tokensIn: null, tokensOut: null, source: "unavailable" };
}

function observationFromClient(task, transport, stdout, state) {
  const payloads = parseJsonBlobs(stdout);
  if (transport === "mcp") {
    const tools = [];
    for (const payload of payloads) {
      const calls = payload?.tool_calls || payload?.tools || payload?.mcp?.tools || [];
      for (const call of calls) {
        tools.push({
          name: call.name || call.tool,
          args: call.args || call.arguments || {},
          stdout: call.stdout || call.result || stdout,
        });
      }
    }
    return { tools, raw: stdout, state };
  }
  const commands = [];
  for (const payload of payloads) {
    const listed = payload?.commands || payload?.cli?.commands || [];
    for (const command of listed) {
      commands.push({
        argv: command.argv || String(command).split(/\s+/),
        stdout: command.stdout || stdout,
        status: command.status ?? 0,
      });
    }
  }
  return { commands, raw: stdout, state };
}

const CLIENT_SPECS = {
  claude: {
    envBin: "CLAUDE_BIN",
    bin: "claude",
    args(task, transport) {
      return ["-p", buildClientPrompt(task, transport), "--output-format", "json"];
    },
  },
  cursor: {
    envBin: "CURSOR_BIN",
    bin: "cursor-agent",
    args(task, transport) {
      return ["-p", "--output-format", "json", buildClientPrompt(task, transport)];
    },
  },
  codex: {
    envBin: "CODEX_BIN",
    bin: "codex",
    args(task, transport) {
      return ["exec", "--json", buildClientPrompt(task, transport)];
    },
  },
};

function clientBin(client, env = process.env) {
  const spec = CLIENT_SPECS[client];
  return env[spec.envBin] || spec.bin;
}

function clientAvailable(client, env = process.env) {
  if (!liveClientsFromEnv(env).includes(client)) return false;
  return Boolean(which(clientBin(client, env)));
}

function runClientAdapter(client, task, transport, { env, isolation, hypertaskBin } = {}) {
  const spec = CLIENT_SPECS[client];
  if (!spec) {
    return { attempted: false, executed: false, error: `unknown client ${client}` };
  }
  if (!clientAvailable(client, env)) {
    return {
      attempted: false,
      executed: false,
      error: `${client} adapter is not available`,
    };
  }
  const started = Date.now();
  const argv = spec.args(task, transport);
  const result = spawnSync(clientBin(client, env), argv, {
    encoding: "utf8",
    env,
    timeout: 120_000,
  });
  const stdout = result.stdout || "";
  const state = boardStateOrCli(
    null,
    env,
    isolation || liveIsolationFromEnv(env),
    hypertaskBin,
  );
  const observation = observationFromClient(task, transport, stdout, state);
  const usage = usageFromClientJson(parseJsonBlobs(stdout));
  const error =
    result.status === 0
      ? null
      : result.stderr || `${client} exited ${result.status}`;
  return {
    observation,
    usage,
    wallMs: Date.now() - started,
    wallSource: "measured",
    attempted: true,
    executed: true,
    executor: `${client}:${transport}`,
    argv: [clientBin(client, env), ...argv],
    stdoutSha: crypto.createHash("sha256").update(stdout).digest("hex"),
    error,
  };
}

module.exports = {
  which,
  liveClientsFromEnv,
  postJson,
  runMcpSurface,
  runCliSurface,
  clientAvailable,
  runClientAdapter,
  CLIENT_SPECS,
};
