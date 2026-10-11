// HTPR-7122: the hello directive tells agents to react instead of posting ack
// comments, to use every Hypertask ability, and that an agent's reaction never
// counts as an approval. It is served only while htpr-7122-agent-reactions is on.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const FLAG = "htpr-7122-agent-reactions";
let loads = 0;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function loadHello(flagOn) {
  const flagCalls = [];
  stubModule("src/lib/prisma.ts", { default: { project: { findMany: async () => [] } } });
  stubModule("src/lib/flags.ts", {
    isFeatureEnabled: async (key, userId) => {
      flagCalls.push([key, userId]);
      return flagOn;
    },
  });
  stubModule("src/lib/mcp/auth.ts", {
    checkMcpRateLimit: async () => null,
    createUnauthorizedResponse: () => null,
    validateMcpAuth: async () => null,
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", { getProjectListingWhere: () => ({}) });
  delete require.cache[path.join(root, "src/lib/mcp/hello/getHelloPayload.ts")];
  const jiti = createJiti(path.join(root, `tests/htpr-7122-directive-loader-${++loads}.cjs`), {
    alias: { "@": path.join(root, "src") },
    interopDefault: true,
  });
  return { mod: jiti(path.join(root, "src/lib/mcp/hello/getHelloPayload.ts")), flagCalls };
}

const ctx = { user: { id: 6, displayName: "Valentin Yeo", email: "v@example.test" }, agentId: "agent-runner-5" };

test("flag off: agents get exactly today's capabilities", async () => {
  const { mod, flagCalls } = loadHello(false);
  const payload = await mod.getHelloPayload(ctx);
  assert.deepEqual(payload.capabilities, mod.HELLO_CAPABILITIES);
  assert.equal("reactions" in payload.capabilities, false);
  assert.deepEqual(flagCalls, [[FLAG, 6]]);
});

test("flag on: the directive asks for reactions instead of ack comments", async () => {
  const { mod } = loadHello(true);
  const { capabilities } = await mod.getHelloPayload(ctx);
  assert.match(capabilities.comments, /react with an emoji instead of posting an ack comment/);
  assert.match(capabilities.reactions, /POST \/api\/mcp\/comments\/\{comment_id\}\/reactions/);
  assert.match(capabilities.reactions, /hypertask comment react <comment_id> --emoji/);
  assert.match(capabilities.reactions, /never counts as an approval or decision/);
  assert.match(capabilities.abilities, /Use all of Hypertask's abilities/);
  // Every other capability stays as it was.
  for (const [key, value] of Object.entries(mod.HELLO_CAPABILITIES)) {
    if (key !== "comments") assert.equal(capabilities[key], value, key);
  }
});

test("the gate is a lazy server-side import, so routes that stub modules still load", () => {
  const source = require("node:fs").readFileSync(path.join(root, "src/lib/mcp/hello/getHelloPayload.ts"), "utf8");
  assert.match(source, /import\('@\/lib\/flags'\)/);
  assert.doesNotMatch(source, /^import .*['"]@\/lib\/flags['"]/m);
});

test("the flag is a feature flag for Owner and QA", () => {
  const definition = createJiti(__filename, { interopDefault: true })(
    path.join(root, "src/lib/flags/definitions/htpr-7122-agent-reactions.ts"),
  );
  const flag = definition.default ?? definition;
  assert.equal(flag.key, FLAG);
  assert.equal(flag.kind, "feature");
  assert.equal(flag.defaultMode, "OWNER_AND_QA");
});
