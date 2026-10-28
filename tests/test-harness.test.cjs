const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { ESLint, Linter } = require("eslint");
const parser = require("@typescript-eslint/parser");
const { loadModule, stubModule, findElement, root } = require("./helpers/loadModule.cjs");
const config = import("../eslint-local-rules/test-harness.mjs");

async function lint(code, file = "tests/new-harness.cjs") {
  const { testHarnessLintConfig } = await config;
  return new Linter({ cwd: root }).verify(code, [{ ...testHarnessLintConfig, languageOptions: { parser } }], { filename: path.join(root, file) });
}

test("loader isolates transitive, default and falsy stubs, circular exports and module state", t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "test-harness-"));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.writeFileSync(path.join(folder, "a.ts"), 'exports.name = "A"; exports.peer = require("./b").name;');
  fs.writeFileSync(path.join(folder, "b.ts"), 'exports.name = require("./a").name + "B";');
  fs.writeFileSync(path.join(folder, "child.ts"), 'import value from "fixture"; export const result = value;');
  fs.writeFileSync(path.join(folder, "index.ts"), 'export { result } from "./child"; export const empty = require("empty"); export let count = 0; export const next = () => ++count;');
  fs.writeFileSync(path.join(folder, "meta.json"), '{"count":0}');
  fs.writeFileSync(path.join(folder, "json.ts"), 'const first = require("./meta.json"); first.count++; exports.second = require("./meta.json"); exports.same = first === exports.second;');
  const json = loadModule(path.join(folder, "json.ts"));
  assert.equal(json.same, true);
  assert.deepEqual(json.second, { count: 1 });
  assert.deepEqual(loadModule(path.join(folder, "json.ts")).second, { count: 1 });
  const file = path.join(folder, "index.ts");
  const first = loadModule(file, { fixture: { default: "first" }, empty: false });
  const second = loadModule(file, { fixture: { default: "second" }, empty: null });
  assert.equal(first.result, "first");
  assert.equal(second.result, "second");
  assert.equal(first.empty, false);
  assert.equal(second.empty, null);
  assert.equal(first.next(), 1);
  assert.equal(first.next(), 2);
  assert.equal(second.next(), 1);
  assert.deepEqual(loadModule(path.join(folder, "a.ts")), { name: "A", peer: "AB" });
  const { toErrorMessage } = loadModule("src/lib/api/errorMessage.ts");
  assert.equal(toErrorMessage({ message: "real module" }, "fallback"), "real module");
});

test("cached stubs restore the original even after repeated replacement", () => {
  const callbacks = [];
  const context = { after: fn => callbacks.push(fn) };
  const original = require("./helpers/stub-map.cjs");
  try {
    stubModule(context, "./tests/helpers/stub-map.cjs", { marker: "first" });
    assert.deepEqual(require("./helpers/stub-map.cjs"), { marker: "first" });
    stubModule(context, "./tests/helpers/stub-map.cjs", { marker: "second" });
    assert.deepEqual(require("./helpers/stub-map.cjs"), { marker: "second" });
    assert.equal(callbacks.length, 1);
  } finally { callbacks.forEach(fn => fn()); }
  assert.equal(require("./helpers/stub-map.cjs"), original);
});

test("element search finds nested arrays and preserves missing results", () => {
  const target = { type: "button", props: { children: "go" } };
  const tree = { type: "div", props: { children: [null, false, ["label", target]] } };
  assert.equal(findElement(tree, "button"), target);
  assert.equal(findElement(tree, "div"), tree);
  assert.equal(findElement(tree, "input"), undefined);
});

test("lint refuses new loaders, aliases, cache writes and element helpers", async () => {
  for (const code of [
    'const Module = require("node:module"); Module._load = () => {};',
    'const ts = require("typescript"); ts.transpileModule("", {});',
    'const { transpileModule: compile } = require("typescript"); compile("", {});',
    'import { transpileModule as compile } from "typescript"; compile("", {});',
    'require.cache["fixture"] = {};',
    'delete require.cache["fixture"];',
    'function findElement(tree, type) { return tree; }',
    'const findElement = tree => tree;',
  ]) {
    const messages = await lint(code, code.startsWith("import ") ? "tests/new-harness.mjs" : "tests/new-harness.cjs");
    assert.equal(messages.length, 1, code);
    assert.equal(messages[0].ruleId, "hypertask-tests/no-new-harness");
    assert.match(messages[0].message, /tests\/helpers\/loadModule.cjs/);
  }
  assert.deepEqual(await lint('const { loadModule } = require("./helpers/loadModule.cjs"); loadModule("fixture.ts");'), []);
  assert.deepEqual(await lint('const cached = require.cache["fixture"];'), []);
});

test("legacy budget permits existing debt but not an additional loader", async () => {
  const file = "tests/agent-sidebar-chats-regressions-7518.test.cjs";
  const source = fs.readFileSync(path.join(root, file), "utf8");
  assert.deepEqual(await lint(source, file), []);
  const messages = await lint(`${source}\nconst compileNew = ts.transpileModule("", {});`, file);
  assert.equal(messages.length, 1);
  const settings = await new ESLint({ cwd: root }).calculateConfigForFile(file);
  assert.equal(settings.rules["hypertask-tests/no-new-harness"][0], 2);
});

test("rejects the duplicated component harness from PR 1993", async () => {
  const source = fs.readFileSync(path.join(__dirname, "fixtures/test-harness/pr-1993.cjs.txt"), "utf8");
  const messages = await lint(source);
  assert.equal(messages.length, 2);
  assert.ok(messages.every(message => message.ruleId === "hypertask-tests/no-new-harness"));
});
