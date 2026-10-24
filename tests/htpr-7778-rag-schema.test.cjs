const test = require("node:test");
const assert = require("node:assert/strict");
const { asSchema } = require("@ai-sdk/provider-utils");
const { load } = require("./task-route-loader.cjs");

const FLAG = "htpr-7778-rag-schema";

function fixture(enabled) {
  const calls = [];
  const flagReads = [];
  const statuses = [];
  const { createRagRetrievalTool } = load("src/lib/ai/tools/ragRetrieval.ts", {
    "@/lib/flags": {
      isFeatureEnabled: async (...args) => {
        flagReads.push(args);
        return enabled;
      },
    },
    "@/lib/rag/retrieveBoardKnowledge": {
      retrieveBoardKnowledge: async (...args) => {
        calls.push(args);
        return { success: true, documents: [{ taskId: 7778 }], total: 1 };
      },
    },
    "@/lib/ai/tools/helpers": { sanitizeForJson: (value) => value },
  });
  const tool = createRagRetrievalTool({
    user: { id: 42 },
    body: { default_context: { project_id: 15 } },
    sendStatus: (status) => statuses.push(status),
  }).rag_retrieval;
  return { tool, schema: asSchema(tool.inputSchema), calls, flagReads, statuses };
}

test("RAG provider schema omits unsupported propertyNames when the bugfix is on", async () => {
  const f = fixture(true);
  const schema = await f.schema.jsonSchema;
  assert.deepEqual(schema.properties.metadata_filters, {
    type: "object",
    properties: {},
    additionalProperties: {},
  });
  assert.doesNotMatch(JSON.stringify(schema), /"propertyNames"/);
  assert.deepEqual(schema.required, ["query"]);
  assert.deepEqual(f.flagReads, [[FLAG, 42]]);
});

test("RAG flag off retains the original provider schema as a rollback and positive control", async () => {
  const f = fixture(false);
  const schema = await f.schema.jsonSchema;
  assert.deepEqual(schema.properties.metadata_filters, {
    type: "object",
    propertyNames: { type: "string" },
    additionalProperties: {},
  });
  assert.deepEqual(f.flagReads, [[FLAG, 42]]);
});

for (const enabled of [true, false]) {
  test(`RAG metadata and validation behavior are preserved with flag ${enabled ? "on" : "off"}`, async () => {
    const f = fixture(enabled);
    const input = {
      query: "customer authentication problem",
      metadata_filters: {
        project_id: 15,
        status: { $eq: "Normal" },
        task_id: { $in: [7778, 7779] },
        custom: { nested: [true, null, "value"] },
      },
      limit: "5",
    };
    const parsed = await f.schema.validate(input);
    assert.deepEqual(parsed, {
      success: true,
      value: { ...input, limit: 5 },
    });
    assert.deepEqual(await f.schema.validate({ query: "hello" }), {
      success: true,
      value: { query: "hello", limit: 10 },
    });
    for (const invalid of [
      {},
      { query: "" },
      { query: "x".repeat(501) },
      { query: "hello", metadata_filters: null },
      { query: "hello", metadata_filters: [] },
      { query: "hello", metadata_filters: "project_id=15" },
      { query: "hello", limit: 0 },
      { query: "hello", limit: 26 },
      { query: "hello", limit: 1.5 },
    ]) {
      assert.equal((await f.schema.validate(invalid)).success, false);
    }
    assert.deepEqual(await f.tool.execute(parsed.value), {
      success: true,
      documents: [{ taskId: 7778 }],
      total: 1,
    });
    assert.deepEqual(f.calls, [[{
      query: "customer authentication problem",
      metadataFilters: input.metadata_filters,
      limit: 5,
      defaultProjectId: 15,
    }, { userId: 42 }]]);
    assert.deepEqual(f.statuses, ["rag_retrieval"]);
  });
}

test("RAG schema rollback is registered as a low-risk Everyone-default bugfix", () => {
  const definition = load("src/lib/flags/definitions/htpr-7778-rag-schema.ts", {});
  assert.equal(definition.HTPR_7778_RAG_SCHEMA_FLAG, FLAG);
  assert.equal(definition.default.key, FLAG);
  assert.equal(definition.default.kind, "bugfix");
  assert.equal(definition.default.defaultMode, "EVERYONE");
  assert.equal(definition.default.releaseRisk.risk, "small");
  assert.equal(definition.default.releaseRisk.highRisk, undefined);
  assert.match(definition.default.releaseRisk.reason, /serialization/);
});
