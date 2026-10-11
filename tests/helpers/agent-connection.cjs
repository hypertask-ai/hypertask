const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "../..");

function load(file, mocks = {}) {
  if (/src\/lib\/flags\/(?:keys|definitions)\.ts$/.test(file)) return require("./flag-files.cjs").load(file);
  const filename = path.join(root, file);
  const compiled = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = (id) => Object.hasOwn(mocks, id) ? mocks[id] : require(require.resolve(id, { paths: loaded.paths }));
  loaded._compile(compiled, filename);
  return loaded.exports;
}

module.exports = { load, root };
