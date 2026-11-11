import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { asSchema } from "ai";
import { getEncoding } from "js-tiktoken";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modules = new Map();
const context = { inlineAgentImagesEnabled: false, chatTaskWriterEnabled: false, skillDraftsEnabled: false };

function resolveModule(filename, specifier) {
  const base = specifier.startsWith("@/") ? path.join(root, "src", specifier.slice(2)) : path.resolve(path.dirname(filename), specifier);
  return [base, base + ".ts", path.join(base, "index.ts")].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function schemaModule(filename) {
  if (modules.has(filename)) return modules.get(filename);
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true);
  const scope = { context, ...context };
  const imports = new Map();
  const evaluate = (node) => {
    const expression = node.getText(source).replace(/^export\s+(?:default\s+)?/, "");
    const code = ts.transpileModule(`const value = (${expression});`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    return vm.runInNewContext(code + "\nvalue", Object.defineProperties({}, Object.getOwnPropertyDescriptors(scope)), { timeout: 5000, filename });
  };
  const bind = (name, read) => {
    let loaded = false, value;
    Object.defineProperty(scope, name, { configurable: true, enumerable: true, get() {
      if (!loaded) { value = read(); loaded = true; }
      return value;
    } });
  };
  const declarations = (statements) => {
    for (const node of statements) {
      if (ts.isVariableStatement(node)) {
        for (const item of node.declarationList.declarations) {
          if (ts.isIdentifier(item.name) && item.initializer) bind(item.name.text, () => evaluate(item.initializer));
        }
      }
      if (ts.isFunctionDeclaration(node) && node.name) bind(node.name.text, () => evaluate(node));
    }
  };
  const api = { source, scope, imports, evaluate };
  modules.set(filename, api);
  for (const node of source.statements) {
    if (!ts.isImportDeclaration(node) || node.importClause?.isTypeOnly) continue;
    const specifier = node.moduleSpecifier.text;
    for (const item of node.importClause?.namedBindings?.elements ?? []) {
      if (item.isTypeOnly) continue;
      const name = item.propertyName?.text ?? item.name.text;
      imports.set(item.name.text, { specifier, name });
      bind(item.name.text, () => {
        const target = resolveModule(filename, specifier);
        return target ? schemaModule(target).scope[name] : require(specifier)[name];
      });
    }
  }
  declarations(source.statements);
  for (const node of source.statements) {
    if (ts.isFunctionDeclaration(node) && node.body) declarations(node.body.statements);
  }
  return api;
}

export function chatToolSchemas() {
  const filename = path.join(root, "src/lib/ai/tools/index.ts");
  const index = schemaModule(filename);
  let catalog;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(index.source) === "tools") catalog = node.initializer;
    ts.forEachChild(node, visit);
  };
  visit(index.source);
  assert.ok(catalog && ts.isObjectLiteralExpression(catalog), "Missing sealed runtime tool catalog");
  return Object.fromEntries(catalog.properties.map((entry) => {
    const name = entry.name.getText(index.source);
    const factoryName = entry.initializer.expression.expression.getText(index.source);
    const imported = index.imports.get(factoryName);
    assert.ok(imported, `Missing factory for ${name}`);
    const toolModule = schemaModule(resolveModule(filename, imported.specifier));
    const factory = toolModule.source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === imported.name);
    let definition;
    const find = (node) => {
      if (ts.isPropertyAssignment(node) && node.name.getText(toolModule.source) === name) definition = node.initializer.arguments?.[0];
      ts.forEachChild(node, find);
    };
    find(factory);
    assert.ok(definition && ts.isObjectLiteralExpression(definition), `Missing definition for ${name}`);
    const fields = Object.fromEntries(definition.properties.filter(ts.isPropertyAssignment).map((node) => [node.name.getText(toolModule.source), node.initializer]));
    const inputSchema = toolModule.evaluate(fields.inputSchema);
    const description = toolModule.evaluate(fields.description);
    assert.ok(inputSchema && typeof description === "string", `Missing schema/description for ${name}`);
    return [name, { inputSchema, description }];
  }));
}

export function measurePrefix(system, tools) {
  const encoder = getEncoding("cl100k_base");
  const schemas = Object.entries(tools).map(([name, definition]) => ({
    type: "function", name, description: definition.description, parameters: asSchema(definition.inputSchema).jsonSchema,
  }));
  const systemTokens = encoder.encode(system).length;
  const toolTokens = encoder.encode(JSON.stringify(schemas)).length;
  return { systemTokens, toolTokens, totalTokens: systemTokens + toolTokens, toolCount: schemas.length };
}

export function assertBudget(measurement, limit) {
  assert.ok(measurement.totalTokens <= limit, `Chat prefix ${measurement.totalTokens} exceeds budget ${limit}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const load = require("jiti")(import.meta.url, { alias: { "@": path.join(root, "src") }, fsCache: false });
  const { AGENT_SYSTEM_PROMPT, LEAN_AGENT_SYSTEM_PROMPT, CHAT_REQUEST_WRITING_STYLE } = load(path.join(root, "src/lib/ai/chatStream/prompt.ts"));
  const { compactChatToolSchemas } = load(path.join(root, "src/lib/ai/tools/compactSchemas.ts"));
  const tools = chatToolSchemas();
  const before = measurePrefix(AGENT_SYSTEM_PROMPT, tools);
  const after = measurePrefix(`${LEAN_AGENT_SYSTEM_PROMPT}\n\n${CHAT_REQUEST_WRITING_STYLE}`, compactChatToolSchemas(tools));
  console.log(JSON.stringify({ tokenizer: "cl100k_base proxy, not provider billing", optionalFlags: false, before, after }, null, 2));
  assert.ok(after.totalTokens < before.totalTokens, "Lean prefix must reduce tokens");
  assertBudget(after, Number(process.env.CHAT_PREFIX_TOKEN_BUDGET ?? 22462));
  console.log("chat-prefix-budget ok");
}
