// HTPR-6992: loads the real src/lib/api/task-writes/route.ts (taskWriteRoute and
// taskWriteHandler) with a stubbed session lookup, so tests can run a shared
// task-write handler through the real Pages adapter.
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..", "..");

function loadSharedRoute(getSessionUser = async () => null) {
  const javascript = ts.transpileModule(
    fs.readFileSync(path.join(root, "src/lib/api/task-writes/route.ts"), "utf8"),
    { compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
  ).outputText;
  const stubs = { "@/lib/auth/getSessionUser": { getSessionUser }, "@/lib/auth/agentScope": require("./agent-board-scope.cjs").enforcedScope };
  const mod = { exports: {} };
  new Function("module", "exports", "require", javascript)(
    mod,
    mod.exports,
    (request) => stubs[request] ?? require(request),
  );
  return mod.exports;
}

// Pages-style (req, res) handler for shared routes, e.g. pagesHandler({ POST: shared.POST }).
function pagesHandler(routes, getSessionUser) {
  const { taskWriteHandler } = loadSharedRoute(getSessionUser);
  return taskWriteHandler(
    Object.fromEntries(Object.entries(routes).map(([method, route]) => [method, async () => route])),
  );
}

module.exports = { loadSharedRoute, pagesHandler };
