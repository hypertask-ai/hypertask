import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { activationHarness } from "./helpers/activation-harness";
import * as flagKeys from "../src/lib/flags/keys";

// Production versions saved when HTPR-7034 shipped, so CI (shallow clone) and later commits compare against the same baseline.
const productionSource = (file: string) =>
  fs.readFileSync(`tests/fixtures/htpr-7034-production/${file.replaceAll("/", "_")}.txt`, "utf8");

process.env.POSTHOG_SERVER_PROJECT_TOKEN = "mock-local-only";
const localCaptures: any[] = [];
const save = (h: ReturnType<typeof activationHarness>) => { localCaptures.push(...h.captures); };

function taskController(h: ReturnType<typeof activationHarness>) {
  const noop = async () => undefined;
  Object.assign(h.mocks, {
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
    "@/lib/mcp/tasks/agentMutationFence": { assertAgentAssignmentChangeAllowed: noop, cancelAgentMutationLeaseForHumanOverride: noop, AgentMutationLeaseConflictError: class extends Error {} },
    "@/utils/controllers/tasks/invokeTaskDelete": {},
    "@/lib/mcp/webhooks/outbox": { persistBoardWebhookEvent: async () => [], publishBoardWebhookDeliveries: noop },
    "@/lib/agentWebhooks/outbox": { persistAgentTaskUpdatedWebhook: async () => [], publishAgentWebhookDeliveries: noop },
    "@/lib/mcp/tasks/agentDoneLifecycle": { assertAgentMayLeaveDone: noop, AgentDoneLifecycleDeniedError: class extends Error {} },
    "@/lib/cycleService": { assertCycleAssignable: noop, CycleAssignmentError: class extends Error {} },
  });
  return h.load("src/utils/controllers/tasks/single.ts").updateTaskSingle;
}

test("manual board controller captures after persisted creation", async () => {
  const h = activationHarness();
  h.prisma.project_View = { upsert: async () => ({ default_view_id: 1 }) };
  const create = h.load("src/utils/controllers/projects/create.ts").default;
  const result = await create(123, "Board", "team", "account", "BOARD");
  assert.equal(result.status, 200);
  await h.drain();
  assert.deepEqual(h.captures.map((event) => event.properties), [{ source: "manual" }]);
  save(h);
});

test("seeded onboarding board emits seeded source from its creation controller", async () => {
  const h = activationHarness();
  const { createOnboardingSampleBoardProject } = h.load("src/utils/controllers/users/completeOnboardingStep.ts");
  const project = await createOnboardingSampleBoardProject({ exist_user: h.users.get(123), boardTitle: "Board", Team: { id: "team" }, googleAccount: { id: "account" } });
  assert.ok(project.id);
  await h.drain();
  assert.equal(h.captures[0].event, "board_created");
  assert.deepEqual(h.captures[0].properties, { source: "seeded" });
  save(h);
});

test("adopting guest boards emits once for the new owner; repeat adoption is ignored", async () => {
  const h = activationHarness();
  h.users.set(50, { id: 50, uid: "guest_local", email: "guest@example.test" });
  h.users.get(123).accountId = "account";
  h.projects.get(15).ownerId = 50;
  const { adoptGuestBoards } = h.load("src/utils/controllers/demo/adoptGuestBoards.ts");
  assert.equal(await adoptGuestBoards("mock-session", 123), 1);
  assert.equal(await adoptGuestBoards("mock-session", 123), 0);
  await h.drain();
  assert.deepEqual(h.captures, [{ distinctId: "123", event: "board_created", properties: { source: "adopted_demo" } }]);
  save(h);
});

test("CLI code exchange is consumed atomically and emits once, not on credential reuse", async () => {
  const h = activationHarness();
  let consumed = false;
  h.mocks["@/lib/redis"] = { getRedis: async () => ({ incr: async () => 1, expire: async () => 1, eval: async () => { if (consumed) return false; consumed = true; return JSON.stringify({ userId: 123, email: "member@example.test" }); } }) };
  h.mocks["@/lib/mcp/auth"] = { createMcpToken: () => "mock-cli-credential" };
  const { POST } = h.load("src/app/api/cli/token-exchange/route.ts");
  const request = () => new Request("http://localhost/api/cli/token-exchange", { method: "POST", body: JSON.stringify({ code: "mock-code" }), headers: { "user-agent": "hypertask-cli/0.2.0" } });
  assert.equal((await POST(request())).status, 200);
  assert.equal((await POST(request())).status, 401);
  const { recordAuthenticatedConnection } = h.load("src/lib/telemetry/activationOccurrences.ts");
  recordAuthenticatedConnection(request(), 123, "mock-cli-credential");
  await h.drain();
  assert.deepEqual(h.captures, [{ distinctId: "123", event: "agent_connected", properties: { client: "other", transport: "cli", is_first: true } }]);
  save(h);
});

