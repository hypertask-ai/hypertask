import assert from "node:assert/strict";
import test from "node:test";
import { activationHarness } from "./helpers/activation-harness";

process.env.POSTHOG_SERVER_PROJECT_TOKEN = "mock-local-only";

function harness() {
  const h = activationHarness();
  h.setFlagEnabled("htpr-7271-saved-work-events", true);
  h.prisma.project_View = { upsert: async () => ({ default_view_id: 1 }) };
  h.projects.get(15).seeded = false;
  return h;
}

function taskEvents(h: ReturnType<typeof activationHarness>) {
  h.mocks["@/lib/mcp/webhooks/outbox"] = { persistBoardWebhookEvent: async () => [] };
  return h.load("src/lib/mcp/webhooks/taskEvents.ts");
}

function saveTask(h: ReturnType<typeof activationHarness>, id: number, actor: Record<string, unknown>, channel: string, analyticsAgentId?: string) {
  h.tasks.set(id, { id, projectId: 15, createdAt: new Date("2026-10-16T12:00:00Z") });
  return taskEvents(h).createTaskWithBoardWebhookOutbox(h.prisma, actor, async () => ({
    taskId: id, firstTaskPointerTaskId: h.projects.get(15).firstTaskPointerTaskId, result: { id }, webhookTask: { id, projectId: 15, sectionId: 1, section: "Doing", status: "Normal" },
  }), channel, analyticsAgentId);
}

const common = {
  user_id: "123", workspace_id: "team", board_id: "15", source: "server",
  utm_source: null, utm_medium: null, utm_campaign: null, initial_referrer: null, attribution_status: "unknown",
};

test("manual board sends board_created with the new contract once per board", async () => {
  const h = harness();
  const create = h.load("src/utils/controllers/projects/create.ts").default;
  const result = await create(123, "Board", "team", "account", "BOARD");
  assert.equal(result.status, 200);
  await h.drain();
  assert.equal(h.captures.length, 1);
  const [{ distinctId, event, properties }] = h.captures;
  const boardId = String(result.json.id ?? [...h.projects.keys()].at(-1));
  assert.equal(distinctId, "123");
  assert.equal(event, "board_created");
  assert.equal(properties.board_id, boardId);
  assert.equal(properties.event_id, `board_created:${boardId}`);
  assert.equal(properties.creation_method, "manual");
  assert.equal(properties.is_seeded, false);
  assert.equal(properties.creator_type, "human");
  assert.equal(properties.actor_id, "123");
  assert.equal(properties.account_category, "customer");
});

test("with the flag off, the old board_created payload is kept", async () => {
  const h = activationHarness();
  h.prisma.project_View = { upsert: async () => ({ default_view_id: 1 }) };
  await h.load("src/utils/controllers/projects/create.ts").default(123, "Board", "team", "account", "BOARD");
  await h.drain();
  assert.deepEqual(h.captures.map((capture) => capture.properties), [{ source: "manual" }]);
});

test("seeded onboarding board is saved as seeded and sent flagged", async () => {
  const h = harness();
  const { createOnboardingSampleBoardProject } = h.load("src/utils/controllers/users/completeOnboardingStep.ts");
  const project = await createOnboardingSampleBoardProject({ exist_user: h.users.get(123), boardTitle: "Board", Team: { id: "team" }, googleAccount: { id: "account" } });
  assert.equal(h.projects.get(project.id).seeded, true);
  await h.drain();
  assert.equal(h.captures[0].properties.creation_method, "seeded");
  assert.equal(h.captures[0].properties.is_seeded, true);
});

