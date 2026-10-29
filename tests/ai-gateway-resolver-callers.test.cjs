const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const srcRoot = path.join(root, "src");

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.[cm]?[jt]sx?$/.test(entry.name) ? [absolute] : [];
  });
}

function resolverCalls() {
  const calls = [];
  for (const absolute of sourceFiles(srcRoot)) {
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    const sourceText = fs.readFileSync(absolute, "utf8");
    const source = ts.createSourceFile(
      relative,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      absolute.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        [
          "resolveAiModel",
          "resolveGatewayModel",
          "resolveGatewayImageModel",
        ].includes(node.expression.text)
      ) {
        calls.push({
          file: relative,
          name: node.expression.text,
          args: node.arguments.map((argument) => argument.getText(source)),
        });
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  return calls;
}

test("every product model resolver caller passes an explicit credential", () => {
  const calls = resolverCalls();
  assert.ok(calls.length > 0);

  for (const call of calls) {
    const credentialIndex = call.name === "resolveAiModel" ? 2 : 1;
    assert.ok(
      call.args.length > credentialIndex,
      `${call.file}: ${call.name} must receive an explicit credential`,
    );
    assert.doesNotMatch(
      call.args[credentialIndex],
      /^(?:undefined|null)$/,
      `${call.file}: ${call.name} cannot opt into platform-key fallback`,
    );
  }

  assert.ok(calls.some(({ name }) => name === "resolveAiModel"));
  assert.ok(calls.some(({ name }) => name === "resolveGatewayModel"));
  assert.ok(calls.some(({ name }) => name === "resolveGatewayImageModel"));
});
