const assert = require("node:assert/strict");
const test = require("node:test");
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");
const codemodPromise = import("../scripts/strip-comments.mjs");
const root = resolve(__dirname, "..");

async function strip(source, filename = "src/Test.tsx") {
  const { stripComments, assertEquivalent } = await codemodPromise;
  const result = stripComments(source, filename);
  assertEquivalent(source, result.source, filename);
  assert.equal(stripComments(result.source, filename).source, result.source, "idempotence");
  return result;
}

test("strips actual comments without touching strings, templates, regexes, JSX text or tagged templates", async () => {
  const source = `// explanation\nconst url = "https://example.com/*data*/"; // trailing\nconst template = \`// data /* value */\`;\nconst pattern = /https?:\\/\\//;\nconst jsx = <div>https://example.com /* not a comment */{/* explanation */}</div>;\nconst tagged = tag\`\n\n\n\n\nraw // data\`;\n`;
  const result = await strip(source);
  assert.equal(result.removed, 3);
  assert.equal(result.source, source.replace("// explanation\n", "").replace(" // trailing", "").replace("{/* explanation */}", ""));
});

test("removes whole standalone lines, trailing whitespace, and brace-adjacent blank lines created by removal", async () => {
  const result = await strip("function run() {\n\n  /* explanation\n     more text */\n\n  return 1;   // trailing\n\n  // explanation\n\n}\n");
  assert.equal(result.source, "function run() {\n  return 1;\n}\n");
  assert.equal((await strip("const a = 1;\n\n\n// explanation\n\n\nconst b = 2;\n")).source, "const a = 1;\n\nconst b = 2;\n");
  assert.equal((await strip("const a = 1;\n\n\n\n\nconst b = 2;\n")).source, "const a = 1;\n\n\n\n\nconst b = 2;\n");
  assert.equal((await strip("function run() {\r\n\r\n  // explanation\r\n\r\n  return 1;\r\n}\r\n")).source, "function run() {\r\n  return 1;\r\n}\r\n");
  assert.equal((await strip("const value = 1;\n\n// explanation\n")).source, "const value = 1;\n");
  assert.equal((await strip("\n// explanation\n")).source, "");
  assert.equal((await strip("/* first */ /* second */\nconst value = 1;\n")).source, "const value = 1;\n");
});

test("separates adjacent tokens and preserves comment newlines that affect ASI", async () => {
  assert.equal((await strip("function run() { return/* explanation */value; }\n")).source, "function run() { return value; }\n");
  assert.equal((await strip("function run() { return /* explanation\n */ value; }\n")).source, "function run() { return \n value; }\n");
});

test("deletes JSX comment containers and their empty lines, but retains text-changing containers", async () => {
  assert.equal((await strip("const x = <div>\n  {/* explanation */}\n  <span />\n</div>;\n")).source, "const x = <div>\n  <span />\n</div>;\n");
  assert.equal((await strip("const x = <div>Hello{/* explanation */}world</div>;")).source, "const x = <div>Helloworld</div>;");
  const unsafe = "const x = <div>hello\n  {/* explanation */}\n  world</div>;";
  const kept = await strip(unsafe);
  assert.equal(kept.source, unsafe);
  assert.deepEqual(kept.keptJsx, ["src/Test.tsx:2"]);
  const { assertEquivalent } = await codemodPromise;
  assert.doesNotThrow(() => assertEquivalent(unsafe, unsafe.replace("{/* explanation */}", "{}"), "src/Test.tsx"));
  assert.equal((await strip("const x = <div>{/* @ts-expect-error reason */}</div>;")).removed, 0);
  const adjacent = await strip("const x = <div>hello{/* first */}{/* second */}\nworld</div>;");
  assert.equal(adjacent.removed, 1);
  assert.equal(adjacent.keptJsx.length, 1);
  assert.equal((await strip("const x = <div>{/* @ts-ignore stale */}<span /></div>;")).tsIgnoreRemoved, 1);
});

test("shares the rule allowlist, keeps tool-read JSDoc, and removes ts-ignore", async () => {
  const source = "/** @deprecated Use another function. */\n// @ts-expect-error upstream missing field\nconst a = value;\n// @ts-ignore\nconst b = value;\n/** @see explanatory */\nconst c = 1;\n";
  const result = await strip(source);
  assert.equal(result.tsIgnoreRemoved, 1);
  assert.equal(result.removed, 2);
  assert.ok(result.source.includes("@deprecated"));
  assert.ok(result.source.includes("@ts-expect-error"));
  assert.ok(!result.source.includes("@ts-ignore"));
  assert.equal((await strip("/** @param {string} x */\nconst x = 1;", "src/Test.js")).removed, 0);
  assert.equal((await strip("/** @param {string} x */\nconst x = 1;", "src/Test.ts")).removed, 1);
  for (const filename of ["src/Test.generated.ts", "src/Test.ts"]) {
    const generated = "/* @generated */\n// explanation\nconst value = 1;";
    assert.equal((await strip(generated, filename)).source, generated);
  }
});

test("normalized AST proof rejects changed code, literals, and JSX rendered whitespace", async () => {
  const { assertEquivalent } = await codemodPromise;
  for (const [before, after] of [
    ["const value = 1;", "const value = 2;"],
    ['const value = "// original";', 'const value = "// changed";'],
    ["const x = <div>hello\n{/* comment */}\nworld</div>;", "const x = <div>hello\n\nworld</div>;"],
  ]) assert.throws(() => assertEquivalent(before, after, "Test.tsx"), /AST mismatch/);
  assert.doesNotThrow(() => assertEquivalent("const x = <div>{/* comment */}<span />\n</div>;", "const x = <div><span />\n</div>;", "Test.tsx"));
});

test("CLI check mode fails on forbidden comments, write accepts paths and globs, second write is a no-op", () => {
  const fixture = mkdtempSync(join(tmpdir(), "yper4-379-comments-"));
  try {
    const filename = join(fixture, "Test.ts");
    writeFileSync(filename, "// explanation\nconst value = 1;\n");
    const run = (...args) => spawnSync(process.execPath, ["scripts/strip-comments.mjs", ...args], { cwd: root, encoding: "utf8" });
    const check = run("--check", filename);
    assert.equal(check.status, 1, check.stderr);
    assert.match(check.stdout, /Test.ts:1/);
    const write = run("--write", `${fixture}/*.ts`);
    assert.equal(write.status, 0, write.stderr);
    assert.equal(readFileSync(filename, "utf8"), "const value = 1;\n");
    const clean = run("--check", fixture);
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(clean.stdout, /0 files with disallowed comments/);
    const second = run("--write", filename);
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /Rewrote 0 files/);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
