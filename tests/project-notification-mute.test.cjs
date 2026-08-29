const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { NextRequest } = require("next/server");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

function resetModules(relativePaths) {
  for (const relativePath of relativePaths) {
    delete require.cache[path.join(root, relativePath)];
  }
}

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/jiti-project-mute-${++jitiEntryId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
      cache: false,
    },
  );
  return jiti(path.join(root, relativePath));
}

function loadRoute({
  session = { userId: 6 },
  project = { id: 15 },
  mute = null,
} = {}) {
  const calls = { deleted: [], upserted: [] };
  resetModules([
    "src/app/api/notifications/project-mute/route.ts",
    "src/lib/auth/getSessionUser.ts",
    "src/utils/controllers/projects/getAllIncludes.ts",
    "src/lib/prisma.ts",
  ]);
  stubModule("src/lib/auth/getSessionUser.ts", {
    getSessionUser: async () => session,
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", {
    projectContentAccessWhere: (userId) => ({ ownerId: userId }),
  });
  stubModule("src/lib/prisma.ts", {
    default: {
      project: { findFirst: async () => project },
      projectMute: {
        findUnique: async () => mute,
        upsert: async (args) => {
          calls.upserted.push(args);
          return args.create;
        },
        deleteMany: async (args) => {
          calls.deleted.push(args);
          return { count: 1 };
        },
      },
    },
  });
  const route = loadTs("src/app/api/notifications/project-mute/route.ts");
  return { ...route, calls };
}

function request(method, body) {
  return new NextRequest(
    "https://app.hypertask.ai/api/notifications/project-mute?projectId=15",
    {
      method,
      ...(body === undefined
        ? {}
        : {
            body: JSON.stringify(body),
            headers: { "content-type": "application/json" },
          }),
    },
  );
}

test("board mute preference requires a signed-in user", async () => {
  const { GET } = loadRoute({ session: null });
  const response = await GET(request("GET"));
  assert.equal(response.status, 401);
});

test("board mute preference is hidden from users without board access", async () => {
  const { POST, calls } = loadRoute({ project: null });
  const response = await POST(request("POST", { projectId: 15, muted: true }));
  assert.equal(response.status, 404);
  assert.equal(calls.upserted.length, 0);
});

