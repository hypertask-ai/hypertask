const { withStubs } = require("./helpers/stub-map.cjs");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");

function load(file, mocks = {}) {
  const cache = new Map();
  function requireSource(specifier, directory) {
    if (specifier in mocks) {
      const mock = mocks[specifier];
      return Object.hasOwn(mock, "default") ? { __esModule: true, ...mock } : mock;
    }
    if (specifier === "@/lib/mcp/skills/context") return require("./helpers/mcp-skill-context.cjs");
    if (specifier === "@/lib/planLimits") return { isPlanLimitReachedError: () => false, isPlanLimitsEnabled: async () => false, assertBoardRoom: async () => {}, assertTaskCountTransition: async () => {}, assertProjectTicketRoom: async () => {}, assertTicketRoom: async () => {} };
    if (specifier === "@/lib/storage/verifyTaskAttachmentLinks") return { verifyTaskAttachmentLinks: async () => new Map() };
    if (!specifier.startsWith("@/") && !specifier.startsWith(".") && !path.isAbsolute(specifier)) return require(specifier);
    const base = specifier.startsWith("@/")
      ? path.join(root, "src", specifier.slice(2))
      : path.resolve(directory, specifier);
    const filename = [base, `${base}.ts`, `${base}.cjs`].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
    if (/src[\\/]lib[\\/]flags[\\/](?:keys|definitions|definitions[\\/]index\.generated)\.ts$/.test(filename ?? "")) {
      return require("./helpers/flag-files.cjs").load(filename);
    }
    if (!filename) throw new Error(`Missing module: ${specifier}`);
    if (cache.has(filename)) return cache.get(filename).exports;
    if (filename.endsWith(".json")) return JSON.parse(fs.readFileSync(filename, "utf8"));
    const loadedModule = { exports: {} };
    cache.set(filename, loadedModule);
    const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: filename.endsWith(".mjs") ? filename.replace(/\.mjs$/, ".ts") : filename,
    }).outputText;
    new Function("require", "module", "exports", compiled)(
      (next) => requireSource(next, path.dirname(filename)), loadedModule, loadedModule.exports,
    );
    return loadedModule.exports;
  }
  return requireSource(path.join(root, file), root);
}


module.exports = { load, withStubs };
