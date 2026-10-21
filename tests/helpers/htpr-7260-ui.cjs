const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { createRoot } = require("react-dom/client");
const { JSDOM } = require("jsdom");
const root = path.resolve(__dirname, "../..");

function loader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {};
    cache.set(file, exports);
    const source = fs.readFileSync(path.join(root, file), "utf8");
    const compiled = ts.transpileModule(source, { fileName: file, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    new Function("require", "exports", "React", compiled)((specifier) => {
      if (Object.hasOwn(mocks, specifier)) return { __esModule: true, ...mocks[specifier] };
      if (specifier.endsWith(".scss")) return {};
      if (!specifier.startsWith("@/") && !specifier.startsWith(".")) return require(specifier);
      const base = specifier.startsWith("@/") ? `src/${specifier.slice(2)}` :
        path.relative(root, path.resolve(root, path.dirname(file), specifier));
      const target = [base, `${base}.tsx`, `${base}.ts`, `${base}/index.tsx`, `${base}/index.ts`]
        .find(candidate => fs.existsSync(path.join(root, candidate)) && fs.statSync(path.join(root, candidate)).isFile());
      assert.ok(target, `Module not found: ${specifier}`);
      return load(target);
    }, exports, React);
    return exports;
  }
  return load;
}

function mount() {
  const dom = new JSDOM('<div id="root"></div>', { url: "https://app.hypertask.ai/project-15" });
  const values = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    navigator: dom.window.navigator, React, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(global, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(global, key, { value, configurable: true, writable: true });
  const container = document.getElementById("root");
  const reactRoot = createRoot(container);
  return {
    container,
    render: element => React.act(() => reactRoot.render(element)),
    close() {
      React.act(() => reactRoot.unmount());
      dom.window.close();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(global, key, descriptor);
        else delete global[key];
      }
    },
  };
}

module.exports = { loader, mount, React, root };
