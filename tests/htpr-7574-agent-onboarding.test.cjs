const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { z } = require("zod");

const root = path.resolve(__dirname, "..");
const selfRefusal = "An agent cannot change its own board access. Ask the person who owns this agent to open Agents, pick this agent, and add the board under Board access.";
const genericHint = "Access denied. Use a credential with the required scope and confirm membership in the target board.";
const nextServer = { NextResponse: { json: (body, init) => Response.json(body, init) } };

function load(relativePath, mocks = {}) {
  const filename = path.join(root, relativePath);
  const javascript = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
  const loaded = new Module(filename);
  loaded.filename = filename;
  loaded.require = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    if (specifier === "zod") return { z };
    if (specifier === "next/server") return nextServer;
    throw new Error(`Unexpected import in ${relativePath}: ${specifier}`);
  };
  loaded._compile(javascript, filename);
  return loaded.exports;
}

function delegation(role, actingBoards = [15], enforce = false) {
  let roleReads = 0;
  const scopes = load("src/lib/mcp/agents/scopes.ts", {
    "@/lib/prisma": { __esModule: true, default: {
      agent: { findUnique: async () => {
        roleReads += 1;
        return { permissions: { role } };
      } },
    } },
  });
  const { checkAgentBoardDelegation } = load("src/lib/mcp/agents/delegatedAccess.ts", {
    "@/lib/mcp/agents/scopes": scopes,
  });
  const updates = load("src/lib/mcp/agents/updateBoards.ts", {
    "@/lib/auth/agentScope": {
      agentScopeEnforced: () => enforce,
      recordAgentBoardScopeMiss: () => {},
    },
    "@/lib/mcp/managementKeyTeamScope": { agentWithinTeamWhere: () => ({}) },
  });
  const writes = [];
  const database = { $transaction: async (run, options) => {
    assert.equal(options.isolationLevel, "Serializable");
    return run({
      agent: { findFirst: async ({ where }) => {
        assert.equal(where.userId, 6);
        return where.id === "other" ? { id: "other", userId: 6, members: [] } : null;
      } },
      member: {
        findMany: async ({ where }) => {
          assert.equal(where.agentId, "acting");
          if (enforce) {
            assert.equal(where.status, "Accepted");
            assert.deepEqual(where.agent, { userId: 6, revokedAt: null });
          }
          return actingBoards.filter((id) => where.projectId.in.includes(id))
            .map((projectId) => ({ projectId }));
        },
        createMany: async ({ data }) => {
          writes.push(...data);
          return { count: data.length };
        },
        deleteMany: async () => { throw new Error("Unexpected removal"); },
      },
    });
  } };
  const ctx = { user: { id: 6 }, agentId: "acting" };
  return {
    check: (target, context = ctx) => checkAgentBoardDelegation(context, target),
    change: (projectId) => updates.updateOwnedAgentBoards(
      database, async (id) => ({ id, teamId: "team" }), 6,
      { agentId: "other", addProjectIds: [projectId], removeProjectIds: [] },
      undefined, "acting",
    ),
    writes,
    roleReads: () => roleReads,
    AgentBoardUpdateError: updates.AgentBoardUpdateError,
  };
}

for (const role of ["read", "write", "admin"]) {
  test(`S4 refused: ${role} self-change gives owner guidance before checking role`, async () => {
    const state = delegation(role);
    const response = await state.check("acting");
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { success: false, error: selfRefusal, code: "forbidden" });
    assert.equal(state.roleReads(), 0);
    assert.deepEqual(state.writes, []);
  });
}

test("S4 still refused: write acting on another agent keeps insufficient_scope", async () => {
  const state = delegation("write");
  const response = await state.check("other");
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    success: false,
    error: "This agent's role ('write') does not permit this action; requires 'admin' or higher.",
    code: "insufficient_scope",
  });
  assert.deepEqual(state.writes, []);
});

for (const enforce of [false, true]) {
  test(`S4 still allowed: admin to another owned agent on a shared board (enforce=${enforce})`, async () => {
    const state = delegation("admin", [15], enforce);
    assert.equal(await state.check("other"), null);
    assert.deepEqual(await state.change(15), {
      agentId: "other", addedProjects: 1, removedProjects: 0, projectIds: [15],
    });
    assert.deepEqual(state.writes, [{ agentId: "other", userId: 6, projectId: 15 }]);
  });

  test(`S4 still refused: admin outside its board scope cannot write (enforce=${enforce})`, async () => {
    const state = delegation("admin", [15], enforce);
    assert.equal(await state.check("other"), null);
    await assert.rejects(state.change(99), (error) => {
      assert.ok(error instanceof state.AgentBoardUpdateError);
      assert.equal(error.status, 403);
      assert.equal(error.field, "project_ids");
      return true;
    });
    assert.deepEqual(state.writes, []);
  });
}

