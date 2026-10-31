import assert from "node:assert/strict";
import test from "node:test";
import { activationHarness } from "./helpers/activation-harness";

process.env.POSTHOG_SERVER_PROJECT_TOKEN = "mock-local-only";

const cookie = "ht_cookie_consent=all; ht_session=private-cookie-secret";
const token = "private-agent-token-secret";

function harness() {
  const h = activationHarness();
  h.mocks["@/lib/flags"].HTPR_7270_SIGNUP_COMPLETED_FLAG = "htpr-7270-signup-completed";
  h.setFlagEnabled("htpr-7272-payment-login-agent-events", true);
  h.mocks["@/lib/telemetry/analyticsOutbox"] = { isAnalyticsOutboxEnabled: async () => false };
  const intents = h.load("src/lib/telemetry/analyticsIntents.ts");
  h.mocks["@/lib/telemetry/analyticsIntents"] = { ...intents, processAnalyticsIntentSoon: () => {},
    enqueueOutsideSaveAndProcessSoon: (enqueue: () => Promise<string | null>) => intents.enqueueOutsideSaveAndProcessSoon(async () => { await enqueue(); return null; }) };
  const transaction = h.prisma.$transaction;
  h.prisma.$transaction = (callback: any) => transaction(async (db: any) => {
    const oldIntents = structuredClone(h.intentRows);
    const oldMembers = structuredClone(h.members);
    const oldInvites = structuredClone(h.invites);
    const oldTasks = structuredClone(h.tasks);
    const tx = { ...db, analyticsIntent: { ...db.analyticsIntent } };
    try { return await callback(tx); } catch (error) {
      h.intentRows.splice(0, h.intentRows.length, ...oldIntents);
      h.members.splice(0, h.members.length, ...oldMembers);
      h.invites.splice(0, h.invites.length, ...oldInvites);
      h.tasks.clear();
      for (const [id, task] of oldTasks) h.tasks.set(id, task);
      throw error;
    }
  });
  const signup = h.load("src/lib/telemetry/signupCompleted.ts");
  const invites = h.load("src/lib/telemetry/inviteAnalytics.ts");
  const activation = h.load("src/lib/telemetry/activationOccurrences.ts");
  return { ...h, intents, signup, inviteAnalytics: invites, activation };
}

type Harness = ReturnType<typeof harness>;

async function replayOnce(h: Harness, event: string) {
  assert.equal(h.intentRows.length, 1);
  assert.equal(h.intentRows[0].processedAt, null);
  assert.equal(h.captures.length, 0);
  assert.equal(h.jobs.length, 0);
  const enqueueFlags = event === "agent_connected" ? ["htpr-7292-shared-account-category"] : [];
  assert.deepEqual([...new Set(h.flagChecks.map(({ key }: any) => key))], h.flagChecks.length ? enqueueFlags : []);
  assert.deepEqual(await h.intents.retryAnalyticsIntents(), { processed: 1, failed: 0, skipped: 0 });
  assert.deepEqual(await h.intents.retryAnalyticsIntents(), { processed: 0, failed: 0, skipped: 0 });
  assert.deepEqual(h.captures.map(({ event }) => event), [event]);
  assert.ok(h.intentRows[0].processedAt);
}

function signupInput() {
  return { userId: 123, signupMethod: "email", cookieHeader: cookie, utmSource: "website", decision: {
    link: true, anonymousId: "anon-visitor", attribution: { utm_source: "campaign", utm_medium: "social", utm_content: "unused" }, attributionStatus: "known",
  } };
}

function signupController(h: Harness) {
  h.mocks["@/lib/configs/auth.config"] = { default: { onboarding: {} } };
  h.mocks["@/utils/controllers/users/findUserByEmail"] = { findUserByEmail: async () => null };
  h.mocks["@/utils/controllers/users/provisionNewUser"] = { provisionNewUser: async () => h.users.get(123) };
  h.mocks["@/utils/controllers/users/resumeIncompleteSignup"] = { resumeIncompleteSignup: async () => false };
  h.mocks["@/lib/telemetry/signupIdentityLink"] = { recordSignupIdentityLink: async () => signupInput().decision };
  h.prisma.user.create = async () => h.users.get(123);
  return h.load("src/utils/controllers/users/update_or_create_user.ts").default;
}

