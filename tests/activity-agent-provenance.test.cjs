const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.join(__dirname, "..");
const stubs = path.join(__dirname, "stubs");

// createActivity pulls in the Prisma client and the summary queue at import
// time. Neither is under test here, so both are swapped for inert stubs and
// the real writer runs against an in-memory client.
const jiti = createJiti(__filename, {
  alias: {
    "@/lib/prisma": path.join(stubs, "prisma-noop.cjs"),
    "@/pages/api/queues/FAST/generateSummary": path.join(
      stubs,
      "schedule-summary-noop.cjs",
    ),
    "@": path.join(root, "src"),
  },
  interopDefault: true,
});

const { activityAgentId } = jiti(
  path.join(root, "src/lib/agents/activityAttribution.ts"),
);
const createActivityModule = jiti(
  path.join(root, "src/utils/controllers/activities/createActivity.ts"),
);
const createActivity =
  typeof createActivityModule === "function"
    ? createActivityModule
    : createActivityModule.default;

const agentBody = (agentId) => ({
  type: "TaskMove",
  data: {
    fromUserId: 6,
    fromUserDisplayName: "Valentin Yeo",
    fromAgent: { id: agentId, userId: 6, displayName: "HT Desktop Developer" },
    toSection: { sectionId: 2, sectionTitle: "In Progress" },
    fromSection: { sectionId: 1, sectionTitle: "Improvements" },
  },
});

const humanBody = () => ({
  type: "TaskMove",
  data: {
    fromUserId: 6,
    fromUserDisplayName: "Valentin Yeo",
    toSection: { sectionId: 2, sectionTitle: "In Progress" },
    fromSection: { sectionId: 1, sectionTitle: "Improvements" },
  },
});

function fakeTransaction() {
  const created = [];
  return {
    created,
    comment: {
      create: async ({ data }) => {
        created.push(data);
        return { id: created.length, ...data };
      },
    },
    task: {
      findUnique: async () => ({ updatedByUserIds: [6] }),
      update: async () => ({}),
    },
  };
}

test("an agent-made change records the agent on the activity row", async () => {
  const tx = fakeTransaction();
  await createActivity({
    activityBody: agentBody("ca30964f-b1a9-4164-84b7-39e91319a1ec"),
    taskId: 24505,
    runTaskSummary: false,
    transaction: tx,
  });
  assert.equal(tx.created.length, 1);
  assert.equal(tx.created[0].agentId, "ca30964f-b1a9-4164-84b7-39e91319a1ec");
});

test("a human-made change leaves the agent column empty", async () => {
  // Attributing a person's edit to an agent is worse than no attribution.
  const tx = fakeTransaction();
  await createActivity({
    activityBody: humanBody(),
    taskId: 24505,
    runTaskSummary: false,
    transaction: tx,
  });
  assert.equal(tx.created[0].agentId, null);
});

test("a malformed activity body never fabricates an agent", () => {
  assert.equal(activityAgentId(null), null);
  assert.equal(activityAgentId("TaskMove"), null);
  assert.equal(activityAgentId({}), null);
  assert.equal(activityAgentId({ data: null }), null);
  assert.equal(activityAgentId({ data: { fromAgent: null } }), null);
  assert.equal(activityAgentId({ data: { fromAgent: {} } }), null);
  assert.equal(activityAgentId({ data: { fromAgent: { id: "" } } }), null);
  assert.equal(activityAgentId({ data: { fromAgent: { id: 7 } } }), null);
});

test("a description update by an agent is stored against that agent", async () => {
  // The shape updateTaskSingle builds for a description edit, run through the
  // real writer, so a wrong or dropped agent id fails here rather than in prod.
  const tx = fakeTransaction();
  await createActivity({
    activityBody: {
      type: "TaskDescriptionUpdate",
      data: {
        fromUserId: 6,
        fromUserDisplayName: "Valentin Yeo",
        fromUser: { id: 6, displayName: "Valentin Yeo" },
        fromAgent: {
          id: "ca30964f-b1a9-4164-84b7-39e91319a1ec",
          userId: 6,
          displayName: "HT Desktop Developer",
        },
      },
    },
    taskId: 24505,
    runTaskSummary: false,
    transaction: tx,
  });
  assert.equal(tx.created[0].agentId, "ca30964f-b1a9-4164-84b7-39e91319a1ec");
});

// The agent edits under its owner's user id, so an activity row without
// fromAgent renders as the human in CommentTaskActivity.tsx. The description
// update is written inline in the task controller rather than by a builder, and
// executing updateTaskSingle needs the full Prisma surface, so the wiring that
// feeds the behavioral test above is checked at the source.
test("the task controller feeds the acting agent into that activity", () => {
  const single = fs.readFileSync(
    path.join(root, "src/utils/controllers/tasks/single.ts"),
    "utf8",
  );
  const body = single.slice(
    single.indexOf('type: "TaskDescriptionUpdate"'),
    single.indexOf("createActivity({", single.indexOf('type: "TaskDescriptionUpdate"')),
  );
  assert.match(body, /fromAgent: actingAgent \?\? null/);
  assert.match(single, /tx\.agent\.findUnique\(\{\s*where: \{ id: agentId \}/);
});
