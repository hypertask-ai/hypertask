"use strict";

const { spawnSync } = require("node:child_process");
const http = require("node:http");
const { URL } = require("node:url");
const { handleMcpTool, readBoardFile, snapshotState } = require("./fixture.cjs");

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

function postJson(url, body, headers = {}) {
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
    if (url) {
      const response = await postJson(
        url,
        {
          jsonrpc: "2.0",
          id: tools.length + 1,
          method: "tools/call",
          params: { name: tool.name, arguments: tool.args || {} },
        },
        token ? { authorization: `Bearer ${token}` } : {},
      );
      tools.push({
        name: tool.name,
        args: tool.args || {},
        stdout: extractMcpText(response.raw),
        status: response.status,
      });
      continue;
    }
    if (!board) {
      throw new Error("MCP executor needs a fixture board or MCP_EVAL_URL");
    }
    tools.push({
      name: tool.name,
      args: tool.args || {},
      stdout: handleMcpTool(board, tool.name, tool.args || {}),
      status: 200,
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

function runCliSurface(task, { hypertaskBin, env, board } = {}) {
  const started = Date.now();
  const commands = [];
  for (const command of task.cli.commands) {
    const result = spawnSync(hypertaskBin, command.argv, {
      encoding: "utf8",
      env,
      timeout: 30_000,
    });
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

function observationFromClient(task, transport, stdout) {
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
    if (tools.length === 0) {
      return { tools: [], raw: stdout };
    }
    return { tools, raw: stdout };
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
  if (commands.length === 0) {
    return { commands: [], raw: stdout };
  }
  return { commands, raw: stdout };
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

function runClientAdapter(client, task, transport, { env } = {}) {
  const spec = CLIENT_SPECS[client];
  if (!spec) {
    return { executed: false, error: `unknown client ${client}` };
  }
  if (!clientAvailable(client, env)) {
    return { executed: false, error: `${client} adapter is not available` };
  }
  const started = Date.now();
  const result = spawnSync(clientBin(client, env), spec.args(task, transport), {
    encoding: "utf8",
    env,
    timeout: 120_000,
  });
  const stdout = result.stdout || "";
  const observation = observationFromClient(task, transport, stdout);
  const usage = usageFromClientJson(parseJsonBlobs(stdout));
  return {
    observation,
    usage,
    wallMs: Date.now() - started,
    wallSource: "measured",
    executed: result.status === 0,
    executor: `${client}:${transport}`,
    error:
      result.status === 0
        ? null
        : result.stderr || `${client} exited ${result.status}`,
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
