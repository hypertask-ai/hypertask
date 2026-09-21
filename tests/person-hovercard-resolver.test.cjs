const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function compile(relativePath) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  return ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
}

function execute(javascript, stubs) {
  const mod = { exports: {} };
  new Function("module", "exports", "require", javascript)(
    mod,
    mod.exports,
    (request) => stubs[request] ?? require(request),
  );
  return mod.exports;
}

const controller = execute(
  compile("src/utils/controllers/members/personHovercard.ts"),
  { "@/lib/prisma": { __esModule: true, default: {} } },
);

test("agent hovercards build an agent-page link without linking people", () => {
  const { agentPageHref } = execute(compile("src/lib/agents/pageHref.ts"), {});

  assert.equal(
    agentPageHref({
      kind: "agent",
      id: "agent-1",
      displayName: "Desktop Developer",
    }),
    "/agents/agent-1",
  );
  assert.equal(
    agentPageHref({ kind: "user", id: 6, displayName: "Valentin" }),
    null,
  );
});

function store(overrides = {}) {
  return {
    project: {
      findFirst: async () => ({ ownerId: 6 }),
    },
    user: {
      findUnique: async () => null,
    },
    member: {
      findFirst: async () => null,
    },
    ...overrides,
  };
}

test("resolver refuses callers without owner or accepted human membership", async () => {
  let targetLookups = 0;
  const denied = store({
    project: {
      findFirst: async (args) => {
        assert.deepEqual(args.where.OR, [
          { ownerId: 23 },
          {
            members: {
              some: { userId: 23, agentId: null, status: "Accepted" },
            },
          },
        ]);
        return null;
      },
    },
    member: {
      findFirst: async () => {
        targetLookups += 1;
        return null;
      },
    },
  });

  const result = await controller.resolvePersonHovercardWithStore(
    denied,
    15,
    23,
    { kind: "user", id: 6 },
  );

  assert.deepEqual(result, {
    ok: false,
    status: 403,
    message: "Board access denied",
  });
  assert.equal(targetLookups, 0);
});

test("resolver returns only the exact accepted human member and omits blank email", async () => {
  let memberWhere;
  const allowed = store({
    member: {
      findFirst: async (args) => {
        memberWhere = args.where;
        return {
          user: {
            id: 42,
            displayName: "  Ada  ",
            email: "   ",
            photoURL: " ada.png ",
            secret: "must not escape",
          },
        };
      },
    },
  });

  const result = await controller.resolvePersonHovercardWithStore(
    allowed,
    15,
    6,
    { kind: "user", id: 42 },
  );

  assert.deepEqual(memberWhere, {
    projectId: 15,
    userId: 42,
    agentId: null,
    status: "Accepted",
  });
  assert.deepEqual(result, {
    ok: true,
    profile: {
      kind: "user",
      id: 42,
      displayName: "Ada",
      photoURL: "ada.png",
    },
  });
});

test("resolver handles the board owner by exact integer id", async () => {
  let ownerWhere;
  const allowed = store({
    project: { findFirst: async () => ({ ownerId: 6 }) },
    user: {
      findUnique: async (args) => {
        ownerWhere = args.where;
        return {
          id: 6,
          displayName: "Valentin",
          email: "v@example.com",
          photoURL: null,
        };
      },
    },
  });

  const result = await controller.resolvePersonHovercardWithStore(
    allowed,
    15,
    6,
    { kind: "user", id: 6 },
  );

  assert.deepEqual(ownerWhere, { id: 6 });
  assert.deepEqual(result.profile, {
    kind: "user",
    id: 6,
    displayName: "Valentin",
    email: "v@example.com",
  });
});

test("resolver requires exact board membership and a non-revoked agent", async () => {
  let agentWhere;
  const allowed = store({
    member: {
      findFirst: async (args) => {
        agentWhere = args.where;
        return {
          agent: {
            id: "agent-1",
            displayName: "Desktop Developer",
            photoURL: "agent.png",
            email: "owner@example.com",
          },
        };
      },
    },
  });

  const result = await controller.resolvePersonHovercardWithStore(
    allowed,
    15,
    6,
    { kind: "agent", id: "agent-1" },
  );

  assert.deepEqual(agentWhere, {
    projectId: 15,
    agentId: "agent-1",
    status: "Accepted",
    agent: { revokedAt: null },
  });
  assert.deepEqual(result, {
    ok: true,
    profile: {
      kind: "agent",
      id: "agent-1",
      displayName: "Desktop Developer",
      photoURL: "agent.png",
    },
  });
  assert.equal("email" in result.profile, false);
});