test("signup_completed survives death after provisioning with no cookies in the intent", async () => {
  const h = harness();
  const create = signupController(h);
  assert.equal((await create("member@example.test", {}, false, false, true, { signupMethod: "email" }, null, cookie)).status, 200);
  assert.equal(h.intentRows[0].key, "signup_completed:123");
  assert.equal(JSON.stringify(h.intentRows[0].payload).includes(cookie), false);
  assert.equal(JSON.stringify(h.intentRows[0].payload).includes("private-cookie-secret"), false);
  assert.equal(JSON.stringify(h.intentRows[0].payload).includes("utm_content"), false);
  assert.equal(h.intentRows[0].payload.anonymousId, "anon-visitor");
  await replayOnce(h, "signup_completed");
  assert.equal(h.captures[0].properties.workspace_id, "team");
});

test("signup with no workspace yet is sent once with a null workspace", async () => {
  const h = harness();
  await h.signup.enqueueSignupCompleted(h.prisma, signupInput());
  h.prisma.team.findFirst = async () => null;
  await replayOnce(h, "signup_completed");
  assert.equal(h.captures[0].properties.workspace_id, null);
});

test("signup still succeeds when its analytics intent cannot be written", async () => {
  const h = harness();
  const create = signupController(h);
  const errors: unknown[][] = [];
  const consoleError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  h.prisma.analyticsIntent.createMany = async () => { throw Error("intent unavailable"); };
  try {
    assert.equal((await create("member@example.test", {}, false, false, true, { signupMethod: "email" }, null, cookie)).status, 200);
  } finally { console.error = consoleError; }
  assert.equal(h.intentRows.length, 0);
  assert.equal(errors[0][0], "Analytics intent could not be recorded");
});

test("signup without consent never persists anonymous identity or unused attribution", async () => {
  const h = harness();
  await h.signup.enqueueSignupCompleted(h.prisma, { ...signupInput(), cookieHeader: "ht_cookie_consent=essential" });
  assert.equal(h.intentRows[0].payload.anonymousId, null);
  assert.equal(h.intentRows[0].payload.attribution, null);
  assert.equal(h.intentRows[0].payload.utmSource, null);
  assert.equal(JSON.stringify(h.intentRows[0].payload).includes("anon-visitor"), false);
  assert.equal(JSON.stringify(h.intentRows[0].payload).includes("website"), false);
});

test("invite_sent link save survives death before its kick", async () => {
  const h = harness();
  const result = await h.load("src/utils/api/invite/generatePublicInviteController.ts").getInviteFromProjectId(15, 123);
  assert.ok(result.inviteLink);
  assert.equal(h.invites.length, 1);
  assert.equal(h.intentRows[0].payload.inviterUserId, 123);
  assert.equal(h.intentRows[0].payload.legacyUserId, 123);
  await replayOnce(h, "invite_sent");
});

for (const sent of [true, false]) {
  test(`email invite is durably queued only after delivery, sent=${sent}`, async () => {
    const h = harness();
    h.projects.get(15).members = [];
    h.prisma.user.findFirst = async () => null;
    h.mocks["@/utils/controllers/notifications/sendNotification"].sendEmailNotification = async () => {
      assert.equal(h.intentRows.length, 0);
      return sent;
    };
    assert.equal((await h.load("src/pages/api/invite/createInviteLink.ts").addMemberController(123, 15, ["new@example.test"])).status, 200);
    if (sent) await replayOnce(h, "invite_sent");
    else {
      assert.equal(h.intentRows.length, 0);
      await h.intents.retryAnalyticsIntents();
      assert.equal(h.captures.length, 0);
    }
  });
}

