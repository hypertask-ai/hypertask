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
const { mapTaskAssignee } = jiti(
  path.join(root, "src/lib/mcp/tasks/mappers.ts"),
);
const { assigneePublicName, commentActorName, splitAssignees } = jiti(
  path.join(root, "src/lib/assignees.ts"),
);

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
      attributionEnabled: true,
    }),
    "Cursor Dev",
  );
  assert.equal(
    resolvePublicAgentDisplayName({
      hasAgentRow: false,
      visibleAgent: null,
      storedDisplayName: "Cursor Dev",
    }),
    PRIVATE_AGENT_DISPLAY_NAME,
  );
  assert.equal(
    resolvePublicAgentDisplayName({
      hasAgentRow: true,
      visibleAgent: null,
      storedDisplayName: "Secret Bot",
      attributionEnabled: true,
    }),
    PRIVATE_AGENT_DISPLAY_NAME,
  );
  assert.equal(
    resolvePublicAgentDisplayName({
      hasAgentRow: true,
      visibleAgent: { displayName: "Dev 1" },
      storedDisplayName: "Dev 1",
      attributionEnabled: true,
    }),
    "Dev 1",
  );
  assert.equal(
    resolvePublicAgentDisplayName({
      hasAgentRow: false,
      visibleAgent: null,
      storedDisplayName: null,
      attributionEnabled: true,
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

test("read paths gate durable attribution behind htpr-6516-agent-attribution", () => {
  for (const relativePath of [
    "src/app/api/mcp/comments/route.ts",
    "src/app/api/mcp/comments/[comment_id]/route.ts",
    "src/app/api/mcp/tasks/context/route.ts",
    "src/app/api/ai/chat/stream/route.ts",
    "src/utils/controllers/taskDetail/load.ts",
  ]) {
    const source = read(relativePath);
    assert.match(
      source,
      /isFeatureEnabled\(\s*HTPR_6516_AGENT_ATTRIBUTION_FLAG/,
      `${relativePath} must check the rollout flag`,
    );
  }
});

test("task get/list print the agent name on an agent assignment, not the owner", () => {
  const mapped = mapTaskAssignee(
    {
      user: { id: 6, email: "valentin.yeo@gmail.com", displayName: "Valentin Yeo" },
      agent: {
        id: "1a6dd89d-5fff-4c1b-9610-0a4270a7f2c7",
        userId: 6,
        visibility: "PRIVATE",
        members: [],
        displayName: "Dev 2",
      },
    },
    6,
    15,
  );
  assert.equal(mapped.displayName, "Dev 2");
  assert.equal(mapped.agent.id, "1a6dd89d-5fff-4c1b-9610-0a4270a7f2c7");
  assert.equal(mapped.id, 6);
});

test("inbox and shared cards read the agent name from the assignee row", () => {
  const row = {
    id: 1,
    userId: 6,
    agentId: "1a6dd89d-5fff-4c1b-9610-0a4270a7f2c7",
    user: { id: 6, displayName: "Valentin Yeo" },
    agent: { id: "1a6dd89d-5fff-4c1b-9610-0a4270a7f2c7", displayName: "Dev 2" },
  };
  assert.equal(assigneePublicName(row), "Dev 2");
  const { humanAssignees, agentAssignees } = splitAssignees([row]);
  assert.equal(humanAssignees.length, 0);
  assert.equal(agentAssignees[0].displayName, "Dev 2");
});

test("saved and inbox comment rows prefer the agent name over the owner", () => {
  assert.equal(
    commentActorName({
      creator: { displayName: "Valentin Yeo" },
      agent: { id: "2499a30e-3cb9-40ed-9ae3-0a6b76891437", displayName: "Dev 1" },
      agentDisplayName: "Dev 1",
    }),
    "Dev 1",
  );
  assert.equal(
    commentActorName({ creator: { displayName: "Valentin Yeo" } }),
    "Valentin Yeo",
  );
  const saved = read(
    "src/components/PageComponents/Starred/SavedContentRow.tsx",
  );
  const inbox = read("src/components/notifications/comment.tsx");
  assert.match(saved, /commentActorName\(comment\)/);
  assert.match(inbox, /commentActorName\(notification\.comment\)/);
});

test("cookie label and waiting-on writes stamp fromAgent from the session", () => {
  for (const relativePath of [
    "src/pages/api/labels/assignLabel.ts",
    "src/pages/api/labels/createLabel.ts",
    "src/pages/api/tasks/waiting-on.ts",
  ]) {
    const source = read(relativePath);
    assert.match(
      source,
      /resolveActingAgentFromCookies/,
      `${relativePath} must read the session agent`,
    );
    assert.match(source, /fromAgent/, `${relativePath} must persist fromAgent`);
  }
  const waitingOnUi = read(
    "src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentTaskActivity.tsx",
  );
  assert.match(
    waitingOnUi,
    /TaskWaitingOnActivity[\s\S]*fromAgent\?\.displayName/,
  );
});

test("MCP label writes pass the acting agent into the activity", () => {
  const services = read("src/lib/mcp/tasks/services.ts");
  assert.match(services, /fromAgent\?: ActingAgent \| null/);
  assert.equal(services.match(/fromAgent,/g)?.length >= 4, true);
  const update = read("src/lib/mcp/tasks/updateTask.ts");
  assert.match(update, /fromAgent: actingAgent|actingAgent\n\s*\)/);
  assert.match(update, /select: actingAgentSelect/);
});
