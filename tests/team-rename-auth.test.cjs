const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const routePath = path.join(root, "src/pages/api/teams/changeTeamName.ts");
const source = fs.readFileSync(routePath, "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
  fileName: routePath,
}).outputText;

function loadRoute({ sessionUserId = null, ownerUserId = 6, transferAfterRead = false } = {}) {
  const calls = { reads: [], writes: [] };
  let currentOwnerUserId = ownerUserId;
  const prisma = {
    team: {
      findUnique: async (args) => {
        calls.reads.push(args);
        const team = { googleAccount: { userId: currentOwnerUserId } };
        if (transferAfterRead) currentOwnerUserId = 99;
        return team;
      },
      update: async (args) => {
        calls.writes.push(args);
        return {};
      },
      updateMany: async (args) => {
        const requestedOwnerId = args.where.googleAccount?.userId;
        if (args.where.id !== "team-1" || requestedOwnerId !== currentOwnerUserId) {
          return { count: 0 };
        }
        calls.writes.push(args);
        return { count: 1 };
      },
    },
  };
  const stubs = {
    "@/lib/auth/session": {
      SESSION_COOKIE: "ht_session",
      verifySession: (token) =>
        token === "valid-session" && sessionUserId !== null
          ? { id: sessionUserId }
          : null,
    },
    "@/lib/prisma": { __esModule: true, default: prisma },
  };
  const loadedModule = { exports: {} };
  const localRequire = (request) => stubs[request] ?? require(request);

  new Function("module", "exports", "require", javascript)(
    loadedModule,
    loadedModule.exports,
    localRequire,
  );

  return { handler: loadedModule.exports.default, calls };
}

function responseRecorder() {
  const result = { status: null, body: null };
  const response = {
    status(status) {
      result.status = status;
      return response;
    },
    json(body) {
      result.body = body;
      return response;
    },
  };
  return { response, result };
}

async function request(handler, { authenticated = true, method = "POST", body } = {}) {
  const { response, result } = responseRecorder();
  await handler(
    {
      method,
      body: body ?? { teamId: "team-1", updatedTitle: " Renamed team " },
      cookies: authenticated ? { ht_session: "valid-session" } : {},
    },
    response,
  );
  return result;
}

test("team rename rejects anonymous requests before reading or writing a team", async () => {
  const { handler, calls } = loadRoute();

  const result = await request(handler, { authenticated: false });

  assert.equal(result.status, 401);
  assert.deepEqual(calls, { reads: [], writes: [] });
});

test("team rename rejects an authenticated non-owner without writing", async () => {
  const { handler, calls } = loadRoute({ sessionUserId: 7, ownerUserId: 6 });

  const result = await request(handler);

  assert.equal(result.status, 403);
  assert.deepEqual(calls.writes, []);
});

test("team rename scopes the write to the authenticated owner", async () => {
  const { handler, calls } = loadRoute({ sessionUserId: 6, ownerUserId: 6 });

  const result = await request(handler);

  assert.equal(result.status, 200);
  assert.deepEqual(calls.writes, [
    {
      where: { id: "team-1", googleAccount: { userId: 6 } },
      data: { title: "Renamed team" },
    },
  ]);
});

test("team rename cannot write after ownership changes between check and update", async () => {
  const { handler, calls } = loadRoute({
    sessionUserId: 6,
    ownerUserId: 6,
    transferAfterRead: true,
  });

  const result = await request(handler);

  assert.equal(result.status, 403);
  assert.deepEqual(calls.writes, []);
});
