const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = path.resolve(__dirname, "..", "..");

function transpile(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  return ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
}

// Loads the real (unstubbed) visibility + mcp/agents modules so cross-team
// scoping tests exercise production logic, not a re-implementation of it.
// Only `@/lib/prisma` is stubbed, since these two modules never call it.
function loadReal(relativePath) {
  const filePath = path.join(root, relativePath);
  const javascript = transpile(filePath);
  const loaded = new Module(filePath);
  loaded.filename = filePath;
  loaded.require = (request) => {
    if (request === "@/lib/prisma") return { __esModule: true, default: {} };
    if (request === "@/lib/agents/visibility") return loadReal("src/lib/agents/visibility.ts");
    return require(request);
  };
  loaded._compile(javascript, filePath);
  return loaded.exports;
}

module.exports = { ...loadReal("src/lib/mcp/agents.ts"), transpile };