// Compare against this commit's production parent, not a remote ref that can advance mid-run.
for (const [scenario, userId, enabled] of [["flag-off", 123, false], ["QA", 985, true], ["flag-on", 123, true]] as const) {
  test(`${scenario}: CLI exchange writes exactly the production status rows before returning`, async (t) => {
    t.mock.timers.enable({ apis: ["Date"], now: 1700000000000 });
    const file = "src/app/api/cli/token-exchange/route.ts";
    const run = async (production: boolean) => {
      const h = activationHarness();
      h.setEnabled(enabled);
      h.users.set(userId, { id: userId, uid: "real_member", email: "member@example.test" });
      h.mocks["@/utils/controllers/logs/createLog"] = h.load("src/utils/controllers/logs/createLog.ts");
      h.mocks["@/lib/redis"] = { getRedis: async () => ({ incr: async () => 1, expire: async () => 1, eval: async () => JSON.stringify({ userId, email: "member@example.test" }) }) };
      let issued = 0;
      h.mocks["@/lib/mcp/auth"] = { createMcpToken: () => `mock-cli-credential-${++issued}` };
      const { POST } = h.load(file, production ? productionSource(file) : undefined);
      for (let exchange = 0; exchange < 2; exchange++) {
        const response = await POST(new Request("http://localhost/api/cli/token-exchange", { method: "POST", body: JSON.stringify({ code: `code-${exchange}` }) }));
        assert.equal(response.status, 200);
        assert.equal(h.logs.filter((row) => row.log === "cli_token_exchange").length, exchange + 1, "production log is written before the response");
        await h.drain();
        t.mock.timers.tick(1000);
      }
      return h;
    };
    const production = await run(true);
    t.mock.timers.setTime(1700000000000);
    const current = await run(false);
    const statusRows = (h: ReturnType<typeof activationHarness>) => h.logs.filter((row) => row.log === "cli_token_exchange").map(({ id, ...row }) => row);
    assert.deepEqual(statusRows(current), statusRows(production));
    assert.deepEqual(statusRows(current).map(({ log, type, status, LoggedById }) => ({ log, type, status, LoggedById })), Array.from({ length: 2 }, () => ({ log: "cli_token_exchange", type: "Signup", status: "Normal", LoggedById: userId })));
    assert.equal(current.captures.length, enabled && userId !== 985 ? 2 : 0);
    if (current.captures.length) assert.deepEqual(current.captures.map((capture) => capture.properties.is_first), [true, false]);
  });

  for (const boundedLogging of [false, true]) {
    test(`${scenario}: JWT/MCP periodic status logging matches production, bounded=${boundedLogging}`, async (t) => {
      t.mock.timers.enable({ apis: ["Date"], now: 1700000000000 });
      const file = "src/lib/mcp/auth/verifyJwt.ts";
      const run = async (production: boolean) => {
        const h = activationHarness();
        h.setEnabled(enabled);
        h.users.set(userId, { id: userId, uid: "real_member", email: "member@example.test" });
        h.prisma.revokedToken = { findFirst: async () => null };
        h.mocks["@/utils/controllers/logs/createLog"] = h.load("src/utils/controllers/logs/createLog.ts");
        h.mocks["@/lib/mcp/managementKeyTeamScope"] = {};
        h.mocks.jsonwebtoken = { default: { decode: () => ({ userId }), verify: () => ({ userId }) } };
        const oldSecret = process.env.JWT_SECRET;
        process.env.JWT_SECRET = "mock-local-only";
        try {
          const { validateJwtToken } = h.load(file, production ? productionSource(file) : undefined);
          for (const [advance, count] of [[0, 1], [0, 1], [30 * 60 * 1000, 1], [1, 2]]) {
            t.mock.timers.tick(advance);
            assert.equal((await validateJwtToken("mock-token", { boundedLogging })).user.id, userId);
            await h.drain();
            assert.equal(h.logs.length, count, "production logs once initially, then strictly after thirty minutes");
          }
          assert.deepEqual(h.logs.map(({ log, type, status, LoggedById }) => ({ log, type, status, LoggedById })), Array.from({ length: 2 }, () => ({ log: "mcp_connected", type: "Signup", status: "Normal", LoggedById: userId })));
          return h.logs;
        } finally {
          if (oldSecret === undefined) delete process.env.JWT_SECRET;
          else process.env.JWT_SECRET = oldSecret;
        }
      };
      const production = await run(true);
      t.mock.timers.setTime(1700000000000);
      assert.deepEqual(await run(false), production);
    });
  }
}

