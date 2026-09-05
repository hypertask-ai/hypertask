const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});

const { persistAssistantMessage } = jiti(
  path.join(
    root,
    "src/app/api/ai/chat/stream/persistAssistantMessage.ts",
  ),
);
const { ensureNativeChatTurn, findNativeAssistantReplay } = jiti(
  path.join(
    root,
    "src/app/api/ai/chat/stream/ensureNativeChatTurn.ts",
  ),
);
const { acquireAiChatStreamLease, releaseAiChatStreamLease } = jiti(
  path.join(root, "src/app/api/ai/chat/stream/streamLease.ts"),
);

function persistenceDb({
  owned = true,
  agentId = null,
  createdCount = 1,
  existingRole = "assistant",
  existingContent = "Finished reply",
  updateError,
} = {}) {
  const calls = [];
  return {
    calls,
    db: {
      chatSession: {
        findFirst: async (args) => {
          calls.push(["session.findFirst", args]);
          return owned ? { id: args.where.id, agentId } : null;
        },
        update: async (args) => {
          calls.push(["session.update", args]);
          if (updateError) throw updateError;
          return { id: args.where.id };
        },
      },
      chatMessage: {
        createMany: async (args) => {
          calls.push(["message.createMany", args]);
          return { count: createdCount };
        },
        findFirst: async (args) => {
          calls.push(["message.findFirst", args]);
          return {
            id: args.where.id,
            role: existingRole,
            content: existingContent,
          };
        },
      },
    },
  };
}

test("completed assistant replies persist idempotently in an owned session", async () => {
  const { db, calls } = persistenceDb();
  const saved = await persistAssistantMessage({
    db,
    messageId: "message-id",
    sessionId: "session-id",
    userId: 6,
    content: "Finished reply",
    linkify: async (content) => `<p>${content}</p>`,
  });

  assert.equal(saved, true);
  assert.deepEqual(calls[0], [
    "session.findFirst",
    {
      where: { id: "session-id", userId: 6 },
      select: { id: true, agentId: true },
    },
  ]);
  assert.equal(calls[1][0], "message.createMany");
  assert.equal(calls[1][1].skipDuplicates, true);
  assert.deepEqual(calls[1][1].data, [
    {
      id: "message-id",
      sessionId: "session-id",
      content: "<p>Finished reply</p>",
      role: "assistant",
      isDelivered: true,
      authorAgentId: null,
    },
  ]);
  assert.equal(calls.at(-1)[0], "session.update");
  assert.equal(calls.at(-1)[1].data.title, undefined);
});

test("assistant persistence refuses a session owned by someone else", async () => {
  const { db, calls } = persistenceDb({ owned: false });
  const saved = await persistAssistantMessage({
    db,
    messageId: "message-id",
    sessionId: "session-id",
    userId: 6,
    content: "Finished reply",
    linkify: async (content) => content,
  });

  assert.equal(saved, false);
  assert.deepEqual(calls.map(([name]) => name), ["session.findFirst"]);
});

test("a metadata failure cannot trigger duplicate reply persistence", async () => {
  const { db, calls } = persistenceDb({
    updateError: new Error("metadata unavailable"),
  });
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const saved = await persistAssistantMessage({
      db,
      messageId: "message-id",
      sessionId: "session-id",
      userId: 6,
      content: "Already durable",
      linkify: async (content) => content,
    });

    assert.equal(saved, true);
    assert.deepEqual(calls.map(([name]) => name), [
      "session.findFirst",
      "message.createMany",
      "session.update",
    ]);
  } finally {
    console.error = originalConsoleError;
  }
});

test("duplicate IDs are accepted only for the same assistant completion", async () => {
  const matching = persistenceDb({ createdCount: 0 });
  assert.equal(
    await persistAssistantMessage({
      db: matching.db,
      messageId: "message-id",
      sessionId: "session-id",
      userId: 6,
      content: "Finished reply",
      linkify: async (content) => content,
    }),
    true,
  );

  const humanCollision = persistenceDb({
    createdCount: 0,
    existingRole: "human",
  });
  assert.equal(
    await persistAssistantMessage({
      db: humanCollision.db,
      messageId: "message-id",
      sessionId: "session-id",
      userId: 6,
      content: "Finished reply",
      linkify: async (content) => content,
    }),
    false,
  );
  assert.doesNotMatch(
    humanCollision.calls.map(([name]) => name).join(" "),
    /session\.update/,
  );
});

function nativeTurnDb({
  owned = true,
  createdCount = 1,
  existingRole = "human",
  existingContent = "Hello from Android",
} = {}) {
  const calls = [];
  return {
    calls,
    db: {
      chatSession: {
        createMany: async (args) => {
          calls.push(["session.createMany", args]);
          return { count: 1 };
        },
        findFirst: async (args) => {
          calls.push(["session.findFirst", args]);
          return owned ? { id: args.where.id } : null;
        },
        update: async (args) => {
          calls.push(["session.update", args]);
          return { id: args.where.id };
        },
      },
      chatMessage: {
        createMany: async (args) => {
          calls.push(["message.createMany", args]);
          return { count: createdCount };
        },
        findFirst: async (args) => {
          calls.push(["message.findFirst", args]);
          return {
            id: args.where.id,
            role: existingRole,
            content: existingContent,
          };
        },
      },
    },
  };
}