test("S4 still allowed: humans bypass the delegated-agent role check", async () => {
  const state = delegation("read");
  assert.equal(await state.check("acting", { user: { id: 6 } }), null);
  assert.equal(state.roleReads(), 0);
});

const responses = load("src/lib/mcp-server/tool-response.ts");
const { mapHttpErrorToMcpError } = load("src/lib/mcp-server/utils/errors.ts");
const safeMessages = [
  "Only the board owner or a project admin can add members",
  "Agent not found or you do not own this agent",
  "This agent belongs to another team",
  selfRefusal,
  "This agent is not a member of this board. Ask the board owner to add it.",
  ...["read", "write", "admin"].flatMap((role) =>
    ["read", "write", "admin"].map((required) =>
      `This agent's role ('${role}') does not permit this action; requires '${required}' or higher.`,
    ),
  ),
];

async function assertAuthorizationResult(message, expected) {
  const error = mapHttpErrorToMcpError(403, message);
  assert.equal(responses.actionableToolError(error), expected);
  assert.deepEqual(responses.toolErrorResult(error), {
    isError: true, content: [{ type: "text", text: expected }],
  });
  const result = await responses.executeToolResult({
    parameters: z.object({}),
    outputSchema: responses.CONSOLIDATED_OUTPUT_SCHEMA,
    execute: async () => { throw error; },
  }, {}, "unused-fixture-token");
  assert.deepEqual(result, { isError: true, content: [{ type: "text", text: expected }] });
}

for (const message of safeMessages) {
  test(`S10 preserved refusal: ${message}`, async () => {
    await assertAuthorizationResult(message, `${message.replace(/[.!]$/, "")}. ${genericHint}`);
  });
}

for (const message of [
  "Unknown authorization refusal",
  "Error: Prisma exception\n at internal (/srv/private.ts:1) Bearer htk_fixture_secret",
  "missing token htmk_fixture_secret",
  "This agent belongs to another team Bearer htk_fixture_secret",
  "Only the board owner or a project admin can add members\n at internal (private.ts:1)",
  "This agent's role ('htk_fixture_secret') does not permit this action; requires 'admin' or higher.",
]) {
  test(`S10 redacted unknown refusal: ${message.split("\n")[0]}`, async () => {
    await assertAuthorizationResult(message, genericHint);
  });
}

function matches(row, where) {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "AND") return expected.every((clause) => matches(row, clause));
    if (key === "OR") return expected.some((clause) => matches(row, clause));
    if (expected !== null && typeof expected === "object") {
      if (Object.hasOwn(expected, "some")) return row[key].some((item) => matches(item, expected.some));
      if (Object.hasOwn(expected, "none")) return !row[key].some((item) => matches(item, expected.none));
      return matches(row[key], expected);
    }
    return row[key] === expected;
  });
}

const createdAt = new Date("2026-10-22T00:00:00Z");
function agent(id, overrides = {}) {
  return {
    id, userId: 6, displayName: id, visibility: "PRIVATE", createdAt,
    revokedAt: null, archivedAt: null, members: [], byokApiKeys: [],
    permissions: {}, mcpTokenJti: null, mcpTokenExpiresAt: null,
    heartbeatAt: null, prompt: null,
    ...overrides,
  };
}
const membership = (teamId, id = 15) => ({ project: { id, teamId, name: "Board", title: null } });