test("adopted demo board is sent once, flagged, for the new owner", async () => {
  const h = harness();
  h.users.set(50, { id: 50, uid: "guest_local", email: "guest@example.test" });
  h.users.get(123).accountId = "account";
  h.projects.get(15).ownerId = 50;
  const { adoptGuestBoards } = h.load("src/utils/controllers/demo/adoptGuestBoards.ts");
  assert.equal(await adoptGuestBoards("mock-session", 123), 1);
  assert.equal(h.projects.get(15).seeded, true);
  assert.equal(await adoptGuestBoards("mock-session", 123), 0);
  await h.drain();
  assert.equal(h.captures.length, 1);
  assert.equal(h.captures[0].properties.creation_method, "adopted_demo");
  assert.equal(h.captures[0].properties.is_seeded, true);
});

test("guest-owned boards are not sent before adoption", async () => {
  const h = harness();
  h.users.set(50, { id: 50, uid: "guest_local", email: "guest@example.test" });
  h.projects.get(15).owner = h.users.get(50);
  h.load("src/lib/telemetry/savedWork.ts").processAnalyticsIntentSoon(await h.load("src/lib/telemetry/savedWork.ts").enqueueBoardCreated(h.prisma, 15, "seeded", { userId: 50 }));
  await h.drain();
  assert.equal(h.captures.length, 0);
});

test("a saved task sends task_created with board, seeded and channel properties", async () => {
  const h = harness();
  await saveTask(h, 41, { userId: 123, agentId: null }, "web");
  await h.drain();
  assert.equal(h.captures.length, 1);
  const [{ distinctId, event, properties }] = h.captures;
  assert.equal(distinctId, "123");
  assert.equal(event, "task_created");
  for (const [key, value] of Object.entries(common)) assert.equal(properties[key], value, key);
  assert.equal(properties.task_id, "41");
  assert.equal(properties.event_id, "task_created:41");
  assert.equal(properties.occurred_at, "2026-10-16T12:00:00.000Z");
  assert.equal(properties.is_seeded, false);
  assert.equal(properties.creation_channel, "web");
  assert.equal(properties.creator_type, "human");
  assert.equal(properties.actor_id, "123");
});

test("ordinary analytics task saves skip the pointer write; enrolled saves accept numeric project IDs", async () => {
  const h = harness();
  const project = h.projects.get(15);
  project.firstTaskPointerTaskId = null;
  project.firstRealTaskCreatedAt = null;
  await saveTask(h, 48, { userId: 123, agentId: null }, "web");
  assert.equal(h.prismaCalls.filter((call) => call === "project.updateMany").length, 0);
  project.firstTaskPointerTaskId = 8;
  await saveTask(h, 49, { userId: 123, agentId: "agent-1" }, "mcp");
  assert.ok(project.firstRealTaskCreatedAt instanceof Date);
  assert.equal(h.prismaCalls.filter((call) => call === "project.updateMany").length, 1);
  const completedAt = project.firstRealTaskCreatedAt;
  await saveTask(h, 50, { userId: 123, agentId: null }, "web");
  assert.equal(project.firstRealTaskCreatedAt, completedAt, "conditional update leaves the milestone immutable");
  await h.drain();
  assert.deepEqual(new Set(h.captures.map((capture) => capture.properties.task_id)), new Set(["48", "49", "50"]));
});

test("an agent task on a seeded board is flagged seeded and agent-made", async () => {
  const h = harness();
  h.projects.get(15).seeded = true;
  await saveTask(h, 42, { userId: 123, agentId: "agent-1" }, "mcp");
  await h.drain();
  const { properties } = h.captures[0];
  assert.equal(properties.is_seeded, true);
  assert.equal(properties.creation_channel, "mcp");
  assert.equal(properties.creator_type, "agent");
  assert.equal(properties.actor_id, "agent:agent-1");
});

