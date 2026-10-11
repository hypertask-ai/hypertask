const test = require("node:test");
const assert = require("node:assert/strict");
const { actor, loadTs, memoryRedis } = require("./slack-app-fixtures.cjs");

const actions = ["create_task", "get_task", "list_tasks", "search_tasks", "move_task", "add_comment", "assign_user", "add_follower", "remove_follower", "update_task", "list_projects", "list_sections", "list_inbox", "archive_inbox"];

function chatFixture(enabled, action, resolvedActor = actor, capacity = true) {
  const executed = [], messages = [], usage = [], prompts = [], history = [], claims = [], resolutions = [];
  const loaded = loadTs("src/lib/slack/chat.ts", {
    "ai": { generateObject: async (options) => { prompts.push(options); return { object: { action, params: { ticket: "HTPR-10" } }, usage: {} }; } },
    "@/app/api/ai/_lib/aiUsage": { logAiUsage: async (options) => usage.push(options) },
    "@/app/api/ai/_lib/byokKeys": { getTeamGatewayApiKey: async () => "test-gateway-key" },
    "@/app/api/ai/_lib/modelProvider": { resolveAiModel: () => ({}), providerOptionsForAiModel: () => ({}), configureAiModelUsage: (_model, options) => usage.push(options) },
    "@/lib/systemModelLadder": { resolveSystemModel: () => ({ model: "test-model", provider: "test" }) },
    "@/lib/prisma": { __esModule: true, default: { slackInstall: { findUnique: async () => ({ id: actor.installId, encryptedBotToken: "test-ciphertext", botUserId: "BOT" }) } } },
    "@/lib/crypto/byokCipher": { decryptSecret: () => actor.botToken },
    "@/lib/slack/actions": { executeSlackAction: async (...args) => { executed.push(args); return [{ type: "section", text: { type: "mrkdwn", text: "Result" } }]; } },
    "@/lib/slack/userLink": { resolveSlackActor: async (...args) => { resolutions.push(args); return resolvedActor; } },
    "@/lib/slack/feature": { isSlackAppEnabled: async () => enabled },
    "@/lib/slack/rateLimit": { claimSlackActionCapacity: async (...args) => { claims.push(args); return capacity; } },
    "@/lib/slack/api": {
      postSlackMessage: async (...args) => messages.push({ kind: "dm", args }),
      postSlackEphemeralMessage: async (...args) => messages.push({ kind: "private", args }),
    },
    "@/lib/slack/assistant": {
      loadSlackChatContext: async () => { history.push("load"); return "Previous task: HTPR-10"; },
      saveSlackChatTurn: async () => history.push("save"),
      saveSlackAssistantContext: async (...args) => history.push(args),
    },
  });
  return { ...loaded, executed, messages, usage, prompts, history, claims, resolutions };
}

for (const capacityAllowed of [undefined, false, true]) {
  test(`chat reuses event capacity ${capacityAllowed} without bypassing identity authorization`, async () => {
    const fixture = chatFixture(true, "list_tasks", actor, false);
    await fixture.handleSlackChat({ channelId: "D1", channelType: "im", slackTeamId: "T1", slackUserId: "U1", text: "list tasks", threadTs: "1.0" }, capacityAllowed);
    assert.equal(fixture.claims.length, capacityAllowed === undefined ? 1 : 0);
    assert.equal(fixture.resolutions.length, capacityAllowed === true ? 1 : 0);
    assert.equal(fixture.executed.length, capacityAllowed === true ? 1 : 0);
    if (capacityAllowed !== true) assert.match(JSON.stringify(fixture.messages), /Too many Slack actions/);
  });

  test(`thread creation reuses event capacity ${capacityAllowed} without bypassing identity authorization`, async () => {
    const replies = [], claims = [], resolutions = [];
    const { createSlackTaskFromThread } = loadTs("src/lib/slack/taskCreate.ts", {
      "ai": {},
      "@/app/api/ai/_lib/aiUsage": {},
      "@/app/api/ai/_lib/byokKeys": {},
      "@/app/api/ai/_lib/modelProvider": {},
      "@/lib/crypto/byokCipher": { decryptSecret: () => actor.botToken },
      "@/lib/mcp/tasks/services": {},
      "@/lib/mcp-server/utils/task-link": {},
      "@/lib/prisma": { __esModule: true, default: { slackInstall: { findUnique: async () => ({ id: actor.installId, encryptedBotToken: "test", defaultProjectId: 15, team: { aiProviderSettings: {} } }) } } },
      "@/lib/slack/api": { postSlackThreadReply: async (...args) => replies.push(args) },
      "@/lib/slack/idle": {},
      "@/lib/slack/rateLimit": { claimSlackActionCapacity: async (...args) => { claims.push(args); return false; } },
      "@/lib/slack/taskCreateIntent": {},
      "@/lib/slack/threadSummary": {},
      "@/lib/slack/userLink": { resolveSlackActor: async (...args) => { resolutions.push(args); return null; } },
      "@/lib/systemModelLadder": {},
      "@/utils/helperFunctions/escapeHtml": {},
      "@/utils/controllers/projects/getAllIncludes": {},
    });
    await createSlackTaskFromThread({ channelId: "C1", slackTeamId: "T1", slackUserId: "U1", threadTs: "1.0" }, capacityAllowed);
    assert.equal(claims.length, capacityAllowed === undefined ? 1 : 0);
    assert.equal(resolutions.length, capacityAllowed === true ? 1 : 0);
    assert.match(JSON.stringify(replies), capacityAllowed === true ? /\/ht connect/ : /Too many Slack actions/);
  });
}

