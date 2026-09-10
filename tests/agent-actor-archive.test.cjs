/**
 * HTPR-6376: authentication-bound agent actor on MCP archive path, plus
 * Done → Archive/Deleted denial for authenticated agents.
 *
 * Run: npm run test:file -- tests/agent-actor-archive.test.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const MEMBER_USER_ID = 6;
const OTHER_USER_ID = 99;
const MEMBER_PROJECT = 15;
const TASK_ID = 6376;
const CHILD_TASK_ID = 6377;
const DONE_SECTION_ID = 12;
const ACTIVE_SECTION_ID = 10;
const AGENT_ID = "agent-writer-6376";
const OTHER_AGENT_ID = "agent-forged-6376";

process.env.SESSION_SECRET =
  process.env.SESSION_SECRET || "htpr-6376-agent-actor-test-secret";

function compile(relativePath) {
  return ts.transpileModule(fs.readFileSync(path.join(root, relativePath), "utf8"), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
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
const {
  assertAgentMayLeaveDone,
  assertAgentMayLeaveDoneForTasks,
  AgentDoneLifecycleDeniedError,
} = loadTs("src/lib/mcp/tasks/agentDoneLifecycle.ts", {
  "@/lib/mcp/boards/columnRole": loadTs("src/lib/mcp/boards/columnRole.ts"),
});

test("signed sessions round-trip an authentication-bound agent claim", () => {
  const token = signSession({
    id: MEMBER_USER_ID,
    email: "owner@example.com",
    agentId: AGENT_ID,
  });
  const session = verifySession(token);
  assert.equal(session?.id, MEMBER_USER_ID);
  assert.equal(session?.agentId, AGENT_ID);
  assert.equal(verifySession(signSession({ id: MEMBER_USER_ID })).agentId, undefined);
});

test("resolveActingAgent prefers the session claim and rejects forged body ids", () => {
  assert.deepEqual(
    resolveActingAgent({ sessionAgentId: AGENT_ID, bodyAgentId: undefined }),
    { ok: true, agentId: AGENT_ID },
  );
  assert.deepEqual(
    resolveActingAgent({ sessionAgentId: AGENT_ID, bodyAgentId: AGENT_ID }),
    { ok: true, agentId: AGENT_ID },
  );
  assert.equal(
    resolveActingAgent({
      sessionAgentId: AGENT_ID,
      bodyAgentId: OTHER_AGENT_ID,
    }).ok,
    false,
  );
  assert.equal(
    resolveActingAgent({
      sessionAgentId: null,
      bodyAgentId: AGENT_ID,
    }).ok,
    false,
  );
  assert.deepEqual(
    resolveActingAgent({ sessionAgentId: null, bodyAgentId: undefined }),
    { ok: true, agentId: null },
  );
});

function loadArchiveHandler({
  agentLookup = null,
  updateResult = {
    status: 200,
    json: { id: TASK_ID, projectId: MEMBER_PROJECT, status: "Archive" },
  },
} = {}) {
  const sideEffects = {
    updateCalls: [],
    activities: [],
    notifications: [],
    broadcasts: [],
    cancelDueDate: 0,
  };

  const stubs = {
    "@/lib/prisma": {
      __esModule: true,
      default: {
        agent: {
          findFirst: async (args) => {
            if (!agentLookup) return null;
            if (
              args.where.id === agentLookup.id &&
              args.where.userId === agentLookup.userId &&
              args.where.revokedAt === null
            ) {
              return agentLookup;
            }
            return null;
          },
        },
      },
    },
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
    "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove": {
      __esModule: true,
      default: async (...args) => {
        sideEffects.notifications.push(args);
      },
    },
    "@/utils/controllers/activities/createArchiveActivity": {
      __esModule: true,
      default: async (args) => {
        sideEffects.activities.push(args);
      },
    },
    "@/models/model": {},
    "../queues/duedateQueue": {
      cancelDueDateJob: async () => {
        sideEffects.cancelDueDate += 1;
      },
    },
    "@/utils/controllers/tasks/single": {
      updateTaskSingle: async (newTask, user, agentId) => {
        sideEffects.updateCalls.push({ newTask, user, agentId });
        return updateResult;
      },
    },
    "@/utils/controllers/notifications/broadcastInboxForTask": {
      broadcastInboxForTask: async () => undefined,
    },
    "@/lib/realtime/server": {
      broadcastBoardChange: (...args) => sideEffects.broadcasts.push(["board", ...args]),
      broadcastTaskChange: (...args) => sideEffects.broadcasts.push(["task", ...args]),
    },
  };

  const handler = execute(compile("src/pages/api/tasks/(un)archive.ts"), stubs).default;
  return { handler, sideEffects };
}

async function callArchive(handler, {
  taskId = TASK_ID,
  status = "Archive",
  agentId,
  sessionAgentId = null,
  sessionUserId = MEMBER_USER_ID,
  cookieUserId = MEMBER_USER_ID,
  sessionToken,
  omitSession = false,
} = {}) {
  const cookies = {
    nookies_user: JSON.stringify({
      id: cookieUserId,
      displayName: "Member",
    }),
  };
  const cookieParts = [
    `nookies_user=${encodeURIComponent(cookies.nookies_user)}`,
  ];
  if (!omitSession) {
    const token =
      sessionToken ??
      signSession({
        id: sessionUserId,
        email: "owner@example.com",
        ...(sessionAgentId ? { agentId: sessionAgentId } : {}),
      });
    cookies[SESSION_COOKIE] = token;
    cookieParts.push(`${SESSION_COOKIE}=${token}`);
  }
  const body = { taskId, status };
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

function emptySideEffects(sideEffects) {
  assert.equal(sideEffects.updateCalls.length, 0);
  assert.equal(sideEffects.activities.length, 0);
  assert.equal(sideEffects.notifications.length, 0);
  assert.equal(sideEffects.broadcasts.length, 0);
  assert.equal(sideEffects.cancelDueDate, 0);
}

test("archive records the authenticated agent when the session claim is present", async () => {
  const agent = {
    id: AGENT_ID,
    userId: MEMBER_USER_ID,
    displayName: "Writer",
    photoURL: null,
  };
  const { handler, sideEffects } = loadArchiveHandler({ agentLookup: agent });
  const result = await callArchive(handler, {
    sessionAgentId: AGENT_ID,
    agentId: AGENT_ID,
  });

  assert.equal(result.status, 200);
  assert.equal(sideEffects.updateCalls.length, 1);
  assert.equal(sideEffects.updateCalls[0].agentId, AGENT_ID);
  assert.equal(sideEffects.activities[0].fromAgent.id, AGENT_ID);
  assert.equal(sideEffects.notifications[0][4], AGENT_ID);
});

test("archive uses the session agent even when the body omits agentId", async () => {
  const agent = {
    id: AGENT_ID,
    userId: MEMBER_USER_ID,
    displayName: "Writer",
    photoURL: null,
  };
  const { handler, sideEffects } = loadArchiveHandler({ agentLookup: agent });
  const result = await callArchive(handler, {
    sessionAgentId: AGENT_ID,
  });

  assert.equal(result.status, 200);
  assert.equal(sideEffects.updateCalls[0].agentId, AGENT_ID);
  assert.equal(sideEffects.activities[0].fromAgent.id, AGENT_ID);
});

test("archive rejects a body agentId that mismatches the session claim", async () => {
  const { handler, sideEffects } = loadArchiveHandler({
    agentLookup: {
      id: AGENT_ID,
      userId: MEMBER_USER_ID,
      displayName: "Writer",
      photoURL: null,
    },
  });
  const result = await callArchive(handler, {
    sessionAgentId: AGENT_ID,
    agentId: OTHER_AGENT_ID,
  });

  assert.equal(result.status, 403);
  emptySideEffects(sideEffects);
});

test("archive rejects a forged body agentId without an agent session claim", async () => {
  const { handler, sideEffects } = loadArchiveHandler();
  const result = await callArchive(handler, {
    sessionAgentId: null,
    agentId: AGENT_ID,
  });

  assert.equal(result.status, 403);
  emptySideEffects(sideEffects);
});

test("human archive with a verified session and no agent claim still succeeds", async () => {
  const { handler, sideEffects } = loadArchiveHandler();
  const result = await callArchive(handler, {
    sessionAgentId: null,
  });

  assert.equal(result.status, 200);
  assert.equal(sideEffects.updateCalls[0].agentId, null);
  assert.equal(sideEffects.updateCalls[0].user.id, MEMBER_USER_ID);
  assert.equal(sideEffects.activities[0].fromAgent, null);
  assert.equal(sideEffects.notifications[0][4], null);
});

test("archive rejects an absent signed session and ignores unsigned cookie identity", async () => {
  const { handler, sideEffects } = loadArchiveHandler();
  const result = await callArchive(handler, {
    omitSession: true,
    cookieUserId: MEMBER_USER_ID,
  });

  assert.equal(result.status, 401);
  emptySideEffects(sideEffects);
});

test("archive rejects a tampered signed session", async () => {
  const { handler, sideEffects } = loadArchiveHandler();
  const valid = signSession({ id: MEMBER_USER_ID, email: "owner@example.com" });
  const tampered = `${valid.slice(0, -4)}zzzz`;
  const result = await callArchive(handler, {
    sessionToken: tampered,
    cookieUserId: MEMBER_USER_ID,
  });

  assert.equal(result.status, 401);
  emptySideEffects(sideEffects);
});

test("archive uses the verified session user when the unsigned cookie disagrees", async () => {
  const { handler, sideEffects } = loadArchiveHandler();
  const result = await callArchive(handler, {
    sessionUserId: MEMBER_USER_ID,
    cookieUserId: OTHER_USER_ID,
  });

  assert.equal(result.status, 200);
  assert.equal(sideEffects.updateCalls[0].user.id, MEMBER_USER_ID);
  assert.notEqual(sideEffects.updateCalls[0].user.id, OTHER_USER_ID);
});

test("denied writes skip archive side effects when updateTaskSingle refuses", async () => {
  const { handler, sideEffects } = loadArchiveHandler({
    agentLookup: {
      id: AGENT_ID,
      userId: MEMBER_USER_ID,
      displayName: "Writer",
      photoURL: null,
    },
    updateResult: {
      status: 403,
      json: {
        message: "Authenticated agents cannot archive or delete tasks in Done",
        code: "agent_done_lifecycle_denied",
      },
    },
  });
  const result = await callArchive(handler, {
    sessionAgentId: AGENT_ID,
    agentId: AGENT_ID,
  });

  assert.equal(result.status, 403);
  assert.equal(sideEffects.updateCalls.length, 1);
  assert.equal(sideEffects.activities.length, 0);
  assert.equal(sideEffects.notifications.length, 0);
  assert.equal(sideEffects.broadcasts.length, 0);
  assert.equal(sideEffects.cancelDueDate, 0);
});

test("authenticated agents cannot Archive or Delete a Done task", async () => {
  const calls = { updates: 0, findMany: 0 };
  const tx = {
    section: {
      findMany: async ({ where }) => {
        calls.findMany += 1;
        assert.deepEqual(where.id.in, [DONE_SECTION_ID]);
        return [{ id: DONE_SECTION_ID, section_title: "Done", isDone: true }];
      },
    },
    task: {
      update: async () => {
        calls.updates += 1;
        throw new Error("should not mutate");
      },
      updateMany: async () => {
        calls.updates += 1;
        throw new Error("should not mutate");
      },
    },
  };

  await assert.rejects(
    () =>
      assertAgentMayLeaveDone(
        tx,
        { sectionId: DONE_SECTION_ID, status: "Normal" },
        "Archive",
        AGENT_ID,
      ),
    (error) =>
      error instanceof AgentDoneLifecycleDeniedError &&
      error.code === "agent_done_lifecycle_denied",
  );
  await assert.rejects(
    () =>
      assertAgentMayLeaveDone(
        tx,
        { sectionId: DONE_SECTION_ID, status: "Normal" },
        "Deleted",
        AGENT_ID,
      ),
    AgentDoneLifecycleDeniedError,
  );
  assert.equal(calls.updates, 0);
  assert.ok(calls.findMany >= 1);
});

test("a Done descendant blocks agent soft-delete before any tree mutation", async () => {
  const calls = { updates: 0, notifications: 0 };
  const tx = {
    section: {
      findMany: async ({ where }) => {
        assert.deepEqual(
          [...where.id.in].sort((a, b) => a - b),
          [ACTIVE_SECTION_ID, DONE_SECTION_ID],
        );
        return [
          { id: ACTIVE_SECTION_ID, section_title: "In Progress", isDone: false },
          { id: DONE_SECTION_ID, section_title: "Done", isDone: true },
        ];
      },
    },
    task: {
      updateMany: async () => {
        calls.updates += 1;
        throw new Error("should not mutate after Done descendant denial");
      },
    },
    notification: {
      deleteMany: async () => {
        calls.notifications += 1;
        throw new Error("should not clear notifications after denial");
      },
    },
  };

  await assert.rejects(
    () =>
      assertAgentMayLeaveDoneForTasks(
        tx,
        [
          {
            id: TASK_ID,
            sectionId: ACTIVE_SECTION_ID,
            status: "Normal",
          },
          {
            id: CHILD_TASK_ID,
            sectionId: DONE_SECTION_ID,
            status: "Normal",
          },
        ],
        "Deleted",
        AGENT_ID,
      ),
    AgentDoneLifecycleDeniedError,
  );
  assert.equal(calls.updates, 0);
  assert.equal(calls.notifications, 0);
});

test("soft-delete tree path checks every locked task before updateMany", () => {
  const source = fs.readFileSync(
    path.join(root, "src/pages/api/queues/tasks/taskDeleteReminder.ts"),
    "utf8",
  );
  assert.match(source, /assertAgentMayLeaveDoneForTasks/);
  assert.match(source, /SELECT id, status, "sectionId", "hardDeleteProcessingAt"/);
  assert.doesNotMatch(
    source,
    /assertAgentMayLeaveDone\(\s*tx,\s*root/,
  );
  assert.before = undefined;
  const guardAt = source.indexOf("assertAgentMayLeaveDoneForTasks");
  const mutateAt = source.indexOf("await tx.task.updateMany");
  assert.ok(guardAt > 0 && mutateAt > guardAt);
});

test("humans may Archive Done tasks and agents may archive non-Done work", async () => {
  const tx = {
    section: {
      findMany: async ({ where }) => {
        return where.id.in.map((id) =>
          id === DONE_SECTION_ID
            ? { id, section_title: "Done", isDone: true }
            : { id, section_title: "In Progress", isDone: false },
        );
      },
    },
  };

  await assertAgentMayLeaveDone(
    tx,
    { sectionId: DONE_SECTION_ID, status: "Normal" },
    "Archive",
    null,
  );
  await assertAgentMayLeaveDone(
    tx,
    { sectionId: ACTIVE_SECTION_ID, status: "Normal" },
    "Archive",
    AGENT_ID,
  );
});

test("MCP updateTask signs the internal session with ctx.agentId", () => {
  const source = fs.readFileSync(
    path.join(root, "src/lib/mcp/tasks/updateTask.ts"),
    "utf8",
  );
  assert.match(
    source,
    /signSession\(\{\s*id: userObj\.id,\s*email: userObj\.email,\s*\.\.\.\(ctx\.agentId \? \{ agentId: ctx\.agentId \} : \{\}\),?\s*\}\)/,
  );
});

test("Done guard documents current-section-only limit", () => {
  const source = fs.readFileSync(
    path.join(root, "src/lib/mcp/tasks/agentDoneLifecycle.ts"),
    "utf8",
  );
  assert.match(source, /current section only/i);
  assert.match(source, /out of Done[\s\S]*archives\/deletes/i);
  assert.match(source, /not immutable human-final-review/i);
});
