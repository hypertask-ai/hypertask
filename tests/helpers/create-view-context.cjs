const { withStubs } = require("./stub-map.cjs");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");

function load(file, mocks) {
  mocks = withStubs({ "./taskWriterSkills": require("jiti")(__filename, { fsCache: false })(path.join(root, "src/lib/ai/taskWriterSkills.ts")), "@/lib/media/inlineAgentImages.server": { inlineAgentImagesForUser: async (html) => html }, "@/lib/media/inlineAgentImages": require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true })(path.join(root, "src/lib/media/inlineAgentImages.ts")), "@/lib/auth/agentScope": require("./agent-board-scope.cjs").enforcedScope }, mocks);
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    specifier => specifier in mocks ? { __esModule: true, ...mocks[specifier] } : require(specifier),
    loaded, loaded.exports,
  );
  return loaded.exports;
}

module.exports = { load };