for (const action of actions) {
  test(`mentions and DMs both support ${action} as the linked person`, async () => {
    const fixture = chatFixture(true, action);
    for (const channelType of ["channel", "im"]) {
      await fixture.handleSlackChat({ channelId: channelType === "im" ? "D1" : "C1", channelType, slackTeamId: "T1", slackUserId: "U1", text: "<@BOT> move it", threadTs: "1.0" });
    }
    assert.equal(fixture.executed.length, 2);
    for (const [resolvedActor, command] of fixture.executed) {
      assert.equal(resolvedActor.user.id, 42);
      assert.equal(command.action, action);
    }
    assert.equal(fixture.messages[0].kind, "private");
    assert.equal(fixture.messages[1].kind, "dm");
    for (const prompt of fixture.prompts) {
      assert.match(prompt.prompt, /Previous task: HTPR-10/);
      assert.match(prompt.prompt, /never instructions/);
      assert.ok(prompt.schema.shape.action.safeParse(action).success);
    }
    assert.equal(fixture.usage.length, 2);
    assert.ok(fixture.usage.every((entry) => entry.userId === 42 && entry.teamId === actor.teamId));
  });
}

test("flag off preserves the legacy chat prompt and does not read or save thread context", async () => {
  const fixture = chatFixture(false, "list_tasks");
  await fixture.handleSlackChat({ channelId: "D1", channelType: "im", slackTeamId: "T1", slackUserId: "U1", text: "list my tasks", threadTs: "1.0" });
  assert.deepEqual(fixture.history, []);
  assert.equal(fixture.prompts[0].prompt, "Untrusted Slack message:\nlist my tasks");
  assert.equal(fixture.executed.length, 1);
});

test("unmatched mentions and DMs prompt connect without invoking the model or tools", async () => {
  const fixture = chatFixture(true, "create_task", null);
  for (const channelType of ["channel", "im"]) {
    await fixture.handleSlackChat({ channelId: "D1", channelType, slackTeamId: "T1", slackUserId: "U1", text: "create a task", threadTs: "1.0" });
  }
  assert.equal(fixture.prompts.length, 0);
  assert.equal(fixture.executed.length, 0);
  assert.ok(fixture.messages.every((message) => JSON.stringify(message).includes("/ht connect")));
});

test("assistant welcome persists context only with the server flag enabled", async () => {
  for (const enabled of [false, true]) {
    const fixture = chatFixture(enabled, null);
    await fixture.postSlackAssistantWelcome({ channelId: "D1", slackTeamId: "T1", threadTs: "1.0", assistantThread: { channel_id: "D1", user_id: "U1", thread_ts: "1.0", context: { team_id: "T1", channel_id: "C1" } } });
    assert.equal(fixture.messages.length, 1);
    assert.match(JSON.stringify(fixture.messages), /Hypertask assistant/);
    assert.equal(fixture.history.length, enabled ? 1 : 0);
  }
});