test("a member can mute only their own notifications for the board", async () => {
  const { POST, calls } = loadRoute();
  const response = await POST(request("POST", { projectId: 15, muted: true }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { muted: true });
  assert.deepEqual(calls.upserted[0].create, { projectId: 15, userId: 6 });
});

test("the board mute read returns the signed-in user's current preference", async () => {
  const { GET } = loadRoute({ mute: { id: "mute-1" } });
  const response = await GET(request("GET"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { muted: true });
});

test("ordinary inbox notifications stop at the project mute gate", async () => {
  const created = [];
  const database = {
    projectMute: {
      findUnique: async () => ({ id: "mute-1" }),
    },
    reminder: { findFirst: async () => null },
    notification: {
      create: async (args) => {
        created.push(args);
        return args.data;
      },
    },
  };
  stubModule("src/lib/prisma.ts", { default: {} });
  stubModule("src/lib/realtime/server.ts", { broadcastInboxChange: () => {} });
  stubModule("src/lib/taskCardActions/writeLocks.ts", {
    withTaskInboxWriteLock: async (_taskId, callback) => callback(database),
  });
  stubModule("src/utils/controllers/reminders/invokeReminder.ts", {
    default: async () => {},
  });
  const createNotification = loadTs(
    "src/utils/controllers/notifications/creation-service/check-reminder_create-notification.ts",
  ).default;

  const result = await createNotification(
    6,
    15,
    99,
    { userId: 6, fromUserId: 7, type: "Comment" },
    false,
    database,
  );

  assert.equal(result, undefined);
  assert.equal(created.length, 0);
});

test("agent-addressed notifications bypass the human board mute", async () => {
  const database = {
    projectMute: {
      findUnique: async () => ({ id: "mute-1" }),
    },
    reminder: { findFirst: async () => null },
    notification: {
      create: async ({ data }) => ({ id: 1, ...data }),
    },
  };
  stubModule("src/lib/prisma.ts", { default: {} });
  stubModule("src/lib/realtime/server.ts", { broadcastInboxChange: () => {} });
  stubModule("src/lib/taskCardActions/writeLocks.ts", {
    withTaskInboxWriteLock: async (_taskId, callback) => callback(database),
  });
  stubModule("src/utils/controllers/reminders/invokeReminder.ts", {
    default: async () => {},
  });
  const createNotification = loadTs(
    "src/utils/controllers/notifications/creation-service/check-reminder_create-notification.ts",
  ).default;

  const result = await createNotification(
    6,
    15,
    99,
    {
      userId: 6,
      fromUserId: 7,
      type: "Comment",
      agentId: "agent-1",
    },
    false,
    database,
  );

  assert.equal(result.agentId, "agent-1");
});

test("project mute filtering removes muted recipients before push dispatch", async () => {
  resetModules([
    "src/lib/prisma.ts",
    "src/utils/controllers/notifications/projectMute.ts",
  ]);
  stubModule("src/lib/prisma.ts", {
    default: {
      projectMute: {
        findMany: async () => [{ userId: 7 }],
      },
    },
  });
  const { filterProjectMutedUserIds } = loadTs(
    "src/utils/controllers/notifications/projectMute.ts",
  );

  assert.deepEqual(await filterProjectMutedUserIds([6, 7, 8], 15), [6, 8]);
});

test("task-scoped email does not enqueue or send when its board is muted", async () => {
  const calls = { enqueued: 0, sent: 0 };
  stubModule("src/utils/controllers/notifications/projectMute.ts", {
    isTaskProjectMuted: async () => true,
  });
  stubModule("src/utils/controllers/notifications/digest.ts", {
    enqueueDigest: async () => {
      calls.enqueued += 1;
      return true;
    },
  });
  stubModule("src/lib/email/sendEmail.ts", {
    sendEmail: async () => {
      calls.sent += 1;
      return {};
    },
  });
  stubModule("src/lib/email/unsubscribe.ts", {
    unsubscribeHeaders: () => ({}),
  });
  stubModule("src/utils/controllers/notifications/emailTemplates.ts", {
    renderNotificationEmail: () => ({ subject: "subject", html: "body" }),
  });
  const { sendEmailNotification } = loadTs(
    "src/utils/controllers/notifications/sendNotification.ts",
  );

  const result = await sendEmailNotification("Comment", {
    sender: "Someone",
    recipient: "user@example.com",
    title: "Task",
    link: "https://app.hypertask.ai/detail/project-15/4697",
    userId: 6,
    taskId: 99,
  });

  assert.equal(result, true);
  assert.deepEqual(calls, { enqueued: 0, sent: 0 });
});

test("snoozed inbox restoration excludes muted boards", () => {
  const source = require("node:fs").readFileSync(
    path.join(root, "src/utils/controllers/reminders/invokeReminder.ts"),
    "utf8",
  );

  assert.match(
    source,
    /projectMutes:\s*\{\s*none:\s*\{\s*userId:\s*reminder\.userId\s*\}\s*\}/,
  );
});

test("agent-authored comment reactions skip the human notification path", () => {
  const source = require("node:fs").readFileSync(
    path.join(root, "src/pages/api/comments/addReaction.ts"),
    "utf8",
  );
  const guardIndex = source.indexOf(
    'if (typeof recipientUserId !== "number") return',
  );
  const deviceLookupIndex = source.indexOf(
    "prisma.subscribedDevices.findMany",
    guardIndex,
  );

  assert.notEqual(guardIndex, -1);
  assert.ok(deviceLookupIndex > guardIndex);
  assert.doesNotMatch(
    source.slice(guardIndex),
    /checkReminderAndCreateNotification\(\s*reaction\.comment\.creatorId/,
  );
});
