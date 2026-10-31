const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const FLAG = "htpr-7519-login-guided-start";
let loads = 0;

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function loadHello(flagOn, agentLookups, options = {}) {
  const projects = options.projects ?? [
    { id: 1, name: "alpha", title: "Alpha", playbook: null, createdAt: new Date("2026-01-01"), ai_custom_instructions: [] },
    { id: 9142, name: "launch", title: "Product Launch", playbook: null, createdAt: new Date("2026-10-21"), ai_custom_instructions: [] },
  ];
  stubModule("src/lib/prisma.ts", {
    default: {
      project: {
        findMany: async (args) => { options.projectLookups?.findMany.push(args); return projects; },
        findFirst: async (args) => { options.projectLookups?.findFirst.push(args); return options.newestBoard === undefined ? projects[1] ?? null : options.newestBoard; },
      },
      agent: { findUnique: async (args) => {
        if (args.select.permissions) { options.roleLookups?.push(args.where.id); return { permissions: options.permissions ?? null }; }
        agentLookups.push(args.where.id);
        return { id: args.where.id, displayName: "Claude Code" };
      } },
    },
  });
  stubModule("src/lib/flags.ts", {
    isFeatureEnabled: async (key, userId) => {
      options.flagCalls?.push([key, userId]);
      return key === FLAG ? flagOn : false;
    },
  });
  stubModule("src/lib/mcp/auth.ts", {
    checkMcpRateLimit: async () => null,
    createUnauthorizedResponse: () => null,
    validateMcpAuth: async () => null,
  });
  stubModule("src/utils/controllers/projects/getAllIncludes.ts", { getProjectListingWhere: (userId, agentId) => ({ teamId: { not: null }, members: { some: { agentId, agent: { userId, revokedAt: null } } } }) });
  delete require.cache[path.join(root, "src/lib/mcp/hello/getHelloPayload.ts")];
  delete require.cache[path.join(root, "src/lib/mcp/agents/scopes.ts")];
  const jiti = createJiti(path.join(root, `tests/htpr-7519-hello-loader-${++loads}.cjs`), {
    alias: { "@": path.join(root, "src") },
    interopDefault: true,
  });
  return jiti(path.join(root, "src/lib/mcp/hello/getHelloPayload.ts"));
}

const user = { id: 6, displayName: "Maria Lopez", email: "m@example.test" };

test("flag on, agent token: hello names the agent, starts on the newest board and lists 3 steps", async () => {
  const lookups = [];
  const payload = await loadHello(true, lookups).getHelloPayload({ user, agentId: "agent-1" });
  assert.deepEqual(payload.agent, { id: "agent-1", displayName: "Claude Code" });
  assert.equal(payload.startBoard.id, 9142);
  assert.deepEqual(payload.nextSteps.map((s) => s.command), [
    "hypertask task list --project 9142",
    'hypertask task create --project 9142 --title "My first task"',
    "hypertask project playbook 9142",
  ]);
  assert.deepEqual(lookups, ["agent-1"]);
});

for (const role of ["read", "write", "admin"]) {
  test(`hello uses the permanent consolidated catalog and permissions role=${role}`, async () => {
    const flagCalls = [];
    const roleLookups = [];
    const payload = await loadHello(true, [], { permissions: { role }, flagCalls, roleLookups })
      .getHelloPayload({ user, agentId: "agent-1" });
    assert.deepEqual(roleLookups, ["agent-1"]);
    assert.deepEqual(flagCalls.filter(([key]) => key === "htpr-6804-mcp-tools"), []);
    const expected = [
      ["hypertask_tasks", { action: "list", input: { project_id: 9142 } }],
      ...(role === "read" ? [] : [["hypertask_tasks", { action: "create", input: { project_id: 9142, title: "My first task" } }]]),
      ["hypertask_projects", { action: "playbook", input: { project_id: 9142 } }],
    ];
    assert.deepEqual(payload.nextSteps.map((step) => [step.tool, step.arguments]), expected);
    assert.deepEqual(payload.agent, { id: "agent-1", displayName: "Claude Code" });
  });
}

test("newest board with no title falls back to its name", async () => {
  const newestBoard = { id: 9142, title: null, name: "launch" };
  const payload = await loadHello(true, [], { newestBoard }).getHelloPayload({ user, agentId: "agent-1" });
  assert.equal(payload.startBoard.title, "launch");
});