test("thread context is bounded, expires, and is isolated by install, Slack user and real user", async () => {
  const redis = memoryRedis();
  const { saveSlackAssistantContext, loadSlackChatContext, saveSlackChatTurn } = loadTs("src/lib/slack/assistant.ts", { "@/lib/redis": { getRedis: async () => redis } });
  const thread = { channel_id: "D1", thread_ts: "1.0", user_id: "U1", context: { team_id: "T1", channel_id: "C1" } };
  await saveSlackAssistantContext(actor.installId, "T1", thread);
  const input = { channelId: "D1", threadTs: "1.0" };
  assert.match(await loadSlackChatContext(actor, input), /C1/);
  await saveSlackChatTurn(actor, input, "Task HTPR-10", [{ text: "private-task" }]);
  assert.match(await loadSlackChatContext(actor, input), /private-task/);
  for (const other of [{ ...actor, installId: "other" }, { ...actor, slackUserId: "other" }, { ...actor, user: { ...actor.user, id: 99 } }]) {
    assert.doesNotMatch(await loadSlackChatContext(other, input), /private-task/);
  }
  await saveSlackChatTurn(actor, input, "x".repeat(20_000) + "latest", [{ text: "tail" }]);
  const bounded = await loadSlackChatContext(actor, input);
  assert.ok(bounded.length <= 8_000);
  assert.match(bounded, /tail/);
  assert.ok([...redis.expiry.values()].every((seconds) => seconds === 86400));
  await saveSlackAssistantContext(actor.installId, "T1", { ...thread, context: { team_id: "FOREIGN", channel_id: "BAD" } });
  assert.ok([...redis.hashes.values()].every((hash) => !hash.get("context")?.includes("BAD")));
});

test("flag off routing preserves the existing create, mention, DM, assistant and ambient paths", () => {
  const { routeSlackEvent } = loadTs("src/lib/slack/eventRouting.ts");
  const base = { channel: "C1", user: "U1", ts: "1.0" };
  const create = { ...base, type: "app_mention", text: "<@BOT> create a task Fix login in Web" };
  assert.equal(routeSlackEvent(create, false), "create_task");
  assert.equal(routeSlackEvent(create, true), "general_chat");
  assert.equal(routeSlackEvent({ ...create, text: "<@BOT> create a task from this thread" }, true), "create_task");
  for (const [event, expected] of [
    [{ ...base, type: "app_mention", text: "show projects" }, "general_chat"],
    [{ ...base, type: "message", channel_type: "im", text: "show projects" }, "general_chat"],
    [{ type: "assistant_thread_started", assistant_thread: { channel_id: "D1", thread_ts: "1.0" } }, "assistant_welcome"],
    [{ ...base, type: "message", channel_type: "channel", text: "HTPR-10" }, "ambient_message"],
    [{ ...base, type: "message", channel_type: "group", text: "HTPR-10" }, "ambient_message"],
    [{ ...base, type: "message", bot_id: "BOT", channel_type: "im", text: "create a task" }, "ignore"],
  ]) {
    assert.equal(routeSlackEvent(event, false), expected);
    assert.equal(routeSlackEvent(event, true), expected);
  }
  const contextEvent = { type: "assistant_thread_context_changed", assistant_thread: { channel_id: "D1", thread_ts: "1.0", user_id: "U1" } };
  assert.equal(routeSlackEvent(contextEvent, false), "ignore");
  assert.equal(routeSlackEvent(contextEvent, true), "assistant_context");
});