test("connection-status reads stay free of analytics markers", () => {
  assert.doesNotMatch(fs.readFileSync("src/app/api/users/ai-connection-status/route.ts", "utf8"), /activation/i);
});

test("durable connection claims survive cold starts and honor historical Logs", async () => {
  const h = activationHarness();
  h.logs.push({ LoggedById: 123, log: "mcp_connected", id: 1 });
  const { recordAgentConnection, activationClient } = h.load("src/lib/telemetry/activationOccurrences.ts");
  for (const [name, expected] of [["Claude Code", "claude_code"], ["claude-code", "claude_code"], ["Cursor", "cursor"], ["codex/1", "codex"], ["hypertask-cli/0.2.0", "other"]]) assert.equal(activationClient(name), expected);
  recordAgentConnection(123, "mock-mcp-credential", "mcp", "Claude Code");
  recordAgentConnection(123, "mock-mcp-credential", "mcp", "Claude Code");
  await h.drain();
  assert.deepEqual(h.captures[0].properties, { client: "claude_code", transport: "mcp", is_first: false });
  const cold = activationHarness();
  cold.logs.push(...h.logs);
  cold.load("src/lib/telemetry/activationOccurrences.ts").recordAgentConnection(123, "mock-mcp-credential", "mcp", "Claude Code");
  await cold.drain();
  assert.equal(cold.captures.length, 0);
});

test("direct authenticated credentials classify MCP/API and ignore OAuth refresh/use", async () => {
  const h = activationHarness();
  const { recordAuthenticatedConnection } = h.load("src/lib/telemetry/activationOccurrences.ts");
  recordAuthenticatedConnection(new Request("http://localhost/mcp", { headers: { "user-agent": "Cursor" } }), 123, "mock-cursor-token");
  recordAuthenticatedConnection(new Request("http://localhost/api/mcp/tasks", { headers: { "user-agent": "Codex" } }), 123, "mock-codex-token");
  const jwt = require("jsonwebtoken");
  const contract = h.load("src/lib/mcp/oauthTokenContract.ts");
  const oauth = jwt.sign({ iss: contract.JWT_OAUTH_ISSUER, aud: contract.JWT_OAUTH_AUDIENCE }, "mock-local-signing");
  recordAuthenticatedConnection(new Request("http://localhost/mcp"), 123, oauth);
  await h.drain();
  assert.deepEqual(h.captures.map((event) => event.properties), [
    { client: "cursor", transport: "mcp", is_first: true },
    { client: "codex", transport: "api", is_first: false },
  ]);
});

test("managed agent completion passes through the task controller and repeat updates do not emit", async () => {
  const h = activationHarness();
  const update = taskController(h);
  assert.equal((await update({ id: 9, sectionId: 2 }, h.users.get(123), "managed")).status, 200);
  assert.equal((await update({ id: 9, sectionId: 2 }, h.users.get(123), "managed")).status, 200);
  await h.drain();
  assert.deepEqual(h.captures, [{ distinctId: "123", event: "agent_task_completed", properties: { taskId: 9, projectId: 15, is_first: true } }]);
  h.tasks.set(10, { ...h.tasks.get(9), id: 10, sectionId: 1, section: "Doing" });
  await update({ id: 10, status: "Archive" }, h.users.get(123), "managed");
  await h.drain();
  assert.equal(h.captures[1].properties.is_first, false);
  save(h);
});

test("a delegated managed agent completion belongs to the board owner, not the token owner", async () => {
  const h = activationHarness();
  h.users.set(321, { id: 321, uid: "real_board_owner", email: "owner@example.test" });
  h.projects.get(15).ownerId = 321;
  const update = taskController(h);
  assert.equal((await update({ id: 9, sectionId: 2 }, h.users.get(123), "managed")).status, 200);
  await h.drain();
  assert.equal(h.captures[0].distinctId, "321");
  assert.deepEqual(h.captures[0].properties, { taskId: 9, projectId: 15, is_first: true });
});

