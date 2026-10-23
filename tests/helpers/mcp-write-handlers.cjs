const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..", "..");
const METHODS = ["POST", "PUT", "PATCH", "DELETE"];
const GUARD_CALL = /\b(requireRole|requireAgentWriteRole)\(/;
const WRITE_GUARD_CALL = /\brequireAgentWriteRole\(/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(relative, out);
    else out.push(relative);
  }
  return out;
}

function handlerFiles() {
  return [
    ...walk("src/app/api/mcp").filter((file) => /\/route\.ts$/.test(file)),
    ...walk("src/lib/mcp/operations").filter((file) => /\.ts$/.test(file) && !/\.test\./.test(file)),
    "src/app/mcp/route.ts",
    "src/app/sse/route.ts",
    "src/app/message/route.ts",
  ].filter((file) => fs.existsSync(path.join(root, file)));
}

function parse(file) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  return { text, source: ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true) };
}

function isExported(node) {
  return (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
}

function calledNames(node) {
  const names = new Set();
  const visit = (child) => {
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) names.add(child.expression.text);
    ts.forEachChild(child, visit);
  };
  visit(node);
  return names;
}

function localFunctions(source) {
  const functions = new Map();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) functions.set(statement.name.text, statement);
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) functions.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  return functions;
}

function reachableText(node, functions, seen = new Set()) {
  let text = node.getText();
  for (const name of calledNames(node)) {
    const next = functions.get(name);
    if (!next || seen.has(name)) continue;
    seen.add(name);
    text += `\n${reachableText(next, functions, seen)}`;
  }
  return text;
}

function importedModuleOf(source, identifier) {
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause?.namedBindings) continue;
    const bindings = statement.importClause.namedBindings;
    if (!ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (element.name.text === identifier) return statement.moduleSpecifier.text;
    }
  }
  return null;
}

function writeHandlers() {
  const handlers = [];
  for (const file of handlerFiles()) {
    const { source } = parse(file);
    const functions = localFunctions(source);
    for (const statement of source.statements) {
      if (ts.isFunctionDeclaration(statement) && statement.name && isExported(statement) && METHODS.includes(statement.name.text)) {
        handlers.push({ file, method: statement.name.text, text: reachableText(statement, functions), alias: null });
      }
      if (ts.isVariableStatement(statement) && isExported(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || !METHODS.includes(declaration.name.text) || !declaration.initializer) continue;
          const initializer = declaration.initializer;
          const alias = ts.isIdentifier(initializer) ? importedModuleOf(source, initializer.text) : null;
          handlers.push({
            file,
            method: declaration.name.text,
            text: reachableText(initializer, functions),
            alias: alias && /operations\//.test(alias) ? alias : null,
          });
        }
      }
    }
  }
  return handlers.filter((handler) => !handler.alias).map(({ alias, ...handler }) => ({ ...handler, key: `${handler.method} ${handler.file}` }));
}

function exists(file) {
  return fs.existsSync(path.join(root, file));
}

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

module.exports = { writeHandlers, GUARD_CALL, WRITE_GUARD_CALL, exists, read, root };
