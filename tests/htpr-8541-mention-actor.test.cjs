const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const stubModule = (relativePath, exports) => {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};

const response = () => {
  const result = { statusCode: 200, body: undefined };
  return {
    result,
    status(statusCode) {
      result.statusCode = statusCode;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };
};

const AGENT = "agent-runner-2";

function loadMentionRoute({ commentAgentId = AGENT } = {}) {
  const created = [];
  const pushes = [];
  const agentsRead = [];
  const comment = {
    id: 349452,
    text: "<p>@Valentin Yeo the fix is live</p>",
    createdAt: new Date("2026-11-04T01:14:34.862Z"),
    creator: { displayName: "Valentin Yeo", photoURL: null },
    agentId: commentAgentId,
    creatorId: 6,
  };

  const prisma = {
    task: {
      findFirst: async () => ({
        title: "A mention event names the agent's owner",
        uniqueIndex: 8541,
        projectId: 15,
        project: { ownerId: 6, members: [] },
      }),
    },
    comment: {
      findFirst: async ({ select }) =>
        select ? { creatorId: 6, agentId: commentAgentId } : comment,
    },
    user: {
      findUnique: async ({ where }) =>
        where.id === 6
          ? { displayName: "Valentin Yeo", photoURL: null }
          : { displayName: "Recipient", photoURL: null },
    },
    agent: {
      findUnique: async ({ where }) => {
        agentsRead.push(where.id);
        return { displayName: "Runner 2", photoURL: null };
      },
    },
    subscribedDevices: { findMany: async () => [{ id: "device-1" }] },
  };

  for (const name of [
    "src/lib/prisma.ts",
    "src/lib/auth/getSessionUser.ts",
    "src/lib/auth/agentScope.ts",
    "src/utils/controllers/notifications/creation-service/check-reminder_create-notification.ts",
    "src/utils/controllers/notifications/shouldNotify.ts",
    "src/utils/controllers/FCM.ts",
    "src/lib/realtime/server.ts",
    "src/utils/controllers/notifications/mentionText.ts",
    "src/utils/controllers/comments/readReceipts.ts",
    "src/utils/controllers/projects/getAllIncludes.ts",
  ]) {
    delete require.cache[path.join(root, name)];
  }

  stubModule("src/lib/prisma.ts", { default: prisma });
  stubModule("src/lib/auth/getSessionUser.ts", {
    getSessionUser: async () => ({ userId: 6 }),
  });
  stubModule("src/lib/auth/agentScope.ts", {
    withAgentScopeRequest: (req, run) => run(),
    prepareAgentScope: async () => {},
    recordAgentBoardScopeMiss: () => {},
  });
  stubModule(
    "src/utils/controllers/notifications/creation-service/check-reminder_create-notification.ts",
    {
      default: async (userId, projectId, taskId, payload) => {
        created.push({ userId, projectId, taskId, payload });
        return { id: 1 };
      },
    },
  );
  stubModule("src/utils/controllers/notifications/shouldNotify.ts", {
    shouldNotify: async () => true,
  });
  stubModule("src/utils/controllers/FCM.ts", {
    sendDataNewCommentFCM: async (body) => {
      pushes.push(body);
    },
  });
  stubModule("src/lib/realtime/server.ts", {
    broadcastTaskComment: async () => {},
  });
  stubModule("src/utils/controllers/notifications/mentionText.ts", {
    mentionPlainPreview: (text) => text.replace(/<[^>]*>/g, " ").trim(),
  });
  stubModule("src/utils/controllers/comments/readReceipts.ts", {
    omitCommentSeen: (input) => input,
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    projectContentAccessWhere: () => ({}),
  });

  const jiti = require("jiti")(__filename, {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
    cache: false,
  });
  const handler = jiti(
    path.join(root, "src/pages/api/comments/createMention.ts"),
  ).default;

  return {
    created,
    pushes,
    agentsRead,
    send: async (body) => {
      const res = response();
      await handler({ method: "POST", headers: {}, body }, res);
      return res.result;
    },
  };
}

const mentionRequest = {
  projectId: 15,
  taskId: 27744,
  userId: 6,
  commentId: 349452,
};

test("an agent's mention names the agent, not its owner", async () => {
  const route = loadMentionRoute();
  const result = await route.send(mentionRequest);

  assert.equal(result.statusCode, 200);
  assert.equal(route.created.length, 1);
  assert.equal(route.created[0].payload.type, "Mentioned");
  assert.equal(route.created[0].payload.fromUserId, 6);
  assert.equal(route.created[0].payload.fromAgentId, AGENT);
  assert.equal(route.agentsRead.includes(AGENT), true);
  assert.equal(route.pushes.length, 1);
  assert.equal(
    route.pushes[0].notificationTitle,
    "Recipient, directly mentioned by Runner 2",
  );
  assert.equal(
    JSON.parse(route.pushes[0].data.comment).creator.displayName,
    "Runner 2",
  );
});

test("a mention written by a person keeps the person's name", async () => {
  const route = loadMentionRoute({ commentAgentId: null });
  const result = await route.send(mentionRequest);

  assert.equal(result.statusCode, 200);
  assert.equal(route.created[0].payload.fromAgentId, undefined);
  assert.equal(route.agentsRead.length, 0);
  assert.equal(
    route.pushes[0].notificationTitle,
    "Recipient, directly mentioned by Valentin Yeo",
  );
});

test("the digest sentence names the agent when an agent wrote the comment", () => {
  const jiti = require("jiti")(__filename, {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
    cache: false,
  });
  const { notificationActorName } = jiti(
    path.join(root, "src/utils/controllers/notifications/actorDisplayName.ts"),
  );
  const { verbByType } = jiti(
    path.join(root, "src/utils/controllers/notifications/digestEvents.ts"),
  );

  const agentComment = {
    fromUser: { displayName: "Valentin Yeo" },
    fromAgent: { displayName: "Runner 2" },
  };
  const humanComment = { fromUser: { displayName: "Valentin Yeo" }, fromAgent: null };

  assert.equal(
    `${notificationActorName(agentComment)} ${verbByType.Mentioned}`,
    "Runner 2 mentioned you",
  );
  assert.equal(
    `${notificationActorName(humanComment)} ${verbByType.Mentioned}`,
    "Valentin Yeo mentioned you",
  );
  assert.equal(notificationActorName({}), "Someone");
});