test("human updates do not count, custom Done roles do count, explicit non-Done roles do not", async () => {
  const h = activationHarness();
  const { recordAgentTaskCompletion } = h.load("src/lib/telemetry/activationOccurrences.ts");
  const before = h.tasks.get(9);
  recordAgentTaskCompletion(before, { ...before, sectionId: 2, section: "Done" }, null);
  recordAgentTaskCompletion(before, { ...before, sectionId: 4, section: "Done" }, "managed");
  recordAgentTaskCompletion(before, { ...before, sectionId: 3, section: "Delivered" }, "managed");
  await h.drain();
  assert.equal(h.captures.length, 1);
  assert.equal(h.captures[0].distinctId, "123");
});

test("pre-existing agent moves and archives prevent a false first-completion claim", async () => {
  for (const activity of [
    { type: "TaskMove", data: { fromAgent: { id: "retired-agent" }, toSection: { sectionId: 3, sectionTitle: "Delivered" } } },
    { type: "TaskArchive", data: { fromAgent: { id: "managed" }, newStatus: "Archive" } },
  ]) {
    const h = activationHarness();
    h.history.push({ activity });
    const { recordAgentTaskCompletion } = h.load("src/lib/telemetry/activationOccurrences.ts");
    const before = h.tasks.get(9);
    recordAgentTaskCompletion(before, { ...before, sectionId: 2, section: "Done" }, "managed");
    await h.drain();
    assert.equal(h.captures[0].properties.is_first, false);
  }
  const h = activationHarness();
  h.history.push({ activity: { type: "TaskMove", data: { toSection: { sectionId: 2 } } } });
  h.load("src/lib/telemetry/activationOccurrences.ts").recordActivationOccurrence(123, "agent_task_completed", "9", { taskId: 9, projectId: 15 });
  await h.drain();
  assert.equal(h.captures[0].properties.is_first, true, "a human's historic completion is not agent activation");
});

test("parallel duplicate occurrences cannot double capture or both claim first", async () => {
  const h = activationHarness();
  const { recordActivationOccurrence } = h.load("src/lib/telemetry/activationOccurrences.ts");
  recordActivationOccurrence(123, "agent_task_completed", "9", { taskId: 9, projectId: 15 }, new Date(1000));
  recordActivationOccurrence(123, "agent_task_completed", "9", { taskId: 9, projectId: 15 }, new Date(1000));
  recordActivationOccurrence(123, "agent_task_completed", "10", { taskId: 10, projectId: 15 }, new Date(2000));
  await h.drain();
  assert.deepEqual(h.captures.map((capture) => capture.properties.is_first), [true, false]);
});

test("public invitation link creation records method link and reuse does not fire", async () => {
  const h = activationHarness();
  h.prisma.invite.findFirst = async () => h.invites[0];
  const { getInviteFromProjectId } = h.load("src/utils/api/invite/generatePublicInviteController.ts");
  await getInviteFromProjectId(15, 123);
  await getInviteFromProjectId(15, 123);
  await h.drain();
  assert.deepEqual(h.captures, [{ distinctId: "123", event: "teammate_invited", properties: { method: "link" } }]);
  save(h);
});

test("email invite controller only emits after successful sending and skips existing invitations", async () => {
  const h = activationHarness();
  h.projects.get(15).members = [];
  h.prisma.user.findFirst = async () => null;
  const { addMemberController } = h.load("src/pages/api/invite/createInviteLink.ts");
  assert.equal((await addMemberController(123, 15, ["invited@example.test"])).status, 200);
  await addMemberController(123, 15, ["invited@example.test"]);
  await h.drain();
  assert.deepEqual(h.captures, [{ distinctId: "123", event: "teammate_invited", properties: { method: "email" } }]);
  save(h);
  const failed = activationHarness();
  failed.projects.get(15).members = [];
  failed.prisma.user.findFirst = async () => null;
  failed.mocks["@/utils/controllers/notifications/sendNotification"].sendEmailNotification = async () => false;
  await failed.load("src/pages/api/invite/createInviteLink.ts").addMemberController(123, 15, ["invited@example.test"]);
  await failed.drain();
  assert.equal(failed.captures.length, 0);
});

