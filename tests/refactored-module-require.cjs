const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function createRefactoredModuleRequire(directory, mocks) {
  const cache = new Map();
  function load(specifier, parentDirectory) {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    if (!specifier.startsWith(".")) return require(specifier);
    const base = path.resolve(parentDirectory, specifier);
    const file = [base, `${base}.ts`, `${base}.tsx`].find((candidate) =>
      fs.existsSync(candidate) && fs.statSync(candidate).isFile()
    );
    if (!file) throw new Error(`Cannot resolve ${specifier} from ${parentDirectory}`);
    if (cache.has(file)) return cache.get(file).exports;
    const loadedModule = { exports: {} };
    cache.set(file, loadedModule);
    const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: file,
    }).outputText;
    new Function("require", "module", "exports", compiled)(
      (next) => load(next, path.dirname(file)), loadedModule, loadedModule.exports,
    );
    return loadedModule.exports;
  }
  return (specifier) => load(specifier, directory);
}

module.exports = { createRefactoredModuleRequire };
