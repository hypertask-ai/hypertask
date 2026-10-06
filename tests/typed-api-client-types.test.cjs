const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const root = path.resolve(__dirname, "..");
const fixture = path.join(root, "tests/fixtures/typed-api-client-contract.ts");

test("semantic compiler proves response types, producer parity and invalid callers", () => {
  const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  assert.deepEqual(parsed.errors, []);
  const options = { ...parsed.options, noEmit: true, incremental: false };
  const program = ts.createProgram([fixture], options);
  const files = [fixture, path.join(root, "src/lib/api/typedClient.ts"), path.join(root, "src/lib/api/contracts/settingsReads.ts")];
  const diagnostics = [...program.getOptionsDiagnostics(), ...program.getGlobalDiagnostics(), ...files.flatMap((file) => {
    const source = program.getSourceFile(file);
    assert.ok(source, file);
    return [...program.getSyntacticDiagnostics(source), ...program.getSemanticDiagnostics(source)];
  })];
  const format = (items) => ts.formatDiagnosticsWithColorAndContext(items, { getCurrentDirectory: () => root, getCanonicalFileName: (name) => name, getNewLine: () => "\n" });
  assert.equal(diagnostics.length, 0, format(diagnostics));

  const host = ts.createCompilerHost(options);
  const readFile = host.readFile.bind(host);
  host.readFile = (file) => {
    const source = readFile(file);
    if (file === path.join(root, "src/lib/api/contracts/settingsReads.ts")) return source.replaceAll("enabled: z.boolean()", "enabled: z.string()");
    return file === fixture ? `${source}\nconst semanticNegativeControl: boolean = 123;\nvoid semanticNegativeControl;\n` : source;
  };
  const negative = ts.createProgram([fixture], options, host);
  const negativeDiagnostics = negative.getSemanticDiagnostics(negative.getSourceFile(fixture));
  assert.ok(negativeDiagnostics.some(({ code }) => code === 2322), "semantic checker must catch an actual incompatible assignment");
  assert.ok(negativeDiagnostics.some(({ code }) => code === 2344), "producer parity must reject intentional response contract drift");
});