test("invite acceptance emits for the inviter, includes invitee id and ignores repeated acceptance", async () => {
  const h = activationHarness();
  h.users.set(234, { id: 234, uid: "real_invitee", email: "invitee@example.test" });
  h.projects.get(15).ownerId = 789;
  h.invites.push({ id: "invitation", userId: 123, projectId: 15, expired: false, uses: 1, project: h.projects.get(15) });
  const accept = h.load("src/utils/controllers/members/invite.ts").default;
  assert.equal((await accept(234, 15, "invitation")).status, 200);
  await accept(234, 15, "invitation");
  await h.drain();
  assert.deepEqual(h.captures, [{ distinctId: "123", event: "invite_accepted", properties: { inviteeId: 234 } }]);
  save(h);
});

function bulkSectionController(h: ReturnType<typeof activationHarness>, rollback = false) {
  const noop = async () => undefined;
  const source = { ...h.sections[0], projectId: 15 };
  let committed = false;
  const batches: any[] = [];
  h.prisma.section.findFirst = async ({ where }: any) => where.id?.not ? h.sections[1] : source;
  h.prisma.section.findUnique = async () => source;
  h.prisma.section.update = async ({ data }: any) => ({ ...source, ...data });
  h.prisma.$queryRaw = async () => [...h.tasks.values()].map((task) => ({ ...task }));
  h.prisma.task.updateManyAndReturn = async ({ data }: any) => [...h.tasks.values()].map((task) => Object.assign(task, data));
  h.prisma.taskSectionEvent.createMany = noop;
  const transaction = h.prisma.$transaction;
  h.prisma.$transaction = async (callback: any) => {
    const result = await transaction(callback);
    if (!committed && rollback) throw Error("bulk move rolled back");
    committed = true;
    return result;
  };
  Object.assign(h.mocks, {
    "@/utils/controllers/notifications/agentFirstTaskEmail": { scheduleAgentFirstTaskEmailBatch: (tasks: any[], userId: number, agentId: string) => {
      assert.equal(committed, true);
      batches.push({ tasks, userId, agentId });
    } },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
    "@/utils/generateRank": { default: () => "A0100" },
    "@/utils/controllers/section/viewHelpers": { appendSectionToAllViews: noop, updateSectionInAllViews: noop, removeSectionFromAllViews: noop },
  });
  const service = h.load("src/utils/controllers/section/sectionService.ts");
  h.mocks["@/utils/controllers/section/sectionService"] = service;
  h.mocks["@/lib/mcp/tasks/services"] = {};
  h.mocks["@/utils/controllers/agents/boardMembers"] = {};
  const services = h.load("src/lib/mcp/sections/services.ts");
  h.mocks["@/lib/mcp/sections/services"] = services;
  Object.assign(h.mocks, {
    ai: { tool: (config: any) => config },
    "@/lib/realtime/server": { broadcastBoardChange: noop },
    "@/lib/ai/bulkConfirmation": { requireCrossMessageConfirmation: async () => "confirmed" },
    "@/lib/ai/tools/execution": { withToolErrors: (execute: any) => execute },
    "@/lib/ai/tools/helpers": { sanitizeForJson: (value: any) => value, assertAccessibleProject: async () => true },
  });
  h.prisma.task.count = async () => h.tasks.size;
  return { service, services, batches, native: h.load("src/lib/ai/tools/section.ts").createSectionTool };
}

