const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const ai = require("ai");
const { MockLanguageModelV3 } = require("ai/test");

const root = path.resolve(__dirname, "..");
const board = {
  name: "SaaS MVP",
  views: [
    { title: "Design", filterType: "label", filterValue: "design" },
    { title: "Urgent", filterType: "priority", filterValue: "1" },
    { title: "This Week", filterType: "due", filterValue: "this-week" },
  ],
  columns: ["To Do", "In Progress", "Done"].map((title) => ({
    title,
    tasks: ["Design dashboard", "Build subscription flow"].map((title) => ({
      title,
      label: "design",
      priority: 1,
      dueInDays: null,
    })),
  })),
};
let calls = [];
let gatewayKeys = [];
const model = new MockLanguageModelV3({
  doGenerate: async (options) => {
    calls.push(options);
    // Simulate a completion that spends 650 tokens reasoning before emitting JSON.
    const json = JSON.stringify(board);
    const reasoningTokens = 650;
    const textTokens = Math.ceil(json.length / 4);
    const requiredTokens = reasoningTokens + textTokens;
    const exhausted = options.maxOutputTokens < requiredTokens;
    const availableTextCharacters = Math.max(0, options.maxOutputTokens - reasoningTokens) * 4;
    return {
      content: [{ type: "text", text: exhausted ? json.slice(0, availableTextCharacters) : json }],
      finishReason: { unified: exhausted ? "length" : "stop", raw: exhausted ? "length" : "stop" },
      usage: {
        inputTokens: { total: 200 },
        outputTokens: { total: Math.min(options.maxOutputTokens, requiredTokens), reasoning: reasoningTokens },
      },
      warnings: [],
    };
  },
});
const aiPath = require.resolve("ai");
require.cache[aiPath].exports = {
  ...ai,
  createGateway: ({ apiKey }) => {
    gatewayKeys.push(apiKey);
    return (modelId) => {
      assert.equal(modelId, "openai/gpt-6-luna");
      return model;
    };
  },
};
const jiti = require("jiti")(path.join(root, "tests/generate-demo-board-jiti.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
  cache: false,
});
const { generateDemoBoard, DemoBoardGenerationUnavailableError } = jiti(
  path.join(root, "src/lib/demo/generateDemoBoard.ts"),
);
const originalKey = process.env.DEMO_AI_GATEWAY_API_KEY;
test.beforeEach(() => {
  process.env.DEMO_AI_GATEWAY_API_KEY = " dedicated-demo-test-key ";
  calls = [];
  gatewayKeys = [];
});
test.after(() => {
  if (originalKey === undefined) delete process.env.DEMO_AI_GATEWAY_API_KEY;
  else process.env.DEMO_AI_GATEWAY_API_KEY = originalKey;
});

test("the previous 700-token cap reproduces an actual SDK JSON parsing failure", async () => {
  await assert.rejects(
    ai.generateObject({
      model,
      schema: require("zod").z.object({ name: require("zod").z.string() }),
      prompt: "Build a SaaS MVP",
      maxOutputTokens: 700,
    }),
    (error) => {
      assert.equal(ai.NoObjectGeneratedError.isInstance(error), true);
      assert.equal(error.finishReason, "length");
      assert.match(error.message, /could not parse/);
      return true;
    },
  );
});

test("demo generation leaves room for reasoning and a complete validated board", async () => {
  const generated = await generateDemoBoard("Build a SaaS MVP");
  assert.equal(generated.name, board.name);
  assert.equal(generated.columns.length, 3);
  assert.equal(generated.views.length, 3);
  assert.equal(generated.columns.flatMap((column) => column.tasks).filter((task) => task.dueInDays !== null).length, 5);
  assert.deepEqual(gatewayKeys, ["dedicated-demo-test-key"]);
  assert.deepEqual(calls[0].providerOptions.openai, { reasoningEffort: "low" });
  assert.deepEqual(calls[0].providerOptions.gateway, { tags: ["demo-board"] });
  assert.equal(calls[0].temperature, undefined);
});

test("a missing dedicated demo key still fails closed without calling the gateway", async () => {
  delete process.env.DEMO_AI_GATEWAY_API_KEY;
  await assert.rejects(generateDemoBoard("Build a SaaS MVP"), DemoBoardGenerationUnavailableError);
  assert.deepEqual(gatewayKeys, []);
  assert.deepEqual(calls, []);
});
