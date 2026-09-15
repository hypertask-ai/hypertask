/**
 * HTPR-6516: agent tokens stamp the acting agent on write, and a deleted
 * agent's stored name is what readers see.
 *
 * Run: npm run test:file -- tests/htpr-6516-agent-attribution.test.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const {
  activityAgentDisplayName,
  activityAgentId,
} = jiti(path.join(root, "src/lib/agents/activityAttribution.ts"));
const {
  PRIVATE_AGENT_DISPLAY_NAME,
  resolvePublicAgentDisplayName,
} = jiti(path.join(root, "src/lib/agents/publicAgent.ts"));

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const labelActivity = {
  type: "TaskLabel",
  status: "Assigned",
  data: {
    fromUserId: 6,
    fromAgent: {
      id: "2499a30e-3cb9-40ed-9ae3-0a6b76891437",
      displayName: "Dev 1",
    },
  },
};

test("activity JSON yields both the agent id and the name copied at write time", () => {
  assert.equal(
    activityAgentId(labelActivity),
    "2499a30e-3cb9-40ed-9ae3-0a6b76891437",
  );
  assert.equal(activityAgentDisplayName(labelActivity), "Dev 1");
  assert.equal(activityAgentDisplayName({ type: "TaskLabel", data: {} }), null);
});

test("a deleted agent's stored name is public; a hidden living agent is not", () => {
  assert.equal(
    resolvePublicAgentDisplayName({
      hasAgentRow: false,
      visibleAgent: null,
      storedDisplayName: "Cursor Dev",
    }),
    "Cursor Dev",
  );
  assert.equal(
    resolvePublicAgentDisplayName({
      hasAgentRow: true,
      visibleAgent: null,
      storedDisplayName: "Secret Bot",
    }),
    PRIVATE_AGENT_DISPLAY_NAME,
  );
  assert.equal(
    resolvePublicAgentDisplayName({
      hasAgentRow: true,
      visibleAgent: { displayName: "Dev 1" },
      storedDisplayName: "Dev 1",
    }),
    "Dev 1",
  );
  assert.equal(
    resolvePublicAgentDisplayName({
      hasAgentRow: false,
      visibleAgent: null,
      storedDisplayName: null,
    }),
    null,
  );
});

test("createActivity and createCommentService stamp agentDisplayName on insert", () => {
  const activity = read("src/utils/controllers/activities/createActivity.ts");
  assert.match(activity, /agentDisplayName: activityAgentDisplayName/);
  const comment = read(
    "src/utils/controllers/comments/createCommentService.ts",
  );
  assert.match(comment, /agentDisplayName: actingAgentName/);
});

test("MCP label writes pass the acting agent into the activity", () => {
  const services = read("src/lib/mcp/tasks/services.ts");
  assert.match(services, /fromAgent\?: ActingAgent \| null/);
  assert.equal(services.match(/fromAgent,/g)?.length >= 4, true);
  const update = read("src/lib/mcp/tasks/updateTask.ts");
  assert.match(update, /fromAgent: actingAgent|actingAgent\n\s*\)/);
  assert.match(update, /select: actingAgentSelect/);
});