test("a manifest task made for an agent is sent as agent-made without changing the webhook actor", async () => {
  const h = harness();
  const webhookActors: unknown[] = [];
  h.mocks["@/lib/mcp/webhooks/outbox"] = { persistBoardWebhookEvent: async (_tx: unknown, _id: unknown, event: any) => { webhookActors.push(event.data.actor); return []; } };
  const { createTaskWithBoardWebhookOutbox } = h.load("src/lib/mcp/webhooks/taskEvents.ts");
  h.tasks.set(45, { id: 45, projectId: 15, createdAt: new Date("2026-10-16T12:00:00Z") });
  await createTaskWithBoardWebhookOutbox(h.prisma, { userId: 123, agentId: null }, async () => ({
    taskId: 45, result: { id: 45 }, webhookTask: { id: 45, projectId: 15, sectionId: 1, section: "Doing", status: "Normal" },
  }), "mcp", "agent-9");
  await h.drain();
  assert.deepEqual(webhookActors, [{ userId: 123, agentId: null }]);
  assert.equal(h.captures[0].properties.creator_type, "agent");
  assert.equal(h.captures[0].properties.actor_id, "agent:agent-9");
});

test("a collaborator outside the rollout sends nothing on an enabled owner's board", async () => {
  const h = harness();
  h.mocks["@/lib/flags"] = { ...h.mocks["@/lib/flags"], isFeatureEnabled: async (key: string, userId: number) => key !== "htpr-7272-payment-login-agent-events" && userId === 123 };
  await saveTask(h, 46, { userId: 777, agentId: null }, "web");
  await saveTask(h, 47, { userId: 123, agentId: null }, "web");
  await h.drain();
  assert.deepEqual(h.captures.map((capture) => capture.properties.task_id), ["47"]);
});

test("replaying the same task sends no duplicate", async () => {
  const h = harness();
  const { enqueueTaskCreated, processAnalyticsIntentSoon } = h.load("src/lib/telemetry/savedWork.ts");
  await saveTask(h, 43, { userId: 123, agentId: null }, "api");
  processAnalyticsIntentSoon(await enqueueTaskCreated(h.prisma, 43, { userId: 123 }, "api"));
  processAnalyticsIntentSoon(await enqueueTaskCreated(h.prisma, 43, { userId: 123 }, "api"));
  await h.drain();
  assert.equal(h.captures.length, 1);
  assert.equal(new Set(h.captureAttempts.map((capture) => capture.uuid)).size, 1);
});

test("a failed save sends nothing", async () => {
  const h = harness();
  await assert.rejects(taskEvents(h).createTaskWithBoardWebhookOutbox(h.prisma, { userId: 123, agentId: null }, async () => {
    throw new Error("mock save failed");
  }, "web"));
  await h.drain();
  assert.equal(h.captures.length, 0);
});

test("with the flag off, no task_created is sent", async () => {
  const h = activationHarness();
  await saveTask(h, 44, { userId: 123, agentId: null }, "web");
  await h.drain();
  assert.equal(h.captures.length, 0);
});

test("account category tags QA, internal, guest and customer accounts", () => {
  const h = harness();
  const { legacyAccountCategory } = h.load("src/lib/telemetry/savedWorkAnalytics.ts");
  assert.equal(legacyAccountCategory({ id: 985, email: "qa@example.test" }), "qa");
  assert.equal(legacyAccountCategory({ id: 6, email: "owner@example.test" }), "internal");
  assert.equal(legacyAccountCategory({ id: 7, email: "Someone@Hypertask.ai" }), "internal");
  assert.equal(legacyAccountCategory({ id: 8, uid: "guest_x", email: "g@example.test" }), "guest");
  assert.equal(legacyAccountCategory({ id: 9, email: "user@example.test" }), "customer");
});

test("only known channels pass the internal header; anything else counts as web", () => {
  const { creationChannelFromHeader } = harness().load("src/lib/telemetry/savedWork.ts");
  assert.equal(creationChannelFromHeader("mcp"), "mcp");
  assert.equal(creationChannelFromHeader("api"), "api");
  assert.equal(creationChannelFromHeader("agent"), "agent");
  assert.equal(creationChannelFromHeader("evil"), "web");
  assert.equal(creationChannelFromHeader(null), "web");
});