function memberController(h: Harness) {
  const joiner = { id: 234, uid: "real_joiner", email: "joiner@example.test" };
  h.users.set(234, joiner);
  h.projects.get(15).team = { id: "team", googleAccount: { userId: 123 } };
  h.prisma.invite.updateMany = async () => ({});
  return (...args: any[]) => h.load("src/utils/controllers/members/addExistingUserToProject.ts").addExistingUserToProject(...args);
}

for (const billing of [false, true]) {
  test(`member_joined is atomic with direct membership creation, billing=${billing}`, async () => {
    const h = harness();
    const join = memberController(h);
    if (billing) {
      h.projects.get(15).team.stripe_customer_id = "cus_stored";
      h.prisma.member_Team.findFirst = async () => null;
      h.mocks["@/lib/syncSeatBilling"].mutateAndSyncSeatBilling = async (_id: string, mutate: any) => mutate(() => {});
      h.mocks["@/lib/teamMembership"].ensureTeamMembership = async () => ({ member: { user: h.users.get(234) }, created: false });
    }
    assert.equal((await join(15, 234, 123)).ok, true);
    assert.equal(h.members.length, 1);
    assert.equal(h.intentRows[0].payload.inviterUserId, 123);
    await replayOnce(h, "member_joined");
  });
}

test("a membership intent insert failure rolls the member save back", async () => {
  const h = harness();
  const join = memberController(h);
  h.prisma.analyticsIntent.createMany = async () => { throw Error("intent unavailable"); };
  await assert.rejects(join(15, 234, 123), /intent unavailable/);
  assert.equal(h.members.length, 0);
  assert.equal(h.intentRows.length, 0);
  await h.intents.retryAnalyticsIntents();
  assert.equal(h.captures.length, 0);
});

