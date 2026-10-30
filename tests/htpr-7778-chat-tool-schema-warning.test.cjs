const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { z } = require("zod");

const root = path.resolve(__dirname, "..");
const toolsDir = path.join(root, "src/lib/ai/tools");
const load = require("jiti")(__filename, {
  alias: { "@": path.join(root, "src") },
  fsCache: false,
});

function strippedKeywords(schema) {
  const found = [];
  const walk = (node, at) => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${at}[${index}]`));
      return;
    }
    if (Object.hasOwn(node, "propertyNames")) found.push(`${at}.propertyNames`);
    if (typeof node.pattern === "string" && /\(\?[=!<]/.test(node.pattern)) {
      found.push(`${at}.pattern`);
    }
    for (const [key, value] of Object.entries(node)) walk(value, `${at}.${key}`);
  };
  walk(schema, "schema");
  return found;
}

function ragRetrievalTool() {
  const { createRagRetrievalTool } = load(path.join(toolsDir, "ragRetrieval.ts"));
  const tool = createRagRetrievalTool({ sendStatus() {}, body: {}, user: { id: 1 } });
  return tool.rag_retrieval;
}

test("rag_retrieval sends OpenAI a schema it keeps intact", () => {
  const schema = z.toJSONSchema(ragRetrievalTool().inputSchema, { io: "input" });
  assert.deepEqual(strippedKeywords(schema), []);
});

test("metadata_filters keeps accepting any string-keyed object", () => {
  const { inputSchema } = ragRetrievalTool();
  const accepted = inputSchema.safeParse({
    query: "late invoices",
    metadata_filters: { project_id: 15, type: ["task", "comment"], nested: { a: 1 } },
  });
  assert.equal(accepted.success, true);
  assert.deepEqual(accepted.data.metadata_filters, {
    project_id: 15,
    type: ["task", "comment"],
    nested: { a: 1 },
  });
  assert.equal(inputSchema.safeParse({ query: "late invoices", metadata_filters: "project 15" }).success, false);
  assert.equal(inputSchema.safeParse({ query: "late invoices" }).success, true);
});

test("no chat tool schema uses a keyword OpenAI drops", () => {
  const offenders = [];
  for (const file of fs.readdirSync(toolsDir).filter((name) => name.endsWith(".ts"))) {
    const source = fs.readFileSync(path.join(toolsDir, file), "utf8");
    if (source.includes("z.record(")) offenders.push(`${file}: z.record(`);
    for (const match of source.matchAll(/\.regex\(\s*\/[^/]*\(\?[=!<]/g)) {
      offenders.push(`${file}: ${match[0]}`);
    }
  }
  assert.deepEqual(offenders, []);
});
