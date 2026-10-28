const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const ts = require("typescript");
const root = path.resolve(__dirname, "../..");
const requireRoot = createRequire(path.join(root, "package.json"));

function loadModule(file, stubs = {}) {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    if (filename.endsWith(".json")) return JSON.parse(fs.readFileSync(filename, "utf8"));
    const mod = { exports: {} };
    cache.set(filename, mod);
    const localRequire = createRequire(filename);
    const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    new Function("require", "module", "exports", "__filename", "__dirname", source)(
      (specifier) => {
        if (specifier in stubs) {
          const stub = stubs[specifier];
          return stub && Object.hasOwn(stub, "default") ? { __esModule: true, ...stub } : stub;
        }
        if (!specifier.startsWith("@/") && !specifier.startsWith(".") && !path.isAbsolute(specifier)) return localRequire(specifier);
        const base = specifier.startsWith("@/") ? path.join(root, "src", specifier.slice(2)) : path.resolve(path.dirname(filename), specifier);
        const target = [base, ...[".ts", ".tsx", ".js", ".cjs", ".json", "/index.ts", "/index.tsx", "/index.js"].map(ext => base + ext)]
          .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
        if (!target) throw new Error(`Missing module: ${specifier} from ${filename}`);
        if (/src[\\/]lib[\\/]flags[\\/](?:keys|definitions|definitions[\\/]index\.generated)\.ts$/.test(target)) return require("./flag-files.cjs").load(target);
        return load(target);
      }, mod, mod.exports, filename, path.dirname(filename),
    );
    return mod.exports;
  }
  return load(path.resolve(root, file));
}

const stubContexts = new WeakMap();
function stubModule(context, specifier, exports) {
  const filename = requireRoot.resolve(specifier.startsWith("src/") ? path.join(root, specifier) : specifier);
  if (!stubContexts.has(context)) {
    const previous = new Map();
    stubContexts.set(context, previous);
    context.after(() => {
      for (const [id, cached] of previous) {
        if (cached) require.cache[id] = cached;
        else delete require.cache[id];
      }
      stubContexts.delete(context);
    });
  }
  const previous = stubContexts.get(context);
  if (!previous.has(filename)) previous.set(filename, require.cache[filename]);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function findElement(element, type) {
  if (Array.isArray(element)) {
    for (const child of element) {
      const found = findElement(child, type);
      if (found) return found;
    }
  } else if (element && typeof element === "object") {
    if (element.type === type) return element;
    return findElement(element.props?.children, type);
  }
}

module.exports = { loadModule, stubModule, findElement, root };
