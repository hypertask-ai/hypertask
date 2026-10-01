const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

// TypeScript 7 compiles the app; API consumers still require the TypeScript 6 API.
test("the default tsc binary uses the native TypeScript 7 compiler", () => {
  const compiler = path.resolve("node_modules/.bin/tsc");
  assert.match(execFileSync(compiler, ["--version"], { encoding: "utf8" }), /^Version 7\./);
  const directory = mkdtempSync(path.join(os.tmpdir(), "ht-typescript-"));
  try {
    const input = path.join(directory, "fixture.ts");
    writeFileSync(input, "const answer: number = 42; console.log(answer);\n");
    execFileSync(compiler, ["--ignoreConfig", "--skipLibCheck", "--types", "node", "--outDir", directory, input]);
    assert.match(readFileSync(path.join(directory, "fixture.js"), "utf8"), /console\.log/);
    assert.equal(execFileSync(process.execPath, [path.join(directory, "fixture.js")], { encoding: "utf8" }).trim(), "42");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the SDK shares the native compiler without nested workspace installs", () => {
  const sdkDirectory = path.resolve("packages/agent-sdk");
  const sdk = JSON.parse(readFileSync(path.join(sdkDirectory, "package.json"), "utf8"));
  assert.equal(sdk.scripts.build, "tsc -p tsconfig.json");
  assert.equal(sdk.devDependencies["@typescript/native"], "npm:typescript@^7.0.2");
  assert.equal(require.resolve("@typescript/native/package.json", { paths: [sdkDirectory] }), require.resolve("@typescript/native/package.json"));
  assert.equal(existsSync(path.join(sdkDirectory, "node_modules")), false);
  assert.equal(require.resolve("typescript", { paths: [sdkDirectory] }), require.resolve("typescript"));
});

test("TypeScript API consumers and ESLint retain a working compiler API", () => {
  const typescript = require("typescript");
  const parser = require("@typescript-eslint/parser");
  const source = "const answer: number = 42;";
  const output = typescript.transpileModule(source, {
    compilerOptions: { module: typescript.ModuleKind.CommonJS },
    reportDiagnostics: true,
  });
  assert.equal(output.diagnostics.length, 0);
  assert.match(output.outputText, /answer = 42/);
  const ast = parser.parse(source, { filePath: "fixture.ts" });
  assert.equal(ast.body[0].type, "VariableDeclaration");
});
