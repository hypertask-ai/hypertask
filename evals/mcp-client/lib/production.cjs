"use strict";

const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const { createRequire } = require("node:module");
const { startIsolatedApi } = require("./isolated-api.cjs");
const { which } = require("./executors.cjs");

const SRC_ROOT = path.resolve(__dirname, "..", "..", "..", "src");
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const EVAL_TOKEN = "eval-token";
const requireFromRepo = createRequire(path.join(REPO_ROOT, "package.json"));

function resolveHypertaskBin(env = process.env) {
  return env.EVAL_HYPERTASK_BIN || which("hypertask") || "";
}

function disableKeepAlive() {
  http.globalAgent.keepAlive = false;
  https.globalAgent.keepAlive = false;
  try {
    const axios = requireFromRepo("axios");
    axios.defaults.httpAgent = new http.Agent({ keepAlive: false });
    axios.defaults.httpsAgent = new https.Agent({ keepAlive: false });
    axios.defaults.headers.common.Connection = "close";
  } catch {
    // axios loads with the MCP stack
  }
}

function loadProductionMcp() {
  disableKeepAlive();
  const jiti = requireFromRepo("jiti")(__filename, {
    interopDefault: true,
    alias: { "@": SRC_ROOT },
    cache: false,
  });
  const { handleStatelessMcpRequest } = jiti(
    path.join(SRC_ROOT, "lib/mcp-server/stateless-http.ts"),
  );
  const { MCP_TOOLS } = jiti(path.join(SRC_ROOT, "lib/mcp-server/tools/index.ts"));
  const { getConfig } = jiti(path.join(SRC_ROOT, "lib/mcp-server/config/index.ts"));
  return { handleStatelessMcpRequest, MCP_TOOLS, getConfig };
}

function isolateHelpTool(tools, board) {
  return tools.map((tool) => {
    if (tool.name !== "hypertask_search_help_docs") return tool;
    return {
      ...tool,
      execute: async () =>
        JSON.stringify({
          success: true,
          articles: [
            {
              title: board.help,
              url: "https://help.hypertask.ai/connect-claude",
              content: board.help,
            },
          ],
          total: 1,
        }),
    };
  });
}

async function startProductionMcpServer(apiUrl, board) {
  process.env.MCP_SELF_API_URL = apiUrl;
  const { handleStatelessMcpRequest, MCP_TOOLS, getConfig } = loadProductionMcp();
  getConfig().apiUrl = apiUrl;
  const tools = isolateHelpTool(MCP_TOOLS, board);

  const server = http.createServer(async (req, res) => {
    req.on("error", () => {});
    res.on("error", () => {});
    try {
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value == null) continue;
        headers.set(key, Array.isArray(value) ? value.join(",") : value);
      }
      if (!headers.has("authorization")) {
        headers.set("authorization", `Bearer ${EVAL_TOKEN}`);
      }
      const request = new Request(`http://127.0.0.1${req.url}`, {
        method: req.method,
        headers,
        body: body.length && req.method !== "GET" && req.method !== "HEAD" ? body : undefined,
      });
      const response = await handleStatelessMcpRequest(
        request,
        { token: EVAL_TOKEN, clientId: "eval" },
        tools,
      );
      const responseHeaders = { connection: "close" };
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      res.writeHead(response.status, responseHeaders);
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: error.message }));
    }
  });

  server.on("clientError", (_error, socket) => {
    socket.destroy();
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        url: `http://127.0.0.1:${port}/mcp`,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

async function startProductionHarness(board, env = process.env, { boardFile } = {}) {
  disableKeepAlive();
  const api = await startIsolatedApi(board, { boardFile: boardFile || env.EVAL_FIXTURE_BOARD });
  try {
    const mcp = await startProductionMcpServer(api.apiUrl, board);
    const hypertaskBin = resolveHypertaskBin(env);
    if (!hypertaskBin) {
      await mcp.close();
      throw new Error("native hypertask CLI is required for CLI surface measurements");
    }
    const ignoreReset = (error) => {
      if (error && error.code === "ECONNRESET") return;
      throw error;
    };
    process.on("uncaughtException", ignoreReset);
    return {
      board,
      apiUrl: api.apiUrl,
      mcpUrl: mcp.url,
      token: EVAL_TOKEN,
      hypertaskBin,
      env: {
        ...env,
        EVAL_API_URL: api.apiUrl,
        EVAL_MCP_URL: mcp.url,
        EVAL_TOKEN: EVAL_TOKEN,
        EVAL_FIXTURE_BOARD: boardFile || env.EVAL_FIXTURE_BOARD,
      },
      snapshot: api.snapshot,
      close: async () => {
        process.off("uncaughtException", ignoreReset);
        await mcp.close();
        await api.close();
      },
    };
  } catch (error) {
    await api.close();
    throw error;
  }
}

module.exports = {
  EVAL_TOKEN,
  resolveHypertaskBin,
  loadProductionMcp,
  startProductionMcpServer,
  startProductionHarness,
};