test("flag on, user token: no agent lookup, agent is null", async () => {
  const lookups = [];
  const payload = await loadHello(true, lookups).getHelloPayload({ user, agentId: null });
  assert.equal(payload.agent, null);
  assert.equal(payload.nextSteps.length, 3);
  assert.deepEqual(lookups, []);
});

test("flag off: unchanged payload and no agent or newest-board lookup", async () => {
  const lookups = [];
  const projectLookups = { findMany: [], findFirst: [] };
  const roleLookups = [];
  const flagCalls = [];
  const hello = loadHello(false, lookups, { projectLookups, roleLookups, flagCalls });
  const payload = await hello.getHelloPayload({ user, agentId: "agent-1" });
  assert.deepEqual(projectLookups.findFirst, []);
  assert.deepEqual(roleLookups, []);
  assert.equal(flagCalls.some(([key]) => key === "htpr-6804-mcp-tools"), false);
  assert.equal(JSON.stringify(payload), JSON.stringify({
    user,
    boards: [
      { id: 1, name: "alpha", title: "Alpha", boardUrl: "https://app.hypertask.ai/project?id=1", taskUrlTemplate: "https://app.hypertask.ai/detail/project-1/{taskNumber}" },
      { id: 9142, name: "launch", title: "Product Launch", boardUrl: "https://app.hypertask.ai/project?id=9142", taskUrlTemplate: "https://app.hypertask.ai/detail/project-9142/{taskNumber}" },
    ],
    urlFormats: hello.HELLO_URL_FORMATS,
    boardsTotal: 2,
    boardsTruncated: false,
    capabilities: hello.HELLO_CAPABILITIES,
    conventions: [],
    conventionsTruncated: false,
  }));
  for (const key of ["agent", "startBoard", "nextSteps"]) assert.equal(key in payload, false, key);
  assert.deepEqual(lookups, []);
  assert.deepEqual(payload.boards.map((b) => Object.keys(b)), [
    ["id", "name", "title", "boardUrl", "taskUrlTemplate"],
    ["id", "name", "title", "boardUrl", "taskUrlTemplate"],
  ]);
});

test("newest board outside the 50-board listing is the start board with the same visibility filter", async () => {
  const projects = Array.from({ length: 50 }, (_, i) => ({
    id: i + 1, name: `old-${i}`, title: `Old ${i}`, playbook: null,
    createdAt: new Date("2026-01-01"), ai_custom_instructions: [],
  }));
  const newestBoard = { id: 9142, title: "Zulu Launch", name: "launch" };
  const projectLookups = { findMany: [], findFirst: [] };
  const payload = await loadHello(true, [], { projects, newestBoard, projectLookups })
    .getHelloPayload({ user, agentId: "agent-1" });
  assert.equal(payload.boards.length, 50);
  assert.equal(payload.boards.some((board) => board.id === newestBoard.id), false);
  assert.deepEqual(payload.startBoard, {
    id: 9142, title: "Zulu Launch", boardUrl: "https://app.hypertask.ai/project?id=9142",
  });
  assert.deepEqual(payload.nextSteps.map((step) => step.arguments.input.project_id), [9142, 9142, 9142]);
  assert.deepEqual(payload.nextSteps.map((step) => step.command), [
    "hypertask task list --project 9142",
    'hypertask task create --project 9142 --title "My first task"',
    "hypertask project playbook 9142",
  ]);
  assert.equal(projectLookups.findMany.length, 1);
  assert.equal(projectLookups.findFirst.length, 1);
  assert.deepEqual(projectLookups.findFirst[0].where, projectLookups.findMany[0].where);
  assert.deepEqual(projectLookups.findFirst[0].orderBy, [{ createdAt: "desc" }, { id: "desc" }]);
  assert.deepEqual(projectLookups.findFirst[0].select, { id: true, title: true, name: true });
});

test("flag ships on Everyone as a feature", () => {
  const definition = createJiti(__filename, { interopDefault: true })(
    path.join(root, "src/lib/flags/definitions/htpr-7519-login-guided-start.ts"),
  );
  const flag = definition.default ?? definition;
  assert.equal(flag.key, FLAG);
  assert.equal(flag.kind, "feature");
  assert.equal(flag.defaultMode, "EVERYONE");
});
