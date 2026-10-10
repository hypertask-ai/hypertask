const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
let loads = 0;
const FLAG = "htpr-7095-reaction-webhook";

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function load(state) {
  const persisted = [];
  const published = [];
  stubModule("src/lib/prisma.ts", {
    default: {
      comment: { findUnique: async () => state.comment },
      $transaction: async (fn) => fn({}),
    },
  });
  stubModule("src/lib/flags.ts", {
    isFeatureEnabled: async (key, userId) => {
      state.flagCalls.push([key, userId]);
      return state.flagOn;
    },
  });
  stubModule("src/lib/agentWebhooks/outbox.ts", {
    resolveAgentWebhookActor: async (_tx, input) => ({ userId: input.userId, agentId: null, displayName: "Valentin Yeo" }),
    persistAgentWebhookEvents: async (_tx, input) => {
      persisted.push(input);
      return ["delivery-1"];
    },
    publishAgentWebhookDeliveries: async (ids) => published.push(ids),
  });
  delete require.cache[path.join(root, "src/lib/agentWebhooks/commentReaction.ts")];
  const jiti = createJiti(path.join(root, `tests/htpr-7095-loader-${++loads}.cjs`), {
    alias: { "@": path.join(root, "src") },
    interopDefault: true,
  });
  return { mod: jiti(path.join(root, "src/lib/agentWebhooks/commentReaction.ts")), persisted, published };
}

function freshState(overrides = {}) {
  return {
    flagOn: true,
    flagCalls: [],
    comment: {
      id: 55,
      text: "<p>Ready to <strong>start</strong>. Shall I go ahead?</p>",
      agentId: "agent-1",
      task: { id: 9, projectId: 15, ticketNumber: "HTPR-7095", title: "Agents hear emoji" },
    },
    ...overrides,
  };
}

test("comment.reaction is a registered, subscribable event", () => {
  const events = createJiti(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false })(
    path.join(root, "src/lib/agentWebhooks/events.ts"),
  );
  assert.ok(events.AGENT_WEBHOOK_EVENTS.includes("comment.reaction"));
  assert.equal(events.AGENT_WEBHOOK_EVENT_DEFINITIONS["comment.reaction"].subscribable, true);
  assert.ok(events.availableAgentWebhookEvents(false).includes("comment.reaction"));
  assert.deepEqual(events.parseAgentWebhookEvents(["comment.reaction"]), { ok: true, events: ["comment.reaction"] });
  assert.deepEqual(
    Object.keys(events.AGENT_WEBHOOK_EVENT_DEFINITIONS["comment.reaction"].payload),
    ["commentId", "emoji", "commentExcerpt"],
  );
});

test("payload builder carries the common fields, emoji and a bounded plain excerpt", () => {
  const { mod } = load(freshState());
  const long = `<p>${"word ".repeat(100)}</p>`;
  const event = mod.buildCommentReactionEvent({
    task: { id: 9, projectId: 15, ticketNumber: "HTPR-7095", title: "T" },
    actor: { userId: 6, agentId: null, displayName: "Valentin Yeo" },
    commentId: 55,
    commentText: long,
    emoji: "\u{1F44D}",
  });
  assert.equal(event.event, "comment.reaction");
  assert.equal(event.projectId, 15);
  assert.equal(event.taskId, 9);
  assert.equal(event.ticketNumber, "HTPR-7095");
  assert.equal(event.taskTitle, "T");
  assert.equal(event.actor.userId, 6);
  assert.equal(event.commentId, 55);
  assert.equal(event.emoji, "\u{1F44D}");
  assert.ok(event.commentExcerpt.length <= 200);
  assert.ok(!/[<>]/.test(event.commentExcerpt));
  assert.equal(mod.commentExcerpt("<p>Hi &amp; bye</p>"), "Hi & bye");
});

test("only an added reaction by a person on an agent comment has a target", () => {
  const { mod } = load(freshState());
  assert.equal(mod.reactionWebhookTarget({ added: true, reactorIsAgent: false, commentAgentId: "a1" }), "a1");
  assert.equal(mod.reactionWebhookTarget({ added: false, reactorIsAgent: false, commentAgentId: "a1" }), null);
  assert.equal(mod.reactionWebhookTarget({ added: true, reactorIsAgent: true, commentAgentId: "a1" }), null);
  assert.equal(mod.reactionWebhookTarget({ added: true, reactorIsAgent: false, commentAgentId: null }), null);
});

