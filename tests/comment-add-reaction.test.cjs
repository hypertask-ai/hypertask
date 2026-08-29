// HTPR-5522: POST /api/comments/addReaction answered every bad input and every
// notification hiccup with a bare 500. These lock in the real status codes and
// that a stored reaction survives a failing notification.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function resetModules(relativePaths) {
  for (const relativePath of relativePaths) {
    delete require.cache[path.join(root, relativePath)];
  }
}

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/jiti-add-reaction-${++jitiEntryId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
      cache: false,
    },
  );
  const loaded = jiti(path.join(root, relativePath));
  // jiti only unwraps the default export when the module has no other bindings.
  return typeof loaded === "function" ? loaded : loaded.default;
}

const VALID = {
  userId: 6,
  taskId: 42,
  commentId: 7,
  unified: "1f44d",
  emoji: "👍",
  names: ["+1"],
};

function loadHandler({
  comment = { id: 7 },
  existing = [],
  notificationThrows = false,
} = {}) {
  const calls = { created: [], deleted: [], notifications: [], broadcast: [] };

  resetModules([
    "src/pages/api/comments/addReaction.ts",
    "src/lib/prisma.ts",
    "src/lib/realtime/server.ts",
    "src/utils/controllers/FCM/index.ts",
    "src/utils/controllers/notifications/creation-service/check-reminder_create-notification.ts",
  ]);

  stubModule("src/lib/prisma.ts", {
    default: {
      comment: { findFirst: async () => comment },
      subscribedDevices: { findMany: async () => [] },
      reaction: {
        findMany: async () => existing,
        create: async (args) => {
          calls.created.push(args.data);
          return {
            id: "reaction-1",
            ...args.data,
            user: { id: args.data.userId, displayName: "Valentin Yeo" },
            comment: {
              id: args.data.commentId,
              creatorId: 9,
              text: "<p>hi</p>",
              seen: [6],
            },
            task: { projectId: 15, uniqueIndex: 1270 },
          };
        },
        deleteMany: async (args) => {
          calls.deleted.push(args.where);
          return { count: existing.length };
        },
      },
    },
  });
  stubModule("src/lib/realtime/server.ts", {
    broadcastTaskComment: async (...args) => {
      calls.broadcast.push(args);
    },
  });
  stubModule("src/utils/controllers/FCM/index.ts", {
    sendDataNewCommentFCM: async () => {},
  });
  stubModule(
    "src/utils/controllers/notifications/creation-service/check-reminder_create-notification.ts",
    {
      default: async (...args) => {
        calls.notifications.push(args);
        if (notificationThrows) throw new Error("notification exploded");
        return null;
      },
    },
  );

  const handler = loadTs("src/pages/api/comments/addReaction.ts");
  return { handler, calls };
}

function response() {
  const captured = { status: null, body: undefined };
  const res = {
    status(code) {
      captured.status = code;
      return res;
    },
    json(payload) {
      captured.body = payload;
      return res;
    },
  };
  return { res, captured };
}

async function post(handler, body) {
  const { res, captured } = response();
  await handler({ method: "POST", body }, res);
  return captured;
}

test("creates a reaction and returns it", async () => {
  const { handler, calls } = loadHandler();
  const result = await post(handler, VALID);
  assert.equal(result.status, 200);
  assert.equal(result.body.emoji, "👍");
  assert.equal(calls.created.length, 1);
  assert.equal(calls.broadcast.length, 1);
});

test("never leaks comment read receipts on the created reaction", async () => {
  const { handler } = loadHandler();
  const result = await post(handler, VALID);
  assert.equal("seen" in result.body.comment, false);
});

test("rejects a missing taskId with 400 instead of 500", async () => {
  const { handler, calls } = loadHandler();
  const result = await post(handler, { ...VALID, taskId: undefined });
  assert.equal(result.status, 400);
  assert.deepEqual(calls.created, []);
});

test("rejects an empty emoji with 400 instead of 500", async () => {
  const { handler, calls } = loadHandler();
  const result = await post(handler, { ...VALID, emoji: "" });
  assert.equal(result.status, 400);
  assert.deepEqual(calls.created, []);
});

test("rejects a non-numeric commentId with 400 instead of 500", async () => {
  const { handler, calls } = loadHandler();
  const result = await post(handler, { ...VALID, commentId: "seven" });
  assert.equal(result.status, 400);
  assert.deepEqual(calls.created, []);
});

test("answers 404 when the comment no longer exists on that task", async () => {
  const { handler, calls } = loadHandler({ comment: null });
  const result = await post(handler, VALID);
  assert.equal(result.status, 404);
  assert.deepEqual(calls.created, []);
});

test("keeps the reaction when the notification fails", async () => {
  const { handler, calls } = loadHandler({ notificationThrows: true });
  const result = await post(handler, VALID);
  assert.equal(result.status, 200);
  assert.equal(calls.created.length, 1);
  assert.equal(calls.notifications.length, 1);
});

test("toggles an existing reaction off with 202", async () => {
  const { handler, calls } = loadHandler({ existing: [{ id: "reaction-1" }] });
  const result = await post(handler, VALID);
  assert.equal(result.status, 202);
  assert.equal(result.body.count, 1);
  assert.deepEqual(calls.created, []);
  assert.equal(calls.deleted.length, 1);
});

test("defaults missing emoji names to an empty list", async () => {
  const { handler, calls } = loadHandler();
  await post(handler, { ...VALID, names: undefined });
  assert.deepEqual(calls.created[0].names, []);
});

test("rejects a non-POST method", async () => {
  const { handler } = loadHandler();
  const { res, captured } = response();
  await handler({ method: "GET", body: {} }, res);
  assert.equal(captured.status, 405);
});