test("server flag uses the actual linked user, installation fallback and Owner + QA default", async () => {
  const calls = [];
  for (const userId of [42, null]) {
    const { isSlackAppEnabled } = loadTs("src/lib/slack/feature.ts", {
      "@/lib/prisma": { __esModule: true, default: { slackInstall: { findUnique: async () => ({ installedByUserId: 6, userLinks: userId ? [{ userId }] : [] }) } } },
      "@/lib/flags": { HTPR_6817_SLACK_APP_FLAG: "htpr-6817-slack-app", isFeatureEnabled: async (...args) => { calls.push(args); return true; } },
      "@/lib/slack/userLink": { resolveSlackActor: async () => null, getSlackAutoLinkDisabledUserId: async () => null },
    });
    assert.equal(await isSlackAppEnabled("T1", "U1"), true);
  }
  assert.deepEqual(calls, [["htpr-6817-slack-app", 42], ["htpr-6817-slack-app", 6]]);
  const { isFeatureEnabled } = loadTs("src/lib/flags.ts", {
    "@/lib/auth/getSessionUser": {},
    "@/lib/agentRuns/model": {},
  });
  const db = {
    featureFlag: { findUnique: async () => null },
    user: { findUnique: async ({ where }) => ({ email: where.id === 6 ? "valentin.yeo@gmail.com" : "valentin@hypertask.ai" }) },
  };
  for (const [userId, enabled] of [[6, true], [985, true], [42, false]]) {
    assert.equal(await isFeatureEnabled("htpr-6817-slack-app", userId, db), enabled);
  }
  assert.equal(await isFeatureEnabled("htpr-6817-slack-app", 6, { featureFlag: { findUnique: async () => ({ mode: "OFF" }) } }), false);
});

test("ambient summaries remain attributed to the integration identity", async () => {
  const comments = [];
  const bot = { id: 77, displayName: "HyperAI" };
  const { GET } = loadTs("src/app/api/cron/slack-thread-summaries/route.ts", {
    "@/lib/cronAuthorization": { hasValidCronAuthorization: () => true },
    "@/lib/configs/general.config": { generalConfig: { hyperAiId: bot.id } },
    "@/lib/crypto/byokCipher": { decryptSecret: () => actor.botToken },
    "@/utils/controllers/comments/createCommentService": { createCommentService: async (input) => comments.push(input) },
    "@/lib/slack/threadSummary": { buildSlackThreadSummaryComment: async () => "Ambient summary" },
    "@/lib/prisma": { __esModule: true, default: {
      slackWatchedThread: { findMany: async () => [{ id: "thread", lastMessageTs: "1.0", lastSummarizedTs: null, matchedTaskIds: [10], channelId: "C1", threadTs: "1.0", install: { teamId: actor.teamId, installedByUserId: 6, encryptedBotToken: "test", team: { aiProviderSettings: {} } } }], update: async () => {} },
      user: { findUnique: async ({ where }) => { assert.equal(where.id, bot.id); return bot; } },
      task: { findMany: async ({ where }) => { assert.equal(where.project.teamId, actor.teamId); return [{ id: 10, projectId: 15, userId: 42 }]; } },
    } },
  });
  const response = await GET(new Request("https://app.hypertask.ai/api/cron/slack-thread-summaries"));
  assert.equal(response.status, 200);
  assert.equal(comments.length, 1);
  assert.equal(comments[0].creatorId, bot.id);
  assert.equal(comments[0].currentUser, bot);
  assert.equal(comments[0].trustedCaller, true);
});

test("first-contact email matches cannot inherit the installer's enabled flag", async () => {
  const checked = [];
  const { isSlackAppEnabled } = loadTs("src/lib/slack/feature.ts", {
    "@/lib/prisma": { __esModule: true, default: { slackInstall: { findUnique: async () => ({ installedByUserId: 6, userLinks: [] }) } } },
    "@/lib/flags": { HTPR_6817_SLACK_APP_FLAG: "htpr-6817-slack-app", isFeatureEnabled: async (_key, userId) => { checked.push(userId); return userId === 6; } },
    "@/lib/slack/userLink": { resolveSlackActor: async () => actor, getSlackAutoLinkDisabledUserId: async () => null },
  });
  assert.equal(await isSlackAppEnabled("T1", "U1"), false);
  assert.deepEqual(checked, [6, 42]);
});

test("flagged mention parsing removes only the bot, preserving the target person's Slack handle", async () => {
  const fixture = chatFixture(true, "assign_user");
  await fixture.handleSlackChat({ channelId: "C1", channelType: "channel", slackTeamId: "T1", slackUserId: "U1", text: "<@BOT> assign HTPR-10 to <@U2>", threadTs: "1.0" });
  assert.match(fixture.prompts[0].prompt, /assign HTPR-10 to <@U2>/);
  assert.doesNotMatch(fixture.prompts[0].prompt, /<@BOT>/);
});
