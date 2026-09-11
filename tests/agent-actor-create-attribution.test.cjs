/**
 * HTPR-6362: agent creator attribution on MCP task create / get.
 *
 * Run: npm run test:file -- tests/agent-actor-create-attribution.test.cjs
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const MEMBER_USER_ID = 6;
const AGENT_ID = "31e8c179-66b5-4d73-924b-7db7dcf997b6";
const OTHER_AGENT_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const PROJECT_ID = 5156;

process.env.SESSION_SECRET =
  process.env.SESSION_SECRET || "htpr-6362-agent-create-test-secret";

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

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const { signSession, verifySession } = loadTs("src/lib/auth/session.ts");
const { resolveActingAgent } = loadTs("src/lib/auth/resolveActingAgent.ts");

const jiti = require("jiti")(__filename, {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});
const { mapTaskToDetail, mapTaskToMcpGetResponse, mapTaskCreatedBy } = jiti(
  path.join(root, "src/lib/mcp/tasks/mappers.ts"),
);

const visibleAgent = {
  id: AGENT_ID,
  displayName: "Last30Days",
  photoURL: null,
  userId: MEMBER_USER_ID,
  visibility: "BOARD",
  members: [{ projectId: PROJECT_ID }],
};

const hiddenAgent = {
  id: OTHER_AGENT_ID,
  displayName: "Ghost",
  photoURL: null,
  userId: 999,
  visibility: "PRIVATE",
  members: [],
};

const baseTask = {
  id: 39282,
  uniqueIndex: 45,
  projectId: PROJECT_ID,
  title: "Research",
  description: "",
  section: "Backlog",
  sectionId: 1,
  status: "Normal",
  project: { title: "Hypertask Factory", staleWarnDays: null, staleHotDays: null },
  createdAt: new Date("2026-09-10T07:28:38.832Z"),
  updatedAt: new Date("2026-09-10T07:28:38.832Z"),
  permanentlyDeleteAt: null,
  user: {
    id: MEMBER_USER_ID,
    email: "valentin.yeo@gmail.com",
    displayName: "Valentin Yeo",
  },
  _count: { comments: 0 },
};

test("signed sessions round-trip the create-path agent claim", () => {
  const token = signSession({
    id: MEMBER_USER_ID,
    email: "valentin.yeo@gmail.com",
    agentId: AGENT_ID,
  });
  const session = verifySession(token);
  assert.equal(session?.id, MEMBER_USER_ID);
  assert.equal(session?.agentId, AGENT_ID);
});

test("resolveActingAgent rejects body-only agent impersonation on create", () => {
  assert.equal(
    resolveActingAgent({ sessionAgentId: null, bodyAgentId: AGENT_ID }).ok,
    false,
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
  assert.deepEqual(
    resolveActingAgent({ sessionAgentId: null, bodyAgentId: undefined }),
    { ok: true, agentId: null },
  );
});

test("mapTaskCreatedBy nests the visible creating agent under createdBy", () => {
  const createdBy = mapTaskCreatedBy(
    baseTask.user,
    visibleAgent,
    MEMBER_USER_ID,
    PROJECT_ID,
  );
  assert.equal(createdBy.id, MEMBER_USER_ID);
  assert.deepEqual(createdBy.agent, {
    id: AGENT_ID,
    displayName: "Last30Days",
  });
});

test("human create keeps createdBy without a nested agent", () => {
  const createdBy = mapTaskCreatedBy(
    baseTask.user,
    null,
    MEMBER_USER_ID,
    PROJECT_ID,
  );
  assert.equal(createdBy.agent, undefined);
});

test("private creating agents are redacted from createdBy", () => {
  const createdBy = mapTaskCreatedBy(
    baseTask.user,
    hiddenAgent,
    MEMBER_USER_ID,
    PROJECT_ID,
  );
  assert.equal(createdBy.agent, undefined);
});

test("mapTaskToDetail nests agent under createdBy and keeps top-level agent", () => {
  const out = mapTaskToDetail(
    { ...baseTask, agent: visibleAgent },
    MEMBER_USER_ID,
  );
  assert.deepEqual(out.createdBy.agent, {
    id: AGENT_ID,
    displayName: "Last30Days",
  });
  assert.deepEqual(out.agent, {
    id: AGENT_ID,
    displayName: "Last30Days",
  });
});

test("mapTaskToMcpGetResponse nests agent under createdBy", () => {
  const out = mapTaskToMcpGetResponse(
    { ...baseTask, agent: visibleAgent, assignees: [] },
    MEMBER_USER_ID,
  );
  assert.deepEqual(out.createdBy.agent, {
    id: AGENT_ID,
    displayName: "Last30Days",
  });
  assert.deepEqual(out.agent, {
    id: AGENT_ID,
    displayName: "Last30Days",
  });
});

test("MCP createTask signs the internal hop with the authenticated agentId", () => {
  const source = read("src/lib/mcp/tasks/services.ts");
  assert.match(
    source,
    /signSession\(\{\s*id: user\.id,\s*email: user\.email,\s*\.\.\.\(agentId \? \{ agentId \} : \{\}\),\s*\}\)/,
  );
});

test("createGlobally resolves acting agent from the signed session claim", () => {
  const source = read("src/pages/api/tasks/createGlobally.ts");
  assert.match(source, /resolveActingAgent\(/);
  assert.match(source, /sessionAgentId: signedSession\?\.agentId/);
  assert.match(source, /bodyAgentId: requestedAgentId/);
  assert.doesNotMatch(
    source,
    /typeof requestedAgentId === "string" && requestedAgentId\.length > 0\s*\? requestedAgentId/,
  );
});

test("browser create helper does not send an acting agentId field", () => {
  const source = read(
    "src/utils/api/global/apiHelpers/createTaskGloballycontroller.ts",
  );
  assert.doesNotMatch(source, /agentId/);
});
