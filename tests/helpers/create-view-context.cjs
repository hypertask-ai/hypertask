const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");

function load(file, mocks) {
  const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", compiled)(
    specifier => Object.hasOwn(mocks, specifier) ? { __esModule: true, ...mocks[specifier] } : require(specifier),
    loaded, loaded.exports,
  );
  return loaded.exports;
}

module.exports = { load };