// Same order as both reaction routes: prepare before the transaction, persist inside it.
async function deliver(mod, input) {
  const prepared = await mod.prepareCommentReactionWebhook(input);
  return prepared ? mod.persistCommentReactionWebhook({}, prepared, input) : [];
}

test("a person's added reaction is delivered only to the comment's agent", async () => {
  const state = freshState();
  const { mod, persisted } = load(state);
  const ids = await deliver(mod, { commentId: 55, reactorUserId: 6, reactorIsAgent: false, emoji: "\u{1F44D}", added: true });
  assert.equal(persisted.length, 1);
  assert.deepEqual(persisted[0].agentIds, ["agent-1"]);
  assert.equal(persisted[0].broadcast, false);
  assert.equal(persisted[0].event, "comment.reaction");
  assert.equal(persisted[0].commentExcerpt, "Ready to start. Shall I go ahead?");
  assert.deepEqual(ids, ["delivery-1"]);
  assert.deepEqual(state.flagCalls, [[FLAG, 6]]);
});

test("removing a reaction, an agent reacting, or a human comment fires nothing", async () => {
  for (const [name, overrides, added] of [
    ["removed", {}, false],
    ["human comment", { comment: { id: 55, text: "x", agentId: null, task: { id: 9, projectId: 15, ticketNumber: null, title: "T" } } }, true],
  ]) {
    const { mod, persisted } = load(freshState(overrides));
    await deliver(mod, { commentId: 55, reactorUserId: 6, reactorIsAgent: false, emoji: "\u{1F44D}", added });
    assert.equal(persisted.length, 0, name);
  }
});

test("an agent owner reacting as a person fires; an agent call does not", async () => {
  const person = load(freshState());
  await deliver(person.mod, { commentId: 55, reactorUserId: 6, reactorIsAgent: false, emoji: "\u{1F44D}", added: true });
  assert.equal(person.persisted.length, 1);
  const agent = load(freshState());
  await deliver(agent.mod, { commentId: 55, reactorUserId: 6, reactorIsAgent: true, emoji: "\u{1F44D}", added: true });
  assert.equal(agent.persisted.length, 0);
});

test("flag OFF for the reacting user fires nothing", async () => {
  const { mod, persisted } = load(freshState({ flagOn: false }));
  await deliver(mod, { commentId: 55, reactorUserId: 6, reactorIsAgent: false, emoji: "\u{1F44D}", added: true });
  assert.equal(persisted.length, 0);
});

test("a comment that no longer exists fires nothing", async () => {
  const { mod, persisted } = load(freshState({ comment: null }));
  assert.deepEqual(await deliver(mod, { commentId: 55, reactorUserId: 6, reactorIsAgent: false, emoji: "\u{1F44D}", added: true }), []);
  assert.equal(persisted.length, 0);
});

test("both reaction routes write the outbox row in the reaction transaction, only for additions", () => {
  const fs = require("node:fs");
  const page = fs.readFileSync(path.join(root, "src/pages/api/comments/addReaction.ts"), "utf8");
  const mcp = fs.readFileSync(path.join(root, "src/app/api/mcp/comments/[comment_id]/reactions/route.ts"), "utf8");
  for (const [name, src] of [["web", page], ["mcp", mcp]]) {
    assert.equal((src.match(/persistCommentReactionWebhook\(tx,/g) || []).length, 1, name);
    assert.match(src, /publishAgentWebhookDeliveries\(deliveryIds\)/, name);
    assert.ok(!/emitCommentReactionWebhook/.test(src), name);
    assert.match(src, /= await prepareCommentReactionWebhook\(webhookInput\);/, name);
  }
  assert.match(page, /prisma\.\$transaction\(async \(tx\) => \{\s*const reaction = await tx\.reaction\.create/);
  assert.ok(!/added: false/.test(page));
  assert.match(page, /reactorIsAgent: false/);
  // MCP: only a reaction that was not active before, and an agent call never counts as a person.
  assert.match(mcp, /preparedWebhook && !wasActive && active\)/);
  assert.match(mcp, /setReaction\(target, userId, emoji, active, Boolean\(ctx\.agentId\)\)/);
});
