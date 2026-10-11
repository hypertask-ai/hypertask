const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const serviceFile = "src/utils/controllers/section/sectionService.ts";
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
function load(file, stubs) {
  const mod = { exports: {} };
  const source = read(file);
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  new Function("module", "exports", "require", js)(mod, mod.exports, (name) => {
    assert.ok(Object.hasOwn(stubs, name), `Unstubbed dependency: ${name}`);
    return stubs[name];
  });
  return mod.exports;
}

function fixture(options = {}) {
  const userId = 985;
  const agentId = options.human ? null : "authenticated-agent";
  const source = { id: 1, projectId: 15, section_title: "Doing", isDone: false };
  const destination = { id: 2, projectId: 15, section_title: "Accepted", isDone: true };
  const before = options.before ?? [
    { id: 42, projectId: 15, uniqueIndex: 7028, title: "Release review", sectionId: 1, section: "Doing", status: "Normal" },
    { id: 43, projectId: 15, uniqueIndex: 7029, title: "Docs review", sectionId: null, section: "Doing", status: "Normal" },
  ];
  const after = before.map((task) => ({ ...task, sectionId: 2, section: "Accepted" }));
  const calls = { scheduled: [], sent: [], locks: 0, committed: false, history: [], markers: [], markerReads: 0, completionReads: 0 };
  let sectionReads = 0;
  let claimTail = Promise.resolve();
  const tx = {
    $queryRaw: async (strings, ...values) => {
      calls.locks++;
      assert.match(strings.join("?"), /WHERE "projectId" = \?\s+AND \("sectionId" = \? OR section = \?\)\s+AND status = 'Normal'\s+ORDER BY id\s+FOR UPDATE/);
      assert.deepEqual(values, [15, 1, "Doing"]);
      return before;
    },
    task: { updateManyAndReturn: async ({ where, data }) => {
      assert.deepEqual(where, { projectId: 15, OR: [{ sectionId: 1 }, { section: "Doing" }], status: "Normal" });
      assert.equal(data.sectionId, 2);
      assert.equal(calls.scheduled.length, 0);
      return after;
    } },
    taskSectionEvent: { createMany: async ({ data }) => { calls.history.push(...data); } },
    section: { update: async ({ data }) => ({ ...source, ...data }) },
  };
  const prisma = {
    logs: { findFirst: async () => {
      calls.markerReads++;
      return options.claimed ? { id: 1 } : calls.markers[0] ?? null;
    } },
    project: {
      findFirst: async () => options.denied ? null : { id: 15 },
      findUnique: async () => ({ ownerId: userId, title: "Release board", name: "release", owner: { email: "qa@example.invalid" } }),
    },
    section: {
      findFirst: async () => (++sectionReads === 1 ? source : options.noDestination ? null : destination),
      findUnique: async () => source,
      findMany: async () => {
        calls.completionReads++;
        return [source, destination, { id: 3, section_title: "Shipped", isDone: true }];
      },
    },
    task: { count: async () => before.length },
    agent: { findFirst: async ({ where }) => {
      assert.deepEqual(where, { id: agentId, userId });
      return { displayName: "Release agent", userId };
    } },
    $transaction: async (callback) => {
      // The email's durable claim is isolated from the task mutation transaction.
      if (calls.committed) {
        const previous = claimTail;
        let release;
        claimTail = new Promise((resolve) => { release = resolve; });
        await previous;
        try {
          return await callback({
            ...tx,
            $executeRaw: async () => {},
            logs: {
              findFirst: async () => calls.markers[0] ?? null,
              create: async ({ data }) => { calls.markers.push(data); return data; },
            },
          });
        } finally { release(); }
      }
      const result = await callback(tx);
      if (options.rollback) throw new Error("Task transaction rolled back");
      calls.committed = true;
      return result;
    },
  };
  const scheduler = load("src/utils/controllers/notifications/agentFirstTaskEmail.ts", {
    "@vercel/functions": { waitUntil: (work) => {
      assert.equal(calls.committed, true, "email scheduling must follow commit");
      calls.scheduled.push(work);
    } },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/flags": { HTPR_7028_FIRST_TASK_EMAIL_FLAG: "htpr-7028-first-task-email", HTPR_7037_SHARED_EMAIL_LAYOUT_FLAG: "htpr-7037-shared-email-layout", isFeatureEnabled: async () => true },
    "@/lib/mcp/boards/columnRole": load("src/lib/mcp/boards/columnRole.ts", {}),
    "@/lib/telemetry/activationAnalytics": { trackActivation: () => {} },
    "@/lib/email/sendEmail": { sendEmail: async (input) => {
      calls.sent.push(input);
      if (options.sendFailure) throw new Error("Provider unavailable");
      await options.sendBarrier;
    } },
    "@/lib/email/unsubscribe": { unsubscribeHeaders: () => ({}) },
    "@/lib/onboarding/emails/agentFirstTask": { renderAgentFirstTaskEmail: ({ taskTitle }) => ({ subject: "First task", html: taskTitle }) },
    "./emailTemplates": {},
  });
  const service = load(serviceFile, {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/utils/controllers/notifications/agentFirstTaskEmail": scheduler,
    "@/lib/telemetry/activationOccurrences": { recordAgentTaskCompletion: () => {} },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: (id, actor) => {
      assert.equal(id, userId); assert.equal(actor, agentId); return { ownerId: id };
    } },
    "@/utils/generateRank": { default: () => "A0100" },
    "./viewHelpers": { appendSectionToAllViews: async () => {}, updateSectionInAllViews: async () => {}, removeSectionFromAllViews: async () => {} },
  });
  const services = load("src/lib/mcp/sections/services.ts", {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({ ownerId: userId }) },
    "@/utils/controllers/section/sectionService": service,
    "@/lib/mcp/tasks/services": {},
    "@/utils/controllers/agents/boardMembers": {},
  });
  return {
    calls,
    deleteSection: services.deleteSection,
    run: () => service.deleteSection({ sectionId: 1, projectId: 15, userId, agentId }),
    settle: () => Promise.all(calls.scheduled),
  };
}