test("agent_connected is secret-free, cached before enqueue, and replayed once", async () => {
  const h = harness();
  const api = h.activation;
  const first = await api.enqueueAgentConnection(h.prisma, 123, token, "mcp", "Codex", new Date(1000), "agent:123");
  assert.ok(first);
  assert.equal(await api.enqueueAgentConnection(h.prisma, 123, token, "mcp", "Codex"), null);
  assert.equal(h.prismaCalls.filter((call) => call === "analyticsIntent.createMany").length, 1);
  assert.equal(JSON.stringify(h.intentRows[0].payload).includes(token), false);
  assert.equal(JSON.stringify(h.intentRows[0].payload).includes(cookie), false);
  assert.match(h.intentRows[0].payload.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(h.intentRows[0].payload.connectionKey, "agent:123");
  await replayOnce(h, "agent_connected");
});

test("failed connection enqueue releases the cache so the next request retries", async () => {
  const h = harness();
  const insert = h.prisma.analyticsIntent.createMany;
  h.prisma.analyticsIntent.createMany = async () => { throw Error("intent unavailable"); };
  await assert.rejects(h.activation.enqueueAgentConnection(h.prisma, 123, token, "cli"), /intent unavailable/);
  h.prisma.analyticsIntent.createMany = insert;
  assert.ok(await h.activation.enqueueAgentConnection(h.prisma, 123, token, "cli"));
  await replayOnce(h, "agent_connected");
});

function taskController(h: Harness) {
  const noop = async () => undefined;
  Object.assign(h.mocks, {
    "@/lib/agents/writing": h.load("src/lib/agents/writing.ts"),
    "@/lib/tasks/sameBoardRelations": h.load("src/lib/tasks/sameBoardRelations.ts"),
    "@/utils/controllers/tasks/parentTaskAccess": h.load("src/utils/controllers/tasks/parentTaskAccess.ts"),
    "@/utils/controllers/notifications/agentFirstTaskEmail": { scheduleAgentFirstTaskEmail: noop },
    "@/utils/controllers/activities/createActivity": { default: noop },
    "@/utils/controllers/activities/createTaskMovedActivity": { createTaskMovedActivityInTransaction: async () => null },
    "@/utils/controllers/activities/sendTaskMoveNotification": { sendTaskMoveNotificationIfNeeded: noop },
    "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove": { default: noop },
    "@/utils/controllers/description/common-description-create": { default: noop },
    "@/pages/api/queues/FAST/generateSummary": { default: noop },
    "@/utils/controllers/turbopuffer/turbopufferHelper": { upsertTaskToTurbopuffer: noop, upsertAllCommentsToTurbopuffer: noop },
    "@/utils/controllers/assignees/autoAssignForSection": { autoAssignForSection: async () => "ready" },
    "@/lib/ai/labelClassifier": { scheduleClassifyTaskAiLabels: noop },
    "@/utils/controllers/tasks/spawnRecurrence": {},
    "@/utils/controllers/projects/getAllIncludes": { taskWriteAccessWhere: () => ({}) },
    "@/lib/mcp/tasks/agentMutationFence": { assertAgentAssignmentChangeAllowed: noop, cancelAgentMutationLeaseForHumanOverride: noop, AgentMutationLeaseConflictError: class extends Error {}, TaskTeamScopeError: class extends Error {} },
    "@/utils/controllers/tasks/invokeTaskDelete": {},
    "@/lib/mcp/webhooks/outbox": { persistBoardWebhookEvent: async () => [], publishBoardWebhookDeliveries: noop },
    "@/lib/agentWebhooks/outbox": { persistAgentTaskUpdatedWebhook: async () => [], publishAgentWebhookDeliveries: noop },
    "@/lib/mcp/tasks/agentDoneLifecycle": { assertAgentMayLeaveDone: noop, AgentDoneLifecycleDeniedError: class extends Error {} },
    "@/lib/cycleService": { assertCycleAssignable: noop, CycleAssignmentError: class extends Error {} },
  });
  return h.load("src/utils/controllers/tasks/single.ts").updateTaskSingle;
}

test("agent_task_completed move survives death after its save transaction", async () => {
  const h = harness();
  assert.equal((await taskController(h)({ id: 9, sectionId: 2 }, h.users.get(123), "managed")).status, 200);
  assert.equal(h.tasks.get(9).sectionId, 2);
  assert.match(h.intentRows[0].key, /^agent_task_completed:9:\d+$/);
  await replayOnce(h, "agent_task_completed");
});

test("failed task completion enqueue rolls back the task move", async () => {
  const h = harness();
  h.prisma.analyticsIntent.createMany = async () => { throw Error("intent unavailable"); };
  assert.equal((await taskController(h)({ id: 9, sectionId: 2 }, h.users.get(123), "managed")).status, 500);
  assert.equal(h.tasks.get(9).sectionId, 1);
  assert.equal(h.intentRows.length, 0);
  await h.intents.retryAnalyticsIntents();
  assert.equal(h.captures.length, 0);
});

test("board_created waits for activation capture before marking its intent processed", async () => {
  const h = harness();
  await h.load("src/lib/telemetry/savedWork.ts").enqueueBoardCreated(h.prisma, 15, "manual", { userId: 123 });
  h.setFailure("capture");
  assert.deepEqual(await h.intents.retryAnalyticsIntents(), { processed: 0, failed: 1, skipped: 0 });
  assert.equal(h.intentRows[0].processedAt, null);
  assert.equal(h.intentRows[0].attempts, 1);
  assert.equal(h.captures.length, 0);
  assert.equal(h.jobs.length, 0);
  const uuid = h.captureAttempts[0].uuid;
  h.setFailure(null);
  h.intentRows[0].nextAttemptAt = new Date(0);
  assert.deepEqual(await h.intents.retryAnalyticsIntents(), { processed: 1, failed: 0, skipped: 0 });
  assert.deepEqual(await h.intents.retryAnalyticsIntents(), { processed: 0, failed: 0, skipped: 0 });
  assert.deepEqual(h.captures.map(({ event }) => event), ["board_created"]);
  assert.ok(h.intentRows[0].processedAt);
  assert.equal(h.captureAttempts[1].uuid, uuid);
});

for (const kind of ["signup_completed", "invite_sent", "member_joined", "agent_connected", "agent_task_completed", "board_created"]) {
  test(`${kind} intent rolls back with the enclosing save transaction`, async () => {
    const h = harness();
    await assert.rejects(h.prisma.$transaction(async (tx: any) => {
      await tx.member.create({ data: { userId: 234, projectId: 15 } });
      if (kind === "signup_completed") await h.signup.enqueueSignupCompleted(tx, signupInput());
      if (kind === "invite_sent") await h.inviteAnalytics.enqueueInviteSent(tx, { id: "invite", userId: 123, projectId: 15 }, "link");
      if (kind === "member_joined") await h.inviteAnalytics.enqueueMemberJoined(tx, 1, 234, 15);
      if (kind === "agent_connected") await h.activation.enqueueAgentConnection(tx, 123, token, "mcp");
      if (kind === "agent_task_completed") await h.activation.enqueueAgentTaskCompletion(tx, h.tasks.get(9), { ...h.tasks.get(9), sectionId: 2 }, "managed");
      if (kind === "board_created") await h.load("src/lib/telemetry/savedWork.ts").enqueueBoardCreated(tx, 15, "manual", { userId: 123 });
      assert.equal(h.intentRows.length, 1);
      throw Error("save rolled back");
    }), /save rolled back/);
    assert.equal(h.members.length, 0);
    assert.equal(h.intentRows.length, 0);
    await h.intents.retryAnalyticsIntents();
    assert.equal(h.captures.length, 0);
  });
}

test("an ineligible connection writes nothing and still counts once eligible", async () => {
  const h = harness();
  h.users.get(123).uid = "guest_local";
  assert.equal(await h.activation.enqueueAgentConnection(h.prisma, 123, token, "mcp"), null);
  assert.equal(h.intentRows.length, 0);
  h.users.get(123).uid = "real_member";
  assert.ok(await h.activation.enqueueAgentConnection(h.prisma, 123, token, "mcp"));
  await replayOnce(h, "agent_connected");
});

test("an ineligible connection replay is deferred without spending retries and sent once eligible", async () => {
  const h = harness();
  assert.ok(await h.activation.enqueueAgentConnection(h.prisma, 123, token, "mcp"));
  h.users.get(123).uid = "guest_local";
  for (let cycle = 0; cycle < 12; cycle++) {
    h.intentRows[0].nextAttemptAt = new Date(0);
    assert.deepEqual(await h.intents.retryAnalyticsIntents(), { processed: 0, failed: 0, skipped: 1 });
  }
  assert.equal(h.intentRows[0].attempts, 0);
  assert.equal(h.intentRows[0].processedAt, null);
  assert.ok(h.intentRows[0].nextAttemptAt > new Date(Date.now() + 3500000));
  assert.equal(h.captures.length, 0);
  h.users.get(123).uid = "real_member";
  assert.equal(await h.activation.enqueueAgentConnection(h.prisma, 123, token, "mcp"), null);
  h.intentRows[0].nextAttemptAt = new Date(0);
  assert.deepEqual(await h.intents.retryAnalyticsIntents(), { processed: 1, failed: 0, skipped: 0 });
  assert.deepEqual(h.captures.map(({ event }) => event), ["agent_connected"]);
});

test("a connection deferred for more than seven days is closed instead of kept forever", async () => {
  const h = harness();
  assert.ok(await h.activation.enqueueAgentConnection(h.prisma, 123, token, "mcp"));
  h.users.get(123).uid = "guest_local";
  h.intentRows[0].createdAt = new Date(Date.now() - 8 * 86400000);
  assert.deepEqual(await h.intents.retryAnalyticsIntents(), { processed: 0, failed: 0, skipped: 1 });
  assert.ok(h.intentRows[0].processedAt);
  assert.equal(h.intentRows[0].lastError, "Analytics intent expired while deferred");
  assert.equal(h.captures.length, 0);
});

test("a rolled-back connection transaction does not poison the request cache", async () => {
  const h = harness();
  await assert.rejects(h.prisma.$transaction(async (tx: any) => {
    await h.activation.enqueueAgentConnection(tx, 123, token, "mcp");
    throw Error("save rolled back");
  }), /save rolled back/);
  assert.equal(h.intentRows.length, 0);
  assert.ok(await h.activation.enqueueAgentConnection(h.prisma, 123, token, "mcp"));
  await replayOnce(h, "agent_connected");
});

test("CLI connection survives death after code consumption and the status log save", async () => {
  const h = harness();
  h.mocks["@/lib/redis"] = { getRedis: async () => ({ incr: async () => 1, expire: async () => 1, eval: async () => JSON.stringify({ userId: 123, email: "member@example.test" }) }) };
  h.mocks["@/lib/mcp/auth"] = { createMcpToken: () => token };
  h.mocks["@/utils/controllers/logs/createLog"] = { default: async ({ log, LoggedById }: any) => h.prisma.logs.create({ data: { log, LoggedById } }) };
  const response = await h.load("src/app/api/cli/token-exchange/route.ts").POST(new Request("http://localhost/api/cli/token-exchange", {
    method: "POST", body: JSON.stringify({ code: "one-use-code" }), headers: { "user-agent": "hypertask-cli/0.2.0" },
  }));
  assert.equal(response.status, 200);
  assert.equal(h.logs[0].log, "cli_token_exchange");
  await replayOnce(h, "agent_connected");
});

test("CLI login still returns its token when the connection intent cannot be written", async () => {
  const h = harness();
  h.mocks["@/lib/redis"] = { getRedis: async () => ({ incr: async () => 1, expire: async () => 1, eval: async () => JSON.stringify({ userId: 123, email: "member@example.test" }) }) };
  h.mocks["@/lib/mcp/auth"] = { createMcpToken: () => token };
  h.mocks["@/utils/controllers/logs/createLog"] = { default: async ({ log, LoggedById }: any) => h.prisma.logs.create({ data: { log, LoggedById } }) };
  h.prisma.analyticsIntent.createMany = async () => { throw Error("intent unavailable"); };
  const consoleError = console.error;
  console.error = () => {};
  try {
    const response = await h.load("src/app/api/cli/token-exchange/route.ts").POST(new Request("http://localhost/api/cli/token-exchange", {
      method: "POST", body: JSON.stringify({ code: "one-use-code" }), headers: { "user-agent": "hypertask-cli/0.2.0" },
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { token });
  } finally { console.error = consoleError; }
  assert.equal(h.intentRows.length, 0);
});

for (const failure of [false, true]) {
  test(`existing teammate membership and its intent commit together, failure=${failure}`, async () => {
    const h = harness();
    const joiner = { id: 234, uid: "real_joiner", email: "joiner@example.test" };
    h.users.set(234, joiner);
    h.prisma.user.findFirst = async () => joiner;
    h.projects.get(15).members = [];
    h.projects.get(15).team = { id: "team" };
    h.prisma.team.findFirst = async () => ({ googleAccount: { userId: 123 }, members: [{ user: joiner }] });
    h.prisma.invite.deleteMany = async () => ({});
    if (failure) h.prisma.analyticsIntent.createMany = async () => { throw Error("intent unavailable"); };
    const result = await h.load("src/pages/api/invite/createInviteLink.ts").addMemberController(123, 15, [joiner.email]);
    assert.equal(result.status, failure ? 400 : 200);
    assert.equal(h.members.length, failure ? 0 : 1);
    if (failure) {
      assert.equal(h.intentRows.length, 0);
      await h.intents.retryAnalyticsIntents();
      assert.equal(h.captures.length, 0);
    } else await replayOnce(h, "member_joined");
  });
}

for (const scenario of ["human", "deleted", "unchanged"]) {
  test(`task completion enqueue excludes ${scenario} transitions before any intent write`, async () => {
    const h = harness();
    const before = h.tasks.get(9);
    const after = scenario === "unchanged" ? before : { ...before, sectionId: 2, status: scenario === "deleted" ? "Deleted" : "Normal" };
    assert.equal(await h.activation.enqueueAgentTaskCompletion(h.prisma, before, after, scenario === "human" ? null : "managed"), null);
    assert.equal(h.intentRows.length, 0);
    assert.equal(h.prismaCalls.includes("analyticsIntent.createMany"), false);
    assert.equal(h.flagChecks.length, 0);
    assert.equal(h.captures.length, 0);
  });
}
