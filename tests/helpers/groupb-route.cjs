const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..", "..");

function loadSharedRoute(getSessionUser = async () => null) {
  const javascript = ts.transpileModule(
    fs.readFileSync(path.join(root, "src/lib/api/task-writes/route.ts"), "utf8"),
    { compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText;
  const stubs = { "@/lib/auth/session": require("./agent-board-scope.cjs").load("src/lib/auth/session.ts", {}), "@/lib/auth/getSessionUser": { getSessionUser }, "@/lib/auth/agentScope": require("./agent-board-scope.cjs").enforcedScope };
  const mod = { exports: {} };
  new Function("module", "exports", "require", javascript)(
    mod,
    mod.exports,
    (request) => stubs[request] ?? require(request),
  );
  return mod.exports;
}

function pagesHandler(routes, getSessionUser) {
  const { taskWriteHandler } = loadSharedRoute(getSessionUser);
  return taskWriteHandler(
    Object.fromEntries(Object.entries(routes).map(([method, route]) => [method, async () => route])),
  );
}

module.exports = { loadSharedRoute, pagesHandler };