test("agent section deletion bulk move schedules first completion only after commit", async () => {
  const f = fixture();
  const result = await f.run();
  await f.settle();
  assert.equal(result.status, 204);
  assert.equal(result.movedTaskCount, 2);
  assert.equal(f.calls.locks, 1);
  assert.equal(f.calls.history.length, 2);
  assert.equal(f.calls.scheduled.length, 1);
  assert.equal(f.calls.sent.length, 1, "bulk completion still claims only once per owner");
  assert.equal(f.calls.markerReads, 1);
  assert.equal(f.calls.completionReads, 1);
  assert.equal(f.calls.sent[0].html, "Release review");
});

test("bulk section deletion picks the first eligible task after already-done title matches", async () => {
  const f = fixture({ before: [
    { id: 41, projectId: 15, uniqueIndex: 7027, title: "Already done", sectionId: 3, section: "Doing", status: "Normal" },
    { id: 42, projectId: 15, uniqueIndex: 7028, title: "First eligible", sectionId: null, section: "Doing", status: "Normal" },
    { id: 43, projectId: 15, uniqueIndex: 7029, title: "Later eligible", sectionId: 1, section: "Doing", status: "Normal" },
  ] });
  assert.equal((await f.run()).status, 204);
  await f.settle();
  assert.equal(f.calls.scheduled.length, 1);
  assert.equal(f.calls.completionReads, 1);
  assert.equal(f.calls.sent.length, 1);
  assert.equal(f.calls.sent[0].html, "First eligible");
});

test("large bulk move schedules one job and claimed owners skip completion lookups", async () => {
  const before = Array.from({ length: 100 }, (_, i) => ({
    id: 100 + i, projectId: 15, uniqueIndex: 7028 + i, title: `Task ${i}`, sectionId: 1, section: "Doing", status: "Normal",
  }));
  for (const claimed of [false, true]) {
    const f = fixture({ before, claimed });
    assert.equal((await f.run()).movedTaskCount, 100);
    await f.settle();
    assert.equal(f.calls.history.length, 100);
    assert.equal(f.calls.scheduled.length, 1);
    assert.equal(f.calls.markerReads, 1);
    assert.equal(f.calls.completionReads, claimed ? 0 : 1);
    assert.equal(f.calls.sent.length, claimed ? 0 : 1);
  }
});

test("section deletion human path has no email scheduling or extra row locks", async () => {
  const f = fixture({ human: true });
  assert.equal((await f.run()).status, 204);
  await f.settle();
  assert.equal(f.calls.locks, 0);
  assert.equal(f.calls.scheduled.length, 0);
  assert.equal(f.calls.sent.length, 0);
});

test("section deletion preserves each actual pre-move section including legacy title matches", async () => {
  const f = fixture({ before: [{ id: 42, projectId: 15, uniqueIndex: 7028, title: "Already finished", sectionId: 3, section: "Doing", status: "Normal" }] });
  assert.equal((await f.run()).status, 204);
  await f.settle();
  assert.equal(f.calls.sent.length, 0, "an already-done title match is not a first completion");
});

