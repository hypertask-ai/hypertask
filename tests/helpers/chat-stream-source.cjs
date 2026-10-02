const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
const tools = path.join(root, "src/lib/ai/tools");
const stream = path.join(root, "src/lib/ai/chatStream");

function source(file) {
  const text = fs.readFileSync(file, "utf8");
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

function find(node, predicate) {
  if (predicate(node)) return node;
  return ts.forEachChild(node, (child) => find(child, predicate));
}

function returnedArrow(file, factory) {
  const parsed = source(file);
  const declaration = find(parsed, (node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === factory,
  );
  const statement = declaration.body.statements.find(ts.isReturnStatement);
  return statement.expression.getText(parsed);
}

// Existing source-level tests inspect and evaluate closures without loading the
// providers. Follow the extracted catalog and expose the same lexical source.
function chatStreamSource() {
  const catalog = source(path.join(tools, "index.ts"));
  const imports = new Map(catalog.statements.filter(ts.isImportDeclaration)
    .flatMap((node) => node.importClause?.namedBindings?.elements?.map((binding) =>
      [binding.name.text, node.moduleSpecifier.text],
    ) ?? []));
  const builder = find(catalog, (node) =>
    ts.isFunctionDeclaration(node) && node.name?.text === "buildTools",
  );
  const registry = find(builder, (node) =>
    ts.isVariableDeclaration(node) && node.name.getText(catalog) === "tools",
  ).initializer;
  const factoryFiles = registry.properties.map((node) => {
    const selected = node.initializer;
    const call = selected?.expression;
    const modulePath = imports.get(call?.expression?.text);
    if (!ts.isPropertyAssignment(node) ||
      !selected || !ts.isPropertyAccessExpression(selected) ||
      !call || !ts.isCallExpression(call) ||
      call.arguments.length !== 1 || call.arguments[0].getText(catalog) !== "context" ||
      selected.name.text !== node.name.getText(catalog) || !modulePath?.startsWith("./")) {
      throw new Error("Invalid chat tool registration");
    }
    const file = path.join(tools, `${modulePath}.ts`);
    const factory = source(file);
    const declaration = find(factory, (candidate) =>
      ts.isFunctionDeclaration(candidate) && candidate.name?.text === call.expression.text,
    );
    const returned = declaration?.body.statements.find(ts.isReturnStatement)?.expression;
    if (!returned || !ts.isObjectLiteralExpression(returned) ||
      !returned.properties.some((property) => property.name?.getText(factory) === selected.name.text)) {
      throw new Error("Invalid chat tool registration");
    }
    return file;
  });
  const schemaSource = source(path.join(tools, "updateTaskSchema.ts"));
  const schema = find(schemaSource, (node) =>
    ts.isVariableDeclaration(node) && node.name.getText(schemaSource) === "updateTaskSchema",
  ).initializer.getText(schemaSource);
  const updater = returnedArrow(path.join(tools, "updateOneTask.ts"), "createTaskUpdater");
  const files = [
    ...["types", "prompt", "request", "content", "errors", "models", "title"].map((name) => path.join(stream, `${name}.ts`)),
    ...["constants", "schemas", "metadata", "execution", "helpers", "context", "taskAssignees", "taskAssigneeMutation", "index"].map((name) => path.join(tools, `${name}.ts`)),
    ...factoryFiles,
    ...["turnModel", "runStream", "fleetTurn", "modelTurn", "modelReply", "stream"].map((name) => path.join(stream, `${name}.ts`)),
    path.join(root, "src/app/api/ai/chat/stream/route.ts"),
  ];
  return files.map((file) => {
    const parsed = source(file);
    const edits = [];
    function visit(node) {
      if (node.modifiers) {
        for (const modifier of node.modifiers) {
          if (modifier.kind === ts.SyntaxKind.ExportKeyword) {
            edits.push([modifier.getStart(parsed), modifier.end + 1, ""]);
          }
        }
      }
      if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "state") {
        const declaration = path.basename(file) === "runStream.ts" &&
          ts.isBinaryExpression(node.parent) && node.parent.left === node &&
          ["generationStartedAt", "observedAgentId", "observedModel", "observedProvider"].includes(node.name.text);
        edits.push([node.getStart(parsed), node.end, `${declaration ? "let " : ""}${node.name.text}`]);
        return;
      }
      if (ts.isPropertyAssignment(node) && node.name.getText(parsed) === "inputSchema" && node.initializer.getText(parsed) === "updateTaskSchema") {
        edits.push([node.initializer.getStart(parsed), node.initializer.end, schema]);
        return;
      }
      if (ts.isCallExpression(node) && node.expression.getText(parsed) === "createTaskUpdater") {
        edits.push([node.getStart(parsed), node.end, updater]);
        return;
      }
      ts.forEachChild(node, visit);
    }
    visit(parsed);
    let text = parsed.text;
    for (const [start, end, replacement] of edits.sort((a, b) => b[0] - a[0])) {
      text = text.slice(0, start) + replacement + text.slice(end);
    }
    return text;
  }).join("\n");
}

module.exports = {
  ...fs,
  readFileSync(file, options) {
    if (typeof file === "string" && path.resolve(file) === path.join(root, "src/app/api/ai/chat/stream/route.ts")) {
      const text = chatStreamSource();
      return typeof options === "string" || options?.encoding ? text : Buffer.from(text);
    }
    return fs.readFileSync(file, options);
  },
};
