const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function loadRoute(verifySession) {
  const filename = path.join(root, "src/pages/api/projects/removeMember.ts");
  const javascript = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: filename,
  }).outputText;
  const controllerCalls = [];
  const loadedModule = { exports: {} };
  const stubs = {
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
  };

  new Function("module", "exports", "require", "__filename", "__dirname", javascript)(
    loadedModule,
    loadedModule.exports,
    (request) => stubs[request] ?? require(request),
    filename,
    path.dirname(filename),
  );

  return { handler: loadedModule.exports.default, controllerCalls };
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