test("route requires a signed session before resolving a person", async () => {
  let resolverCalls = 0;
  const route = execute(compile("src/pages/api/members/personHovercard.ts"), {
    "@/lib/auth/session": {
      SESSION_COOKIE: "ht_session",
      verifySession: () => null,
    },
    "@/utils/controllers/members/personHovercard": {
      resolvePersonHovercard: async () => {
        resolverCalls += 1;
        return { ok: false, status: 404, message: "not found" };
      },
    },
  });
  const req = {
    method: "GET",
    cookies: {},
    query: { projectId: "15", kind: "user", id: "6" },
  };
  let status;
  let payload;
  const res = {
    setHeader() {},
    status(code) {
      status = code;
      return this;
    },
    json(body) {
      payload = body;
      return this;
    },
  };

  await route.default(req, res);
  assert.equal(status, 401);
  assert.equal(payload.code, "SESSION_REQUIRED");
  assert.equal(resolverCalls, 0);
});

test("route passes the signed user id and parsed subject to the resolver", async () => {
  let resolverArgs;
  const route = execute(compile("src/pages/api/members/personHovercard.ts"), {
    "@/lib/auth/session": {
      SESSION_COOKIE: "ht_session",
      verifySession: (token) => (token === "signed" ? { id: 23 } : null),
    },
    "@/utils/controllers/members/personHovercard": {
      resolvePersonHovercard: async (...args) => {
        resolverArgs = args;
        return {
          ok: true,
          profile: { kind: "user", id: 42, displayName: "Ada" },
        };
      },
    },
  });
  const req = {
    method: "GET",
    cookies: { ht_session: "signed" },
    query: { projectId: "15", kind: "user", id: "42" },
  };
  let status;
  let payload;
  const headers = {};
  const res = {
    setHeader(name, value) {
      headers[name] = value;
    },
    status(code) {
      status = code;
      return this;
    },
    json(body) {
      payload = body;
      return this;
    },
  };

  await route.default(req, res);
  assert.deepEqual(resolverArgs, [15, 23, { kind: "user", id: 42 }]);
  assert.equal(status, 200);
  assert.deepEqual(payload, { kind: "user", id: 42, displayName: "Ada" });
  assert.equal(headers["Cache-Control"], "private, no-store, max-age=0");
  assert.equal(headers.Vary, "Cookie");
});

test("route parser rejects lossy ids and preserves exact subject kinds", () => {
  const route = execute(compile("src/pages/api/members/personHovercard.ts"), {
    "@/lib/auth/session": { SESSION_COOKIE: "ht_session", verifySession: () => null },
    "@/utils/controllers/members/personHovercard": {
      resolvePersonHovercard: async () => null,
    },
  });

  assert.deepEqual(
    route.parsePersonHovercardQuery({
      projectId: "15",
      kind: "user",
      id: "42",
    }),
    { projectId: 15, subject: { kind: "user", id: 42 } },
  );
  assert.deepEqual(
    route.parsePersonHovercardQuery({
      projectId: "15",
      kind: "agent",
      id: "agent-42",
    }),
    { projectId: 15, subject: { kind: "agent", id: "agent-42" } },
  );
  assert.equal(
    route.parsePersonHovercardQuery({
      projectId: "15x",
      kind: "user",
      id: "42",
    }),
    null,
  );
  assert.equal(
    route.parsePersonHovercardQuery({
      projectId: "15",
      kind: "user",
      id: "42x",
    }),
    null,
  );
  assert.equal(
    route.parsePersonHovercardQuery({
      projectId: "15",
      kind: "agent",
      id: " agent-42",
    }),
    null,
  );
});

test("React Query key isolates viewer, board, kind, and exact id", () => {
  const hook = execute(compile("src/hooks/MultiPages/usePersonHovercard.ts"), {
    "@tanstack/react-query": { useQuery: (options) => options },
    "@/lib/state": { useRecoilValue: () => ({ id: 6 }) },
    "@/store": { currentUserAtom: {} },
  });

  assert.deepEqual(
    hook.personHovercardQueryKey(6, 15, { kind: "user", id: 42 }),
    ["personHovercard", 6, 15, "user", 42],
  );
  assert.deepEqual(
    hook.personHovercardQueryKey(7, 15, { kind: "agent", id: "agent-42" }),
    ["personHovercard", 7, 15, "agent", "agent-42"],
  );
});
