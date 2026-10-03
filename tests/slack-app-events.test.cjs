const test = require("node:test");
const assert = require("node:assert/strict");
const { actor, loadTs } = require("./slack-app-fixtures.cjs");

function fixture(enabled) {
  const work = [], dispatched = [], receipts = new Set(), watched = [];
  const { POST } = loadTs("src/app/api/slack/events/route.ts", {
    "@vercel/functions": { waitUntil: (promise) => work.push(promise) },
    "@/lib/slack/signature": { verifySlackSignature: () => true },
    "@/lib/slack/feature": { isSlackAppEnabled: async () => enabled },
    "@/lib/slack/taskCreate": { createSlackTaskFromThread: async (input) => dispatched.push({ action: "create", input }) },
    "@/lib/slack/chat": { handleSlackChat: async (input) => dispatched.push({ action: "chat", input }), postSlackAssistantWelcome: async (input) => dispatched.push({ action: "welcome", input }) },
    "@/lib/slack/assistant": { saveSlackAssistantContext: async (...input) => dispatched.push({ action: "context", input }) },
    "@/lib/slack/taskCreateIntent": {
      hasSlackCreateTaskIntent: (text) => /create a task/.test(text),
      claimSlackEventOnce: async (_db, id) => { if (receipts.has(id)) return false; receipts.add(id); return true; },
    },
    "@/lib/slack/uninstall": {},
    "@/lib/prisma": { __esModule: true, default: {
      slackInstall: { findUnique: async () => ({ id: actor.installId, teamId: actor.teamId }) },
      slackWatchedThread: { findUnique: async () => null, upsert: async (input) => watched.push(input) },
      task: { findMany: async ({ where }) => { assert.equal(where.project.teamId, actor.teamId); return [{ id: 10, project: { teamId: actor.teamId } }, { id: 11, project: { teamId: "FOREIGN" } }]; } },
    } },
  });
  async function send(event, eventId = "Ev1") {
    const response = await POST(new Request("https://app.hypertask.ai/api/slack/events", { method: "POST", body: JSON.stringify({ type: "event_callback", event_id: eventId, team_id: "T1", event }) }));
    assert.equal(response.status, 200);
    await Promise.all(work.splice(0));
    return response;
  }
  return { send, dispatched, watched, receipts };
}

for (const enabled of [false, true]) {
  test(`signed event dispatch and retry handling with flag ${enabled ? "on" : "off"}`, async () => {
    const instance = fixture(enabled);
    const mention = { type: "app_mention", channel: "C1", user: "U1", ts: "1.0", text: "<@BOT> create a task Fix login in Web" };
    await instance.send(mention);
    await instance.send(mention);
    assert.equal(instance.dispatched.length, 1);
    assert.equal(instance.dispatched[0].action, enabled ? "chat" : "create");
    assert.equal(instance.dispatched[0].input.slackUserId, "U1");
    await instance.send({ ...mention, text: "show projects" }, "Ev2");
    assert.equal(instance.dispatched[1].action, "chat");
    await instance.send({ type: "assistant_thread_started", assistant_thread: { channel_id: "D1", thread_ts: "1.0", user_id: "U1", context: { team_id: "T1", channel_id: "C1" } } }, "Ev3");
    assert.equal(instance.dispatched[2].action, "welcome");
    assert.equal(Boolean(instance.dispatched[2].input.assistantThread), enabled);
    const changed = { type: "assistant_thread_context_changed", assistant_thread: { channel_id: "D1", thread_ts: "1.0", user_id: "U1", context: { team_id: "T1", channel_id: "C2" } } };
    await instance.send(changed, "Ev4");
    await instance.send(changed, "Ev4");
    assert.equal(instance.dispatched.filter((item) => item.action === "context").length, enabled ? 1 : 0);
    await instance.send({ type: "message", channel_type: "im", channel: "D1", user: "U1", ts: "2.0", thread_ts: "1.0", text: "move it" }, "Ev5");
    assert.equal(instance.dispatched.at(-1).action, "chat");
    assert.equal(instance.dispatched.at(-1).input.threadTs, "1.0");
  });

  test(`ambient channel watching stays team-scoped with flag ${enabled ? "on" : "off"}`, async () => {
    const instance = fixture(enabled);
    await instance.send({ type: "message", channel_type: "channel", channel: "C1", user: "U1", ts: "1.0", text: "See HTPR-10" });
    assert.equal(instance.dispatched.length, 0);
    assert.equal(instance.watched.length, 1);
    assert.deepEqual(instance.watched[0].create.matchedTaskIds, [10]);
    assert.equal(instance.watched[0].create.installId, actor.installId);
  });
}