test("one native stream creates its owned session and human message idempotently", async () => {
  const { db, calls } = nativeTurnDb();
  const saved = await ensureNativeChatTurn({
    db,
    sessionId: "session-id",
    messageId: "message-id",
    userId: 6,
    content: "Hello from Android",
  });

  assert.equal(saved, "persisted");
  assert.deepEqual(calls.map(([name]) => name), [
    "session.createMany",
    "session.findFirst",
    "message.createMany",
    "session.update",
  ]);
  assert.deepEqual(calls[0][1], {
    data: [{ id: "session-id", userId: 6 }],
    skipDuplicates: true,
  });
  assert.deepEqual(calls[2][1].data, [
    {
      id: "message-id",
      sessionId: "session-id",
      content: "Hello from Android",
      role: "human",
      isDelivered: true,
      authorUserId: 6,
    },
  ]);
});

test("an identical retried native turn is accepted without duplicating its human message", async () => {
  const { db, calls } = nativeTurnDb({ createdCount: 0 });
  const saved = await ensureNativeChatTurn({
    db,
    sessionId: "session-id",
    messageId: "message-id",
    userId: 6,
    content: "Hello from Android",
  });

  assert.equal(saved, "persisted");
  assert.deepEqual(calls.map(([name]) => name), [
    "session.createMany",
    "session.findFirst",
    "message.createMany",
    "message.findFirst",
    "session.update",
  ]);
});

test("native persistence cannot claim another user's session or message ID", async () => {
  const foreignSession = nativeTurnDb({ owned: false });
  assert.equal(
    await ensureNativeChatTurn({
      db: foreignSession.db,
      sessionId: "session-id",
      messageId: "message-id",
      userId: 6,
      content: "Hello from Android",
    }),
    "conflict",
  );
  assert.deepEqual(foreignSession.calls.map(([name]) => name), [
    "session.createMany",
    "session.findFirst",
  ]);

  const assistantCollision = nativeTurnDb({
    createdCount: 0,
    existingRole: "assistant",
  });
  assert.equal(
    await ensureNativeChatTurn({
      db: assistantCollision.db,
      sessionId: "session-id",
      messageId: "message-id",
      userId: 6,
      content: "Hello from Android",
    }),
    "conflict",
  );
  assert.doesNotMatch(
    assistantCollision.calls.map(([name]) => name).join(" "),
    /session\.update/,
  );
});

test("completed native retries replay only the owned assistant message", async () => {
  const calls = [];
  const db = {
    chatMessage: {
      findUnique: async (args) => {
        calls.push(args);
        return {
          sessionId: "session-id",
          role: "assistant",
          content: "<p>Durable reply</p>",
          session: { userId: 6 },
        };
      },
    },
  };

  assert.deepEqual(
    await findNativeAssistantReplay({
      db,
      sessionId: "session-id",
      messageId: "assistant-id",
      userId: 6,
    }),
    { status: "completed", content: "<p>Durable reply</p>" },
  );
  assert.deepEqual(calls[0].where, { id: "assistant-id" });

  db.chatMessage.findUnique = async () => ({
    sessionId: "another-session",
    role: "assistant",
    content: "Private reply",
    session: { userId: 7 },
  });
  assert.deepEqual(
    await findNativeAssistantReplay({
      db,
      sessionId: "session-id",
      messageId: "assistant-id",
      userId: 6,
    }),
    { status: "conflict" },
  );

  db.chatMessage.findUnique = async () => null;
  assert.deepEqual(
    await findNativeAssistantReplay({
      db,
      sessionId: "session-id",
      messageId: "assistant-id",
      userId: 6,
    }),
    { status: "missing" },
  );
});

function streamRedis({ count = 1, acquired = "OK" } = {}) {
  const calls = [];
  return {
    calls,
    redis: {
      eval: async (...args) => {
        calls.push(["eval", args]);
        return args[0].includes("INCR") ? count : 1;
      },
      set: async (...args) => {
        calls.push(["set", args]);
        return acquired;
      },
    },
  };
}

