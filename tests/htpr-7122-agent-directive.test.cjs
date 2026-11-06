const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
let loads = 0;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function loadHello() {
  stubModule("src/lib/prisma.ts", { default: { project: { findMany: async () => [], findFirst: async () => null }, agent: { findUnique: async () => null } } });
  stubModule("src/lib/flags.ts", { isFeatureEnabled: async () => false });
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
  return jiti(path.join(root, "src/lib/mcp/hello/getHelloPayload.ts"));
}

const ctx = { user: { id: 6, displayName: "Valentin Yeo", email: "v@example.test" }, agentId: "agent-runner-5" };

test("hello always tells agents to react instead of ack comments", async () => {
  const mod = loadHello();
  const { capabilities } = await mod.getHelloPayload(ctx);
  assert.match(capabilities.comments, /react with an emoji instead of posting an ack comment/);
  assert.match(capabilities.reactions, /POST \/api\/mcp\/comments\/\{comment_id\}\/reactions/);
  assert.match(capabilities.reactions, /hypertask comment react <comment_id> --emoji/);
  assert.match(capabilities.reactions, /never counts as an approval or decision/);
  assert.match(capabilities.abilities, /Use all of Hypertask's abilities/);
});

test("hello capability gates still load flags lazily", () => {
  const source = require("node:fs").readFileSync(path.join(root, "src/lib/mcp/hello/getHelloPayload.ts"), "utf8");
  assert.match(source, /import\('@\/lib\/flags'\)/);
  assert.doesNotMatch(source, /^import .*['"]@\/lib\/flags['"]/m);
});
