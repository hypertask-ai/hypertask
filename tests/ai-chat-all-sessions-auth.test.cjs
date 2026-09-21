const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const { passThroughAuth } = require("./helpers/pass-through-auth.cjs");

const root = path.resolve(__dirname, "..");
const filename = path.join(root, "src/app/api/ai-chat/all-sessions/route.ts");
const javascript = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: filename,
}).outputText;

function loadRoute(session) {
  const calls = [];
  const loadedModule = { exports: {} };
  const stubs = {
    "#logger": { logger: { error() {}, warn() {} } },
    "#with-auth": passThroughAuth(async () => session),
    "@/utils/controllers/chat": {
      chatStore: () => ({
        sessions: {
          findMany: async (args) => {
            calls.push(args);
            return [{ id: "session-1" }];
          },
        },
      }),
    },
  };

  new Function("module", "exports", "require", javascript)(
    loadedModule,
    loadedModule.exports,
    (request) => stubs[request] ?? require(request),
  );
  return { GET: loadedModule.exports.GET, calls };
}

test("AI chat session listing uses the verified session identity", async () => {
  const { GET, calls } = loadRoute({ userId: 42, source: "legacy" });
  const response = await GET(new Request("https://example.test/api/ai-chat/all-sessions"));

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].where.userId, 42);
});

test("AI chat session listing rejects a missing verified identity", async () => {
  const { GET, calls } = loadRoute(null);
  const response = await GET(new Request("https://example.test/api/ai-chat/all-sessions"));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Unauthorized" });
  assert.deepEqual(calls, []);
});
