// HTPR-7519: hello adds the signed-in agent, a start board and 3 next steps
// while htpr-7519-login-guided-start is on; off, the payload is unchanged.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const FLAG = "htpr-7519-login-guided-start";
let loads = 0;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function loadHello(flagOn, agentLookups) {
  const projects = [
    { id: 1, name: "alpha", title: "Alpha", playbook: null, createdAt: new Date("2026-01-01"), ai_custom_instructions: [] },
    { id: 9142, name: "launch", title: "Product Launch", playbook: null, createdAt: new Date("2026-10-21"), ai_custom_instructions: [] },
  ];
  stubModule("src/lib/prisma.ts", {
    default: {
      project: { findMany: async () => projects },
      agent: { findUnique: async (args) => { agentLookups.push(args.where.id); return { id: args.where.id, displayName: "Claude Code" }; } },
    },
  });
  stubModule("src/lib/flags.ts", { isFeatureEnabled: async (key) => key === FLAG && flagOn });
  stubModule("src/lib/mcp/auth.ts", {
    checkMcpRateLimit: async () => null,
    createUnauthorizedResponse: () => null,
    validateMcpAuth: async () => null,
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", { getProjectListingWhere: () => ({}) });
  delete require.cache[path.join(root, "src/lib/mcp/hello/getHelloPayload.ts")];
  const jiti = createJiti(path.join(root, `tests/htpr-7519-hello-loader-${++loads}.cjs`), {
    alias: { "@": path.join(root, "src") },
    interopDefault: true,
  });
  return jiti(path.join(root, "src/lib/mcp/hello/getHelloPayload.ts"));
}

const user = { id: 6, displayName: "Maria Lopez", email: "m@example.test" };

test("flag on, agent token: hello names the agent, starts on the newest board and lists 3 steps", async () => {
  const lookups = [];
  const payload = await loadHello(true, lookups).getHelloPayload({ user, agentId: "agent-1" });
  assert.deepEqual(payload.agent, { id: "agent-1", displayName: "Claude Code" });
  assert.equal(payload.startBoard.id, 9142);
  assert.deepEqual(payload.nextSteps.map((s) => s.command), [
    "hypertask task list --project 9142",
    'hypertask task create --project 9142 --title "My first task"',
    "hypertask project playbook 9142",
  ]);
  assert.deepEqual(lookups, ["agent-1"]);
});

test("flag on, user token: no agent lookup, agent is null", async () => {
  const lookups = [];
  const payload = await loadHello(true, lookups).getHelloPayload({ user, agentId: null });
  assert.equal(payload.agent, null);
  assert.equal(payload.nextSteps.length, 3);
  assert.deepEqual(lookups, []);
});

test("flag off: none of the new fields and no agent lookup", async () => {
  const lookups = [];
  const payload = await loadHello(false, lookups).getHelloPayload({ user, agentId: "agent-1" });
  for (const key of ["agent", "startBoard", "nextSteps"]) assert.equal(key in payload, false, key);
  assert.deepEqual(lookups, []);
  assert.deepEqual(payload.boards.map((b) => Object.keys(b)), [
    ["id", "name", "title", "boardUrl", "taskUrlTemplate"],
    ["id", "name", "title", "boardUrl", "taskUrlTemplate"],
  ]);
});

test("flag ships on Everyone as a feature", () => {
  const definition = createJiti(__filename, { interopDefault: true })(
    path.join(root, "src/lib/flags/definitions/htpr-7519-login-guided-start.ts"),
  );
  const flag = definition.default ?? definition;
  assert.equal(flag.key, FLAG);
  assert.equal(flag.kind, "feature");
  assert.equal(flag.defaultMode, "EVERYONE");
});
