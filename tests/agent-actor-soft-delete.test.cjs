/**
 * HTPR-6376: soft-delete handler must resolve the actor from the signed
 * session claim, same as (un)archive. Omitting body.agentId must not bypass
 * the Done tree guard.
 *
 * Run: npm run test:file -- tests/agent-actor-soft-delete.test.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const MEMBER_USER_ID = 6;
const TASK_ID = 6376;
const DONE_SECTION_ID = 12;
const ACTIVE_SECTION_ID = 10;
const AGENT_ID = "agent-writer-6376";
const OTHER_AGENT_ID = "agent-forged-6376";

process.env.SESSION_SECRET =
  process.env.SESSION_SECRET || "htpr-6376-agent-actor-test-secret";

function compile(relativePath) {
  return ts.transpileModule(
    fs.readFileSync(path.join(root, relativePath), "utf8"),
    {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
}

function execute(javascript, stubs) {
  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) =>
    stubs[request] ?? originalLoad(request, parent, isMain);
  try {
    const mod = { exports: {} };
    new Function("module", "exports", "require", javascript)(
      mod,
      mod.exports,
      (request) => stubs[request] ?? require(request),
    );
    return mod.exports;
  } finally {
    Module._load = originalLoad;
  }
}

function loadTs(relativePath, stubs = {}) {
  return execute(compile(relativePath), stubs);
}

function cookieValue(header, name) {
  if (!header) return undefined;
  const match = String(header)
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return match ? match.slice(name.length + 1) : undefined;
}

const { signSession, verifySession, SESSION_COOKIE } = loadTs(
  "src/lib/auth/session.ts",
);
const { resolveActingAgent } = loadTs("src/lib/auth/resolveActingAgent.ts");
const agentDoneLifecycle = loadTs("src/lib/mcp/tasks/agentDoneLifecycle.ts", {
  "@/lib/mcp/boards/columnRole": loadTs("src/lib/mcp/boards/columnRole.ts"),
});

function loadDeleteHandler({ sectionId = ACTIVE_SECTION_ID } = {}) {
  const sideEffects = {
    treeAgentIds: [],
    updateMany: 0,
    scheduledJobs: 0,
    leaseChecks: 0,
  };

  const tx = {
    $queryRaw: async (query) => {
      const text = String(query);
      if (text.includes("FOR UPDATE")) {
        return [
          {
            id: TASK_ID,
            status: "Normal",
            sectionId,
            hardDeleteProcessingAt: null,
          },
        ];
      }
      return [{ id: TASK_ID }];
    },
    task: {
      updateMany: async () => {
        sideEffects.updateMany += 1;
        return { count: 1 };
      },
      update: async () => ({}),
      findUniqueOrThrow: async () => ({
        id: TASK_ID,
        subTasks: [],
        parentTask: null,
      }),
    },
    notification: {
      deleteMany: async () => ({ count: 0 }),
    },
    section: {
      findMany: async ({ where }) =>
        where.id.in.map((id) =>
          id === DONE_SECTION_ID
            ? { id, section_title: "Done", isDone: true }
            : { id, section_title: "In Progress", isDone: false },
        ),
    },
  };

  const stubs = {
    "date-fns": { subMinutes: (date) => date },
    sugar: {
      Date: {
        create: () => new Date("2026-10-11T00:00:00.000Z"),
      },
    },
    "@/lib/prisma": {
      __esModule: true,
      default: {
        task: {
          findFirst: async () => ({ id: TASK_ID }),
        },
        agent: {
          findFirst: async (args) => {
            if (
              args.where.id === AGENT_ID &&
              args.where.userId === MEMBER_USER_ID &&
              args.where.revokedAt === null
            ) {
              return { id: AGENT_ID };
            }
            return null;
          },
        },
        $transaction: async (fn) => fn(tx),
      },
    },
    "@/lib/constants": {
      __esModule: true,
      default: { TaskDeletePrefixKey: "task-delete-" },
    },
    "@/utils/controllers/projects/getAllIncludes": {
      taskWriteAccessWhere: (userId, agentId) => ({ userId, agentId }),
    },
    "@/lib/mcp/tasks/agentMutationFence": {
      AgentMutationLeaseConflictError: class extends Error {},
      assertAgentAssignmentChangeAllowed: async () => {
        sideEffects.leaseChecks += 1;
      },
      cancelAgentMutationLeaseForHumanOverride: async () => undefined,
    },
    "@/lib/mcp/tasks/agentDoneLifecycle": {
      ...agentDoneLifecycle,
      assertAgentMayLeaveDoneForTasks: async (transaction, tasks, status, agentId) => {
        sideEffects.treeAgentIds.push(agentId ?? null);
        return agentDoneLifecycle.assertAgentMayLeaveDoneForTasks(
          transaction,
          tasks,
          status,
          agentId,
        );
      },
    },
    "@prisma/client": { Prisma: { join: (ids) => ids } },
    "@/lib/auth/getSessionUser": {
      getSessionUser: async (headers) => {
        const token = cookieValue(headers.get("cookie"), SESSION_COOKIE);
        const session = verifySession(token);
        if (!session) return null;
        return {
          userId: session.id,
          source: "legacy",
          needsBridge: true,
        };
      },
    },
    "@/lib/auth/session": {
      SESSION_COOKIE,
      verifySession,
      signSession,
    },
    "@/lib/auth/resolveActingAgent": { resolveActingAgent },
    "../taskDeleteQueue": {
      scheduleTaskDeleteJob: async () => {
        sideEffects.scheduledJobs += 1;
      },
    },
  };

  const mod = execute(
    compile("src/pages/api/queues/tasks/taskDeleteReminder.ts"),
    stubs,
  );
  return { handler: mod.default, sideEffects };
}

async function callDelete(handler, {
  agentId,
  sessionAgentId = null,
  sessionUserId = MEMBER_USER_ID,
  omitSession = false,
} = {}) {
  const cookies = {};
  const cookieParts = [];
  if (!omitSession) {
    const token = signSession({
      id: sessionUserId,
      email: "owner@example.com",
      ...(sessionAgentId ? { agentId: sessionAgentId } : {}),
    });
    cookies[SESSION_COOKIE] = token;
    cookieParts.push(`${SESSION_COOKIE}=${token}`);
  }
  const body = { taskId: TASK_ID };
  if (agentId !== undefined) body.agentId = agentId;

  const req = {
    method: "POST",
    body,
    cookies,
    headers: { cookie: cookieParts.join("; ") },
  };
  let statusCode = 0;
  let payload;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(bodyJson) {
      payload = bodyJson;
      return this;
    },
  };
  await handler(req, res);
  return { status: statusCode, payload };
}

test("signed agent soft-delete omitting body agentId still hits the Done tree guard", async () => {
  const { handler, sideEffects } = loadDeleteHandler({
    sectionId: DONE_SECTION_ID,
  });
  const result = await callDelete(handler, {
    sessionAgentId: AGENT_ID,
    // body.agentId intentionally omitted
  });

  assert.equal(result.status, 403);
  assert.equal(result.payload.code, "agent_done_lifecycle_denied");
  assert.deepEqual(sideEffects.treeAgentIds, [AGENT_ID]);
  assert.equal(sideEffects.updateMany, 0);
  assert.equal(sideEffects.scheduledJobs, 0);
});

test("soft-delete rejects a body agentId that mismatches the signed session claim", async () => {
  const { handler, sideEffects } = loadDeleteHandler({
    sectionId: ACTIVE_SECTION_ID,
  });
  const result = await callDelete(handler, {
    sessionAgentId: AGENT_ID,
    agentId: OTHER_AGENT_ID,
  });

  assert.equal(result.status, 403);
  assert.equal(sideEffects.treeAgentIds.length, 0);
  assert.equal(sideEffects.updateMany, 0);
  assert.equal(sideEffects.scheduledJobs, 0);
  assert.equal(sideEffects.leaseChecks, 0);
});

test("legitimate human soft-delete without an agent claim still succeeds", async () => {
  const { handler, sideEffects } = loadDeleteHandler({
    sectionId: DONE_SECTION_ID,
  });
  const result = await callDelete(handler, {
    sessionAgentId: null,
  });

  assert.equal(result.status, 200);
  assert.deepEqual(sideEffects.treeAgentIds, [null]);
  assert.equal(sideEffects.updateMany, 1);
  assert.equal(sideEffects.scheduledJobs, 1);
});