test("section deletion rolled-back bulk move never schedules email", async () => {
  const f = fixture({ rollback: true });
  await assert.rejects(f.run(), /rolled back/);
  assert.equal(f.calls.committed, false);
  assert.equal(f.calls.scheduled.length, 0);
});

test("section deletion with no destination or denied access does not schedule email", async () => {
  for (const options of [{ noDestination: true }, { denied: true }]) {
    const f = fixture(options);
    assert.equal((await f.run()).status, options.denied ? 403 : 400);
    assert.equal(f.calls.scheduled.length, 0);
  }
});

test("section deletion succeeds while email is pending and after provider failure", async () => {
  let release;
  const f = fixture({ sendBarrier: new Promise((resolve) => { release = resolve; }) });
  assert.equal((await f.run()).status, 204);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.calls.sent.length, 1);
  release();
  await f.settle();
  const failed = fixture({ sendFailure: true });
  assert.equal((await failed.run()).status, 204);
  await assert.doesNotReject(failed.settle());
});

test("MCP, public REST and CLI section deletion retain the authenticated agent into the shared bulk move", () => {
  const operation = read("src/lib/mcp/operations/projects/[projectId]/sections/[sectionId]/operation.ts");
  assert.match(operation, /await deleteSection\(\{\s*projectId,\s*sectionId,\s*userId: user.id\s*\}, ctx.agentId\)/);
  assert.match(read("src/lib/mcp/sections/services.ts"), /sectionService.deleteSection\(\{ sectionId, projectId, userId, agentId \}\)/);
  assert.match(read("src/app/api/mcp/projects/[projectId]/sections/[sectionId]/route.ts"), /DELETE as executeDELETE/);
  assert.match(read("next.config.js"), /source: "\/api\/v1\/:path\*",\s*destination: "\/api\/mcp\/:path\*"/);
});

for (const human of [false, true]) test(`native agent section-delete tool retains actor through completion scheduling (human=${human})`, async () => {
  const f = fixture({ human });
  const { createSectionTool } = load("src/lib/ai/tools/section.ts", {
    ai: { tool: (config) => config },
    zod: require("zod"),
    "@/lib/mcp/sections/services": { deleteSection: f.deleteSection },
    "@/lib/prisma": { __esModule: true, default: {
      section: { findFirst: async () => ({ id: 1, section_title: "Doing" }) },
      task: { count: async () => 2 },
    } },
    "@/lib/realtime/server": { broadcastBoardChange: async () => {} },
    "@/lib/ai/bulkConfirmation": { requireCrossMessageConfirmation: async () => "confirmed" },
    "@/lib/ai/tools/execution": { withToolErrors: (execute) => execute },
    "@/lib/ai/tools/helpers": { sanitizeForJson: (value) => value, assertAccessibleProject: async () => true },
  });
  const tool = createSectionTool({
    user: { id: 985 }, actingAgentId: human ? null : "authenticated-agent",
    sendStatus: () => {}, confirmationSessionId: "local", bulkPreviewsIssued: new Set(),
  }).hypertask_section;
  const result = await tool.execute({ action: "delete", section_id: 1, project_id: 15, confirmed: true });
  assert.equal(result.success, true);
  assert.equal(result.moved_task_count, 2);
  await f.settle();
  assert.equal(f.calls.sent.length, human ? 0 : 1);
});

test("MCP section-delete endpoint reaches completion email with the verified agent", async () => {
  const f = fixture();
  const { DELETE } = load("src/lib/mcp/operations/projects/[projectId]/sections/[sectionId]/operation.ts", {
    "@/lib/mcp/routeWrapper": {
      wrapMcpRoute: (handler) => handler,
      validateMcpRouteAuth: async () => ({ user: { id: 985 }, agentId: "authenticated-agent" }),
      checkMcpRouteRateLimit: async () => null,
    },
    "next/server": { NextResponse: Response },
    "@/lib/prisma": { __esModule: true, default: {} },
    "@/lib/mcp/sections/services": { deleteSection: f.deleteSection },
    "@/lib/realtime/server": { broadcastBoardChange: async () => {} },
  });
  const response = await DELETE(new Request("https://example.invalid/api/mcp/projects/15/sections/1", { method: "DELETE" }), {
    params: Promise.resolve({ projectId: "15", sectionId: "1" }),
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  await f.settle();
  assert.equal(f.calls.sent.length, 1);
});