function candidates(rows, access = true, flagOn = true) {
  let query;
  let selectedIds;
  const prisma = {
    agent: { findMany: async (args) => {
      query = args;
      const selected = rows.filter((row) => matches(row, args.where));
      selectedIds = selected.map(({ id }) => id);
      return selected.map((row) => Object.fromEntries(
        Object.keys(args.select).map((key) => [key, row[key]]),
      ));
    } },
    comment: { groupBy: async () => [] },
    oAuthAuthorizationCode: { findMany: async () => [] },
  };
  const prismaModule = { __esModule: true, default: prisma };
  const visibility = load("src/lib/agents/visibility.ts", { "@/lib/prisma": prismaModule });
  const route = load("src/app/api/agents/route.ts", {
    "@/lib/prisma": prismaModule,
    "@/lib/agents/maskAgentProviderKey": { maskAgentProviderKey: () => null },
    "@/lib/mcp/auth": {},
    "@/utils/controllers/agents/boardMembers": {},
    "@/utils/controllers/agents/teamScope": load("src/utils/controllers/agents/teamScope.ts"),
    "@/utils/controllers/teams/hasTeamMembershipAccess": { hasTeamMembershipAccess: async () => access },
    "@/lib/agents/visibility": visibility,
    "@/lib/auth/getSessionUser": { getSessionUser: async () => ({ userId: 6 }) },
    "@/lib/flags": {
      isFeatureEnabled: async (key) => flagOn && key === "htpr-7574-owned-unattached-agents",
      isOwnerOrQaUserId: async () => false,
    },
    "@/lib/flags/keys": {
      HTPR_7509_AGENT_ROLE_SCREEN_FLAG: "unused",
      HTPR_7574_OWNED_UNATTACHED_AGENTS_FLAG: "htpr-7574-owned-unattached-agents",
    },
    "@/utils/controllers/agents/ensureDefaultTeamAgent": {},
  });
  return {
    get: () => route.GET({ headers: new Headers(), url: "http://localhost/api/agents?teamId=team" }),
    selectedIds: () => selectedIds,
    query: () => query,
  };
}

test("S3 now visible: viewer-owned unattached agent survives the query and team filter with empty boards", async () => {
  const state = candidates([agent("owned-unattached")]);
  const response = await state.get();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(state.selectedIds(), ["owned-unattached"]);
  assert.deepEqual(body.agents.map(({ id, boards, userId }) => ({ id, boards, userId })), [
    { id: "owned-unattached", boards: [], userId: 6 },
  ]);
});

for (const [name, overrides] of [
  ["another user's unattached private agent", { userId: 9 }],
  ["another user's unattached TEAM agent", { userId: 9, visibility: "TEAM" }],
  ["revoked owned unattached agent", { revokedAt: createdAt }],
  ["archived owned unattached agent", { archivedAt: createdAt }],
  ["owned other-team attached agent", { members: [membership("other-team")] }],
  ["foreign other-team attached TEAM agent", { userId: 9, visibility: "TEAM", members: [membership("other-team")] }],
  ["foreign same-team private agent", { userId: 9, members: [membership("team")] }],
]) {
  test(`S3 still excluded: ${name}`, async () => {
    const state = candidates([agent("excluded", overrides), agent("positive-control")]);
    const response = await state.get();
    assert.equal(response.status, 200);
    assert.deepEqual(state.selectedIds(), ["positive-control"]);
    assert.deepEqual((await response.json()).agents.map(({ id }) => id), ["positive-control"]);
  });
}

test("S3 still visible: existing same-team owned and shared agents are unchanged", async () => {
  const state = candidates([
    agent("owned", { members: [membership("team")] }),
    agent("shared", { userId: 9, visibility: "TEAM", members: [membership("team")] }),
    agent("owned-team-unattached", { visibility: "TEAM" }),
  ]);
  const response = await state.get();
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).agents.map(({ id, boards }) => ({ id, boards })), [
    { id: "owned", boards: [{ id: 15, name: "Board" }] },
    { id: "shared", boards: [{ id: 15, name: "Board" }] },
    { id: "owned-team-unattached", boards: [] },
  ]);
});

test("S3 still excluded: post-query team filter rejects a legacy agent attached first to another team", async () => {
  const state = candidates([
    agent("mixed", { members: [membership("other-team", 99), membership("team")] }),
    agent("positive-control"),
  ]);
  const response = await state.get();
  assert.equal(response.status, 200);
  assert.deepEqual(state.selectedIds(), ["mixed", "positive-control"]);
  assert.deepEqual((await response.json()).agents.map(({ id }) => id), ["positive-control"]);
});

test("S3 flag off: viewer-owned unattached agent stays hidden as before", async () => {
  const state = candidates([
    agent("owned-unattached"),
    agent("owned", { members: [membership("team")] }),
  ], true, false);
  const response = await state.get();
  assert.equal(response.status, 200);
  assert.deepEqual(state.selectedIds(), ["owned"]);
  assert.deepEqual((await response.json()).agents.map(({ id }) => id), ["owned"]);
});

test("S3 flag off: same-team owned and shared agents still listed", async () => {
  const state = candidates([
    agent("owned", { members: [membership("team")] }),
    agent("shared", { userId: 9, visibility: "TEAM", members: [membership("team")] }),
  ], true, false);
  const response = await state.get();
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).agents.map(({ id }) => id), ["owned", "shared"]);
});

test("S3 still refused: team access is required before listing owned unattached agents", async () => {
  const state = candidates([agent("owned-unattached")], false);
  const response = await state.get();
  assert.equal(response.status, 403);
  assert.equal(state.query(), undefined);
});