for (const native of [false, true]) {
  test(`bulk section deletion captures each eligible moved task once through ${native ? "native agent tool" : "MCP section service"}`, async () => {
    const h = activationHarness();
    h.tasks.set(10, { ...h.tasks.get(9), id: 10, sectionId: null });
    h.tasks.set(11, { ...h.tasks.get(9), id: 11, sectionId: 3 });
    // A later historic activity must not disqualify the actual first completion.
    h.history.push({ createdAt: new Date(Date.now() + 60000), activity: { type: "TaskArchive", data: { fromAgent: { id: "managed" }, newStatus: "Archive" } } });
    h.prisma.comment.findMany = async ({ where }: any) => h.history.filter((row) => row.createdAt < where.createdAt.lt);
    const bulk = bulkSectionController(h);
    const result = native
      ? await bulk.native({ user: h.users.get(123), actingAgentId: "managed", sendStatus: () => {}, confirmationSessionId: "local", bulkPreviewsIssued: new Set() }).hypertask_section.execute({ action: "delete", section_id: 1, project_id: 15, confirmed: true })
      : await bulk.services.deleteSection({ sectionId: 1, projectId: 15, userId: 123 }, "managed");
    assert.equal(result.success, true);
    await h.drain();
    assert.equal(bulk.batches.length, 1);
    assert.equal(bulk.batches[0].tasks.length, 3);
    assert.deepEqual(h.captures.map((capture) => capture.properties), [
      { taskId: 9, projectId: 15, is_first: true },
      { taskId: 10, projectId: 15, is_first: true },
    ]);
    const api = h.load("src/lib/telemetry/activationOccurrences.ts");
    for (const { before, after } of bulk.batches[0].tasks) api.recordAgentTaskCompletion(before, after, "managed");
    await h.drain();
    assert.equal(h.captures.length, 2, "duplicate scheduling does not double count a moved task");
    save(h);
  });
}

for (const scenario of ["human", "flag-off", "rollback", "historical"] as const) {
  test(`bulk completion preserves ${scenario} behavior`, async () => {
    const h = activationHarness();
    h.setEnabled(scenario !== "flag-off");
    if (scenario === "historical") h.history.push({ activity: { type: "TaskArchive", data: { fromAgent: { id: "managed" }, newStatus: "Archive" } } });
    const bulk = bulkSectionController(h, scenario === "rollback");
    const move = bulk.service.deleteSection({ sectionId: 1, projectId: 15, userId: 123, agentId: scenario === "human" ? null : "managed" });
    if (scenario === "rollback") await assert.rejects(move, /rolled back/);
    else assert.equal((await move).status, 204);
    await h.drain();
    assert.equal(h.captures.length, scenario === "historical" ? 1 : 0);
    if (h.captures.length) assert.equal(h.captures[0].properties.is_first, false);
  });
}

for (const sendFailure of [false, true]) {
  test(`first-task lifecycle event fires only after successful email delivery, failure=${sendFailure}`, async () => {
    const h = activationHarness();
    const before = { ...h.tasks.get(9) };
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    let sendStarted!: () => void;
    const started = new Promise<void>((resolve) => { sendStarted = resolve; });
    h.prisma.agent.findFirst = async () => ({ userId: 123, displayName: "Agent" });
    Object.assign(h.mocks, {
      "@/lib/email/sendEmail": { sendEmail: async () => { sendStarted(); await barrier; if (sendFailure) throw Error("mock email failure"); } },
      "@/lib/email/unsubscribe": { unsubscribeHeaders: () => ({}) },
      "@/utils/controllers/notifications/emailTemplates": { renderAgentFirstTaskEmail: () => ({ subject: "mock", html: "mock" }) },
      "@/lib/onboarding/emails/agentFirstTask": { renderAgentFirstTaskEmail: () => ({ subject: "mock", html: "mock" }) },
    });
    const email = h.load("src/utils/controllers/notifications/agentFirstTaskEmail.ts");
    assert.equal(email.scheduleAgentFirstTaskEmail(before, { ...before, sectionId: 2, section: "Done" }, 123, "managed"), undefined);
    await started;
    assert.equal(h.captures.length, 0, "pending delivery is not a sent event");
    release();
    await h.drain();
    assert.deepEqual(h.captures, sendFailure ? [] : [{ distinctId: "123", event: "lifecycle_email_sent", properties: { type: "agent_first_task" } }]);
    email.scheduleAgentFirstTaskEmail(before, { ...before, sectionId: 2, section: "Done" }, 123, "managed");
    await h.drain();
    assert.equal(h.captures.length, sendFailure ? 0 : 1, "a durable email claim prevents repeat sends and events");
    save(h);
  });
}