test("one per-user stream lease bounds detached generation", async () => {
  const { redis, calls } = streamRedis();
  const lease = await acquireAiChatStreamLease(6, undefined, async () => redis);

  assert.equal(typeof lease, "object");
  assert.equal(lease.key, "ai-chat:stream-active:user:6");
  assert.equal(calls[0][0], "eval");
  assert.equal(calls[1][0], "set");
  assert.deepEqual(calls[1][1].slice(2), ["EX", 330, "NX"]);

  await releaseAiChatStreamLease(lease);
  assert.match(calls.at(-1)[1][0], /redis\.call\("del"/);
});

test("the stream guard rejects concurrent and excessive starts", async () => {
  const concurrent = streamRedis({ acquired: null });
  assert.equal(
    await acquireAiChatStreamLease(6, undefined, async () => concurrent.redis),
    "busy",
  );

  const excessive = streamRedis({ count: 13 });
  assert.equal(
    await acquireAiChatStreamLease(6, undefined, async () => excessive.redis),
    "limited",
  );
  assert.deepEqual(excessive.calls.map(([name]) => name), ["eval"]);
});

test("the stream and client use rollout-safe background persistence", () => {
  const route = fs.readFileSync(
    path.join(root, "src/app/api/ai/chat/stream/route.ts"),
    "utf8",
  );
  const client = fs.readFileSync(
    path.join(root, "src/hooks/MultiPages/AIChat/useAiChat.ts"),
    "utf8",
  );
  const cancelRoute = fs.readFileSync(
    path.join(root, "src/app/api/ai/chat/cancel/route.ts"),
    "utf8",
  );
  const heartbeat = fs.readFileSync(
    path.join(root, "src/app/api/cron/native-agent-heartbeat/route.ts"),
    "utf8",
  );
  const history = fs.readFileSync(
    path.join(
      root,
      "src/hooks/MultiPages/AIChat/useSessionAndChatHistory.ts",
    ),
    "utf8",
  );

  assert.match(route, /session_id: z\.string\(\)\.uuid\(\)\.optional\(\)/);
  assert.match(route, /assistant_message_id: z\.string\(\)\.uuid\(\)\.optional\(\)/);
  assert.match(route, /stream_id: z\.string\(\)\.uuid\(\)\.optional\(\)/);
  assert.match(route, /const streamId = body\.stream_id \?\? randomUUID\(\)/);
  assert.match(route, /acquireAiChatStreamLease\([\s\S]*sessionId: body\.session_id, streamId/);
  assert.match(
    route,
    /if \(cancelled\) \{[\s\S]*failHeartbeatExecution\([\s\S]*"AI reply cancelled"[\s\S]*heartbeatExecutionTerminal = true/,
  );
  assert.match(cancelRoute, /stream_id: z\.string\(\)\.uuid\(\),/);
  assert.doesNotMatch(cancelRoute, /stream_id:[^\n]+optional/);
  assert.match(heartbeat, /stream_id: execution\.executionId/);
  assert.match(route, /user_message_id: z\.string\(\)\.uuid\(\)\.optional\(\)/);
  assert.match(route, /ensureNativeChatTurn\(\{/);
  assert.match(route, /nativeTurnPersistence === "conflict"/);
  assert.match(route, /Start a new chat and try again/);
  assert.match(route, /findNativeAssistantReplay\(\{/);
  assert.match(route, /replay\.status === "completed"/);
  assert.match(route, /replayed: true/);
  assert.match(route, /native-replay-check/);
  assert.match(route, /cancel\(\) \{[\s\S]*clientConnected = false;/);
  assert.match(route, /releaseAiChatStreamLease\(streamLease\)/);
  assert.match(route, /assistant_persisted: assistantPersisted/);
  assert.match(route, /user_message_persisted: userMessagePersisted/);
  const completionBlock = route.slice(route.lastIndexOf("let assistantPersisted"));
  assert.ok(
    completionBlock.indexOf("persistAssistantMessage") <
      completionBlock.indexOf("generateConversationTitle"),
    "the completed reply must persist before title enrichment begins",
  );
  assert.match(client, /assistant_message_id: assistantMessageId/);
  assert.match(client, /stream_id: streamId/);
  assert.match(client, /parsed\.assistant_persisted === true/);
  assert.match(
    client,
    /assistantPlaceholderAdded[\s\S]*updateLastMessageInSessionCache\(session\.id, errorMessage\)[\s\S]*appendMessageToSessionCache\(session\.id, errorMessage\)/,
  );
  assert.match(
    history,
    /const updateLastMessageInSessionCache[\s\S]*addMessageToSessionQuery\(sessionId, message, true, true\)/,
  );
  assert.match(
    history,
    /const appendMessageToSessionCache[\s\S]*addMessageToSessionQuery\(sessionId, message, true, false\)/,
  );
  assert.doesNotMatch(client, /addEventListener\("beforeunload", handleBeforeUnload\)/);
});

test("a native agent's reply is stored as that agent's message", async () => {
  const { db, calls } = persistenceDb({ agentId: "agent-1" });
  const saved = await persistAssistantMessage({
    db,
    messageId: "message-id",
    sessionId: "session-id",
    userId: 6,
    content: "Finished reply",
    linkify: async (content) => content,
  });

  assert.equal(saved, true);
  const created = calls.find(([name]) => name === "message.createMany")[1];
  assert.equal(
    created.data[0].authorAgentId,
    "agent-1",
    "a reader must be able to tell which agent wrote a reply, not just that a machine did",
  );
});
