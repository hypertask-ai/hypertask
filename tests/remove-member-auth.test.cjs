const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function transpile(file, stubs) {
  stubs = { "@/lib/auth/agentScope": require("./helpers/agent-board-scope.cjs").enforcedScope, ...stubs };
  const filename = path.join(root, file);
  const javascript = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  }).outputText;
  const loadedModule = { exports: {} };
  new Function("module", "exports", "require", "__filename", "__dirname", javascript)(
    loadedModule,
    loadedModule.exports,
    (request) => stubs[request] ?? require(request),
    filename,
    path.dirname(filename),
  );
  return loadedModule.exports;
}

// Loads the shared handler that the Pages adapter delegates to, behind the real
// taskWriteRoute wrapper. Returns a Pages-style (req, res) handler around it.
function loadRoute(verifySession) {
  const controllerCalls = [];
  const nextServer = { NextResponse: Response };
  const taskWrites = transpile("src/lib/api/task-writes/route.ts", {
    "next/server": nextServer,
    "@/lib/auth/getSessionUser": { getSessionUser: async () => null },
  });
  const shared = transpile("src/lib/api/project-writes/remove-member.ts", {
    "next/server": nextServer,
    "@/lib/api/task-writes/route": taskWrites,
    "@/lib/auth/session": {
      SESSION_COOKIE: "ht_session",
      verifySession,
    },
    "@/utils/controllers/projects/removeMember": {
      __esModule: true,
      default: async (...args) => {
        controllerCalls.push(args);
        return { status: 200, json: ["Success"] };
      },
    },
  });
  const handler = async (req, res) => {
    const result = await shared.POST({
      headers: new Headers(),
      cookies: req.cookies,
      json: async () => req.body,
    });
    return res.status(result.status).json(await result.json());
  };

  return { handler, controllerCalls };
}

function responseRecorder() {
  const result = { status: null, body: null };
  const response = {
    status(status) {
      result.status = status;
      return response;
    },
    json(body) {
      result.body = body;
      return response;
    },
  };
  return { response, result };
}

test("member removal rejects an unsigned legacy identity without deleting anything", async () => {
  const { handler, controllerCalls } = loadRoute(() => null);
  const { response, result } = responseRecorder();

  await handler(
    {
      method: "POST",
      body: { userId: 42, projectId: 15 },
      cookies: { nookies_user: JSON.stringify({ id: 6 }) },
    },
    response,
  );

  assert.equal(result.status, 401);
  assert.deepEqual(result.body, {
    error: "Unauthorized",
    code: "SESSION_REQUIRED",
  });
  assert.deepEqual(controllerCalls, []);
});

test("member removal authorizes with the signed session identity", async () => {
  const { handler, controllerCalls } = loadRoute((token) =>
    token === "signed" ? { id: 23 } : null,
  );
  const { response, result } = responseRecorder();

  await handler(
    {
      method: "POST",
      body: { userId: 42, projectId: 15 },
      cookies: {
        ht_session: "signed",
        nookies_user: JSON.stringify({ id: 999 }),
      },
    },
    response,
  );

  assert.equal(result.status, 200);
  assert.deepEqual(controllerCalls, [[42, 15, 23]]);
});