for (const scenario of ["sent", "send-failure", "flag-off", "connected"] as const) {
  test(`nudge lifecycle event follows successful delivery only: ${scenario}`, async () => {
    const h = activationHarness();
    const values = new Map<string, string>();
    let release!: () => void;
    let started!: () => void;
    const delivery = new Promise<void>((resolve) => { release = resolve; });
    const sending = new Promise<void>((resolve) => { started = resolve; });
    h.setEnabled(scenario !== "flag-off");
    Object.assign(h.mocks, {
      "@/lib/flags/keys": flagKeys,
      "@/lib/onboarding/emails/eligibility": { onboardingEmailSkipReason: () => null },
      "@/lib/onboarding/emails/layout": { renderOnboardingEmail: () => ({ subject: "mock", html: "mock" }) },
      "@/lib/onboarding/agentConnection": { getFirstAgentConnection: async () => scenario === "connected" ? {} : null },
      "@/lib/auth/requestBaseUrl": { fallbackBaseUrl: () => "http://localhost" },
      "@/lib/email/unsubscribe": { unsubscribeHeaders: () => ({}), unsubscribeUrl: () => "http://localhost/unsubscribe" },
      "@/lib/redis": { getRedis: async () => ({ get: async (key: string) => values.get(key), set: async (key: string, value: string) => { values.set(key, value); return "OK"; }, del: async (key: string) => values.delete(key) }) },
      "@/lib/qstash": {},
      "@/lib/email/sendEmail": { sendEmail: async () => { started(); await delivery; if (scenario === "send-failure") throw Error("mock email failure"); } },
    });
    values.set("onboarding:qa-armed:member@example.test", "1");
    const { sendAgentNudgeEmail } = h.load("src/lib/onboarding/emails/agentNudge.ts");
    const result = sendAgentNudgeEmail(123);
    if (scenario === "sent" || scenario === "send-failure") {
      await sending;
      assert.equal(h.captures.length, 0, "pending delivery is not a sent event");
      release();
    }
    if (scenario === "send-failure") await assert.rejects(result, /mock email failure/);
    else assert.equal(await result, scenario === "connected" ? "agent_connected" : scenario === "flag-off" ? "flag_off" : "sent");
    await h.drain();
    assert.deepEqual(h.captures, scenario === "sent" ? [{ distinctId: "123", event: "lifecycle_email_sent", properties: { type: "agent_nudge" } }] : []);
    if (scenario === "sent") {
      assert.equal(await sendAgentNudgeEmail(123), "already_sent");
      await h.drain();
      assert.equal(h.captures.length, 1);
    }
    save(h);
  });
}

