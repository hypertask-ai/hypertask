const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const webpack = require("webpack");
const { JSDOM } = require("jsdom");
const nextConfig = require("../next.config.js");

const patchedPath = path.resolve(__dirname, "../src/lib/vendor/vfile-message.mjs");
const upstreamPath = path.join(path.dirname(require.resolve("vfile-message")), "lib/index.js");
const stringifyPosition = require("unist-util-stringify-position");

const lockdown = {
  normal: "",
  stack: "Object.defineProperty(Error.prototype, 'stack', { value: '', writable: false, configurable: false });",
  frozen: "Object.defineProperty(Error.prototype, 'stack', { value: '', writable: false, configurable: false }); Object.freeze(Error.prototype);",
};

function loadMessage(filename, mode) {
  const context = vm.createContext({
    exports: {},
    require: (name) => {
      assert.equal(name, "unist-util-stringify-position");
      return stringifyPosition;
    },
  });
  vm.runInContext(lockdown[mode], context);
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: "message.js",
  });
  vm.runInContext(outputText, context, { filename });
  return context;
}

function snapshot(context) {
  return JSON.parse(vm.runInContext(`JSON.stringify((() => {
    const Message = exports.VFileMessage;
    const place = { start: { line: 2, column: 3 }, end: { line: 4, column: 5 } };
    const cause = new Error('original');
    cause.stack = 'original stack';
    const ancestor = { type: 'paragraph', position: place };
    const messages = [
      new Message('plain'),
      new Message('located', { place, source: 'lint', ruleId: 'rule', cause, ancestors: [ancestor] }),
      new Message('point', { line: 7, column: 8 }, 'source:rule'),
      new Message('node', ancestor, 'rule'),
      new Message(cause, place, 'legacy:rule'),
      new Message('origin', 'source:rule'),
    ];
    return {
      messages: messages.map(message => ({ ...message, cause: message.cause?.message,
        text: String(message), isError: message instanceof Error, isMessage: message instanceof Message })),
      defaults: Object.getOwnPropertyNames(Message.prototype).filter(key => key !== 'constructor')
        .map(key => [key, Object.getOwnPropertyDescriptor(Message.prototype, key)]),
    };
  })())`, context));
}

test("upstream is a positive control for the locked and frozen Error crash", () => {
  assert.throws(() => loadMessage(upstreamPath, "stack"), /read only property 'stack'/);
  assert.throws(() => loadMessage(upstreamPath, "frozen"), /read only property 'name'/);
});

const normalSnapshot = snapshot(loadMessage(upstreamPath, "normal"));
for (const mode of Object.keys(lockdown)) {
  test(`patched messages preserve upstream behavior with ${mode} Error.prototype`, () => {
    assert.deepEqual(snapshot(loadMessage(patchedPath, mode)), normalSnapshot);
  });
}

test("the vendored constructor stays upstream-identical", () => {
  const constructor = (filename) => fs.readFileSync(filename, "utf8")
    .split("export class VFileMessage")[1].split("\n}\n")[0];
  assert.equal(constructor(patchedPath), constructor(upstreamPath));
});

for (const options of [
  { dev: false, isServer: false },
  { dev: true, isServer: false },
  { dev: false, isServer: true, nextRuntime: "nodejs" },
  { dev: false, isServer: true, nextRuntime: "edge" },
]) {
  test(`Next webpack aliases vfile-message for ${JSON.stringify(options)}`, () => {
    const config = nextConfig.webpack({ resolve: { alias: { existing: "kept" } } }, options);
    assert.equal(config.resolve.alias["vfile-message$"], patchedPath);
    assert.equal(config.resolve.alias.existing, "kept");
  });
}

test("the real webpack markdown bundle renders under normal and locked Error intrinsics", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "htpr-6876-"));
  const dom = new JSDOM("");
  try {
    fs.writeFileSync(path.join(dir, "entry.mjs"), `
      export { default as Markdown } from ${JSON.stringify(require.resolve("react-markdown"))};
      export { VFileMessage as AliasedMessage } from "vfile-message";
    `);
    const config = nextConfig.webpack({ resolve: { alias: {} } }, { dev: false, isServer: false });
    const compiler = webpack({
      mode: "production",
      target: "web",
      entry: path.join(dir, "entry.mjs"),
      resolve: { ...config.resolve, modules: [path.resolve(__dirname, "../node_modules")] },
      output: { path: dir, filename: "bundle.cjs", library: { type: "commonjs2" } },
      optimization: { minimize: false },
    });
    try {
      await new Promise((resolve, reject) => compiler.run((error, stats) => {
        if (error) return reject(error);
        if (stats.hasErrors()) return reject(new Error(stats.toString({ all: false, errors: true })));
        resolve();
      }));
    } finally {
      await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
    }
    const bundle = fs.readFileSync(path.join(dir, "bundle.cjs"), "utf8");
    let baseline;
    for (const mode of Object.keys(lockdown)) {
      const context = vm.createContext({ module: { exports: {} }, document: dom.window.document });
      vm.runInContext(lockdown[mode], context);
      vm.runInContext(bundle, context);
      const rendered = JSON.parse(vm.runInContext(`JSON.stringify(module.exports.Markdown({
        children: '# Heading\\n\\n**bold** and [link](https://example.com)\\n\\n- first\\n- second'
      }))`, context));
      assert.match(JSON.stringify(rendered), /"type":"h1"/);
      assert.match(JSON.stringify(rendered), /"type":"strong"/);
      assert.match(JSON.stringify(rendered), /https:\/\/example.com/);
      if (mode === "normal") baseline = rendered;
      else assert.deepEqual(rendered, baseline);
      assert.equal(vm.runInContext("new module.exports.AliasedMessage('works').reason", context), "works");
    }
  } finally {
    dom.window.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
