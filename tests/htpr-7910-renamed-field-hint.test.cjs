const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");
const z = require("zod");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function loadSource(file, dependencies = {}) {
  const exports = {};
  const javascript = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  new Function("require", "exports", javascript)((name) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected import ${name} in ${file}`);
    return dependencies[name];
  }, exports);
  return exports;
}

const sdkTypes = {};
const { executeToolResult } = loadSource("src/lib/mcp-server/tool-response.ts", {
  zod: z,
  "@modelcontextprotocol/sdk/types.js": sdkTypes,
  "./stateless-http": {},
});

const searchTool = (errorHints) => ({
  name: "hypertask_search",
  description: "Searches tasks",
  parameters: z.object({ project_id: z.number().optional(), query: z.string().optional() }).strict(),
  ...(errorHints ? { errorHints } : {}),
  execute: async () => JSON.stringify({ success: true }),
});

async function errorText(tool, args) {
  const result = await executeToolResult(tool, args, "token");
  assert.equal(result.isError, true);
  return result.content[0].text;
}

test("a camelCase field names the documented field the caller meant", async () => {
  const text = await errorText(searchTool({ renamedField: true }), { projectId: 15, query: "ship" });
  assert.match(text, /Remove unsupported fields projectId from input/);
  assert.match(text, /Use project_id instead of projectId\./);
});

test("the flag off keeps today's wording and says nothing about project_id", async () => {
  const text = await errorText(searchTool(undefined), { projectId: 15 });
  assert.match(text, /Remove unsupported fields projectId from input/);
  assert.doesNotMatch(text, /instead of projectId/);
});

test("a field with no documented snake_case twin gets no wrong suggestion", async () => {
  const text = await errorText(searchTool({ renamedField: true }), { includeDescription: true });
  assert.match(text, /Remove unsupported fields includeDescription from input/);
  assert.doesNotMatch(text, /instead of includeDescription/);
});

test("a documented field still works through the same path", async () => {
  const result = await executeToolResult(searchTool({ renamedField: true }), { project_id: 15, query: "ship" }, "token");
  assert.equal(result.isError, undefined);
});

test("the handler turns the hint on only with its flag", () => {
  const source = read("src/lib/mcp-server/handler.ts");
  assert.match(source, /consolidated && await isFeatureEnabled\(HTPR_7910_RENAMED_FIELD_HINT_FLAG, ctx\.user\.id\)/);
  const consolidated = read("src/lib/mcp-server/consolidated-tools.ts");
  assert.match(consolidated, /renamedFieldHint = false/);
  assert.match(consolidated, /\.\.\.\(renamedFieldHint \? \{ renamedField: true \} : \{\}\)/);
});

const consolidatedTool = (documentedFields) => ({
  name: "hypertask_search",
  description: "Searches tasks",
  parameters: z.object({ action: z.string(), input: z.object({}).passthrough().optional() }).strict(),
  errorHints: { renamedField: true },
  execute: async () => {
    throw Object.assign(
      new z.ZodError([{ code: "unrecognized_keys", keys: ["projectId"], path: ["input"], message: "Unrecognized key: projectId" }]),
      documentedFields ? { documentedFields } : {},
    );
  },
});

test("the action's own documented fields drive the suggestion, not the wrapper's", async () => {
  const text = await errorText(consolidatedTool(["project_id", "query"]), { action: "search", input: { projectId: 15 } });
  assert.match(text, /Remove unsupported fields projectId from input/);
  assert.match(text, /Use project_id instead of projectId\./);
});

test("without the action's field list nothing is guessed", async () => {
  const text = await errorText(consolidatedTool(undefined), { action: "search", input: { projectId: 15 } });
  assert.doesNotMatch(text, /instead of projectId/);
});