test("every additional server boundary is wired and lifecycle emails are owned by their sender", () => {
  const checks = [
    ["src/lib/onboarding/emails/agentNudge.ts", /await sendEmail\([\s\S]*?sent = true;\s*void trackActivation\(userId, "lifecycle_email_sent", \{ type: "agent_nudge" \}\)/],
    ["src/app/oauth/token/route.ts", /recordAgentConnection\(authCode.user.id, session.accessToken, "mcp", client.client_name\)/],
    ["src/lib/mcp/auth/session.ts", /recordAuthenticatedConnection\(request, ctx.user.id, token\)/],
    ["src/pages/api/invite/generatePublicInvite.ts", /recordActivationOccurrence\(newInvite.userId, "teammate_invited", newInvite.id, \{ method: "link" \}\)/],
    ["src/pages/api/invite/reSendInvite.ts", /if \(sent\) recordActivationOccurrence\(user.id, "teammate_invited", invite.id, \{ method: "email" \}\)/],
  ] as const;
  for (const [file, pattern] of checks) assert.match(fs.readFileSync(file, "utf8"), pattern);
  assert.doesNotMatch(fs.readFileSync("src/lib/telemetry/activationOccurrences.ts", "utf8"), /"lifecycle_email_sent"/);
});

test("ineligible users never start activation transactions or write markers in any scheduled job", async () => {
  const oldQaEmail = process.env.QA_LOGIN_EMAIL;
  process.env.QA_LOGIN_EMAIL = " qa@example.test ";
  try {
    for (const scenario of ["off", "qa-id", "qa-email", "guest", "missing", "invalid"] as const) {
      for (const job of ["occurrence", "connection", "authenticated", "completion"] as const) {
        const h = activationHarness();
        const userId = scenario === "qa-id" ? 985 : scenario === "invalid" ? 0 : 321;
        if (scenario !== "missing") h.users.set(userId, {
          uid: scenario === "guest" ? "guest_local" : "real_owner",
          email: scenario === "qa-email" ? "QA@EXAMPLE.TEST" : "owner@example.test",
        });
        h.setEnabled(scenario !== "off");
        h.projects.get(15).ownerId = userId;
        const api = h.load("src/lib/telemetry/activationOccurrences.ts");
        const before = h.tasks.get(9);
        if (job === "occurrence") api.recordActivationOccurrence(userId, "invite_accepted", "invite", { inviteeId: 234 });
        if (job === "connection") api.recordAgentConnection(userId, "mock-ineligible-connection", "mcp");
        if (job === "authenticated") api.recordAuthenticatedConnection(new Request("http://localhost/mcp"), userId, "mock-ineligible-direct");
        if (job === "completion") api.recordAgentTaskCompletion(before, { ...before, sectionId: 2, section: "Done" }, "managed");
        await h.drain();
        const expectedCalls = job === "completion" ? ["project.findUnique"] : [];
        if (!["off", "qa-id", "invalid"].includes(scenario)) expectedCalls.push("user.findUnique");
        assert.deepEqual(h.prismaCalls, expectedCalls, `${scenario}/${job}: only owner and eligibility reads allowed, no writes or transactions`);
        assert.deepEqual(h.logs, []);
        assert.deepEqual(h.captures, []);
        if (!["qa-id", "invalid"].includes(scenario)) assert.deepEqual(h.flagChecks, [{ key: "htpr-7034-activation-analytics", userId }]);
      }
    }
  } finally {
    if (oldQaEmail === undefined) delete process.env.QA_LOGIN_EMAIL;
    else process.env.QA_LOGIN_EMAIL = oldQaEmail;
  }
});

test("when the flag turns on, skipped credentials and occurrences remain eligible and legacy history still prevents false firsts", async () => {
  const h = activationHarness();
  const api = h.load("src/lib/telemetry/activationOccurrences.ts");
  const before = h.tasks.get(9);
  const after = { ...before, sectionId: 2, section: "Done", updatedAt: new Date(1000) };
  const record = () => {
    api.recordAgentConnection(123, "mock-later-enabled", "mcp", "Cursor");
    api.recordAgentTaskCompletion(before, after, "managed");
    api.recordActivationOccurrence(123, "teammate_invited", "invite", { method: "link" });
  };
  h.setEnabled(false);
  record();
  await h.drain();
  assert.deepEqual(h.prismaCalls, ["project.findUnique"]);
  assert.equal(h.logs.length, 0);
  assert.equal(h.captures.length, 0);
  h.logs.push({ LoggedById: 123, log: "cli_token_exchange", id: 1 });
  h.history.push({ activity: { type: "TaskMove", data: { fromAgent: { id: "managed" }, toSection: { sectionId: 3, sectionTitle: "Delivered" } } } });
  h.setEnabled(true);
  record();
  await h.drain();
  assert.ok(h.prismaCalls.includes("$transaction"), "enabled positive control starts transactions");
  assert.ok(h.prismaCalls.includes("logs.create"), "enabled positive control writes markers");
  assert.equal(h.captures.length, 3);
  for (const event of ["agent_connected", "agent_task_completed"]) assert.equal(h.captures.find((capture) => capture.event === event).properties.is_first, false);
  record();
  await h.drain();
  assert.equal(h.captures.length, 3, "later enabled events still deduplicate");
});

test("scheduled occurrence callers return before a pending eligibility check", async () => {
  for (const job of ["occurrence", "connection", "completion"] as const) {
    const h = activationHarness();
    let release!: (enabled: boolean) => void;
    let checkStarted!: () => void;
    const started = new Promise<void>((resolve) => { checkStarted = resolve; });
    h.mocks["@/lib/flags"].isFeatureEnabled = () => new Promise((resolve) => { release = resolve; checkStarted(); });
    const api = h.load("src/lib/telemetry/activationOccurrences.ts");
    const before = h.tasks.get(9);
    const result = job === "occurrence" ? api.recordActivationOccurrence(123, "teammate_invited", "invite", { method: "link" })
      : job === "connection" ? api.recordAgentConnection(123, "mock-pending-eligibility", "mcp")
      : api.recordAgentTaskCompletion(before, { ...before, sectionId: 2, section: "Done" }, "managed");
    assert.equal(result, undefined);
    await started;
    assert.deepEqual(h.prismaCalls, job === "completion" ? ["project.findUnique"] : []);
    release(false);
    await h.drain();
    assert.deepEqual(h.logs, []);
  }
});

test.after(() => {
  const folder = path.join(os.homedir(), ".local/state/vcc-evidence/HTPR-7034");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "local-events.json"), JSON.stringify(localCaptures, null, 2) + "\n");
});
