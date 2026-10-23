const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const nextServer = require("next/server");

const root = path.resolve(__dirname, "..");
const ORIGIN = "https://app.hypertask.ai";
const FLAG = "htpr-7515-connect-github-per-board";
const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" });
const world = {};

function load(file, stubs) {
  const javascript = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", javascript)(mod, mod.exports, (name) => {
    if (name in stubs) return stubs[name];
    if (name.startsWith("node:")) return require(name);
    throw new Error(`Unexpected import in ${file}: ${name}`);
  });
  return mod.exports;
}

function installation(overrides = {}) {
  return { id: "123", accountId: "321", accountLogin: "acme", accountType: "Organization", teamId: "team-a", installedByUserId: 10, revokedAt: null, ...overrides };
}

function repository(overrides = {}) {
  return { id: 456, full_name: "Acme/Api", private: true, fork: false, ...overrides };
}

function mapping(overrides = {}) {
  return { id: "row-1", projectId: 7, repositoryId: "456", fullName: "acme/api", provenance: "installed", installationId: "123", activatedAt: new Date("2026-10-22T00:00:00Z"), revokedAt: null, ...overrides };
}

function reset() {
  Object.assign(world, {
    session: { userId: 10, source: "legacy" }, flagOn: true, flagCalls: [],
    board: { id: 7, status: "Normal", teamId: "team-a" }, admins: [10, 11],
    installations: [installation()], rows: [], writes: [], fetches: [],
    repositories: { "123": [repository(), repository({ id: 789, full_name: "acme/web", private: false })] },
    pages: null, down: false, config: { appId: "424242" }, beforeTransaction: null,
    transactionFailure: null, createFailure: null, authorityReads: 0,
  });
}

function matches(row, where = {}) {
  return Object.entries(where).every(([key, value]) => {
    if (key === "OR") return value.some((clause) => matches(row, clause));
    if (value !== null && typeof value === "object") {
      if ("not" in value && row[key] === value.not) return false;
      if ("in" in value && !value.in.includes(row[key])) return false;
      if ("notIn" in value && value.notIn.includes(row[key])) return false;
      return true;
    }
    return row[key] === value;
  });
}

const prisma = {
  project: {
    findUnique: async ({ where }) => world.board?.id === where.id ? world.board : null,
    findFirst: async ({ where }) => {
      world.authorityReads += 1;
      if (!world.board || world.board.id !== where.id || world.board.status !== "Normal" || !world.board.teamId) return null;
      return {
        teamId: world.board.teamId,
        team: { googleAccountId: "ga-1", googleAccount: { userId: 1 }, members: [{ id: "member-1" }] },
      };
    },
  },
  githubInstallation: {
    findMany: async ({ where }) => world.installations.filter((row) => matches(row, where)),
  },
  boardGithubRepository: {
    findMany: async ({ where }) => world.rows.filter((row) => matches(row, where)).map((row) => ({ ...row })),
    updateMany: async ({ where, data }) => {
      const rows = world.rows.filter((row) => matches(row, where));
      world.writes.push({ op: "updateMany", where, data });
      rows.forEach((row) => Object.assign(row, data));
      return { count: rows.length };
    },
    create: async ({ data }) => {
      if (world.createFailure) throw Object.assign(new Error("write failed"), { code: world.createFailure });
      const row = mapping({ ...data, id: `new-${world.rows.length + 1}`, activatedAt: new Date() });
      world.rows.push(row);
      world.writes.push({ op: "create", data });
      return row;
    },
  },
  $transaction: async (fn, options) => {
    assert.equal(options.isolationLevel, "Serializable");
    if (world.beforeTransaction) await world.beforeTransaction();
    const snapshot = structuredClone({ rows: world.rows, writes: world.writes });
    try {
      const result = await fn(prisma);
      if (world.transactionFailure) throw Object.assign(new Error("transaction failed"), { code: world.transactionFailure });
      return result;
    } catch (error) {
      Object.assign(world, snapshot);
      throw error;
    }
  },
};

const responseReader = load("src/lib/googleCalendar/response.ts", {});
const userApi = load("src/lib/github/userApi.ts", { "@/lib/googleCalendar/response": responseReader });
const appApi = load("src/lib/github/appApi.ts", {
  "@/lib/googleCalendar/response": responseReader,
  "./appConfig": {
    getGithubAppConfig: async () => world.config,
    getGithubAppPrivateKey: async () => process.env.GITHUB_APP_PRIVATE_KEY?.trim().replace(/\\n/g, "\n") || null,
  },
  "./userApi": userApi,
});
const authority = load("src/lib/github/installAuthority.ts", {
  "@/lib/prisma": prisma,
  "@/utils/controllers/teams/hasTeamOwnerOrProjectAdminAccess": async (userId) => world.admins.includes(userId),
  "./userApi": userApi,
});
const service = load("src/lib/github/boardRepositories.ts", {
  "@/lib/prisma": prisma,
  "./appApi": appApi,
  "./installAuthority": authority,
});
const routeLib = load("src/app/api/github/_lib.ts", {
  "next/server": nextServer,
  "@/lib/auth/getSessionUser": { getSessionUser: async () => world.session },
  "@/lib/auth/requestBaseUrl": { getRequestBaseUrl: () => ORIGIN },
  "@/lib/flags": { isFeatureEnabled: async (key, userId) => { world.flagCalls.push({ key, userId }); return world.flagOn; } },
  "@/lib/flags/definitions/htpr-7515-connect-github-per-board": { HTPR_7515_CONNECT_GITHUB_PER_BOARD_FLAG: FLAG },
  "@/lib/github/oauthState": {},
});
const route = load("src/app/api/projects/[projectId]/github/route.ts", {
  "next/server": nextServer,
  "@/app/api/github/_lib": routeLib,
  "@/lib/github/boardRepositories": service,
  "@/lib/api/rateLimit": { checkRestRateLimit: async () => null },
});

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
async function fakeGithub(input, init) {
  const url = new URL(String(input));
  assert.equal(url.origin, "https://api.github.com");
  assert.equal(init.cache, "no-store");
  assert.equal(init.redirect, "error");
  assert.ok(init.signal instanceof AbortSignal);
  world.fetches.push(url.toString());
  if (world.down) throw new Error("SECRET upstream transport detail");
  const authorization = new Headers(init.headers).get("authorization");
  const match = url.pathname.match(/^\/app\/installations\/(\d+)\/access_tokens$/);
  if (match) {
    assert.equal(init.method, "POST");
    const jwt = authorization.slice("Bearer ".length);
    const [header, payload, signature] = jwt.split(".");
    assert.equal(JSON.parse(Buffer.from(header, "base64url")).alg, "RS256");
    const claims = JSON.parse(Buffer.from(payload, "base64url"));
    const now = Math.floor(Date.now() / 1000);
    assert.equal(claims.iss, "424242");
    assert.ok(Math.abs(claims.iat - (now - 60)) <= 2);
    assert.ok(Math.abs(claims.exp - (now + 9 * 60)) <= 2);
    assert.equal(crypto.verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), keys.publicKey, Buffer.from(signature, "base64url")), true);
    return json({ token: `installation-token-${match[1]}` }, 201);
  }
  assert.equal(url.pathname, "/installation/repositories");
  assert.equal(url.searchParams.get("per_page"), "100");
  const id = authorization.replace("Bearer installation-token-", "");
  const page = Number(url.searchParams.get("page"));
  if (world.pages) {
    const result = world.pages[page - 1];
    if (result instanceof Error) throw result;
    return json(result.body ?? result, result.status ?? 200);
  }
  const repositories = world.repositories[id] ?? [];
  return json({ total_count: repositories.length, repositories: repositories.slice((page - 1) * 100, page * 100) });
}

function scenario(fn) {
  return async () => {
    reset();
    const previousFetch = global.fetch;
    const previousKey = process.env.GITHUB_APP_PRIVATE_KEY;
    process.env.GITHUB_APP_PRIVATE_KEY = privateKey;
    global.fetch = fakeGithub;
    try { await fn(); } finally {
      global.fetch = previousFetch;
      if (previousKey === undefined) delete process.env.GITHUB_APP_PRIVATE_KEY;
      else process.env.GITHUB_APP_PRIVATE_KEY = previousKey;
    }
  };
}

const deps = { prisma, fetcher: fakeGithub };
const get = (userId = 10) => service.getBoardGithubSettings(userId, 7, deps);
async function save(ids, userId = 10, version) {
  return service.saveBoardGithubRepositories(userId, 7, { repositoryIds: ids, version: version ?? (await get(userId)).version }, deps);
}
function request(method, body, origin = ORIGIN, projectId = "7") {
  return new nextServer.NextRequest(`${ORIGIN}/api/projects/${projectId}/github`, {
    method, headers: { origin, "content-type": "application/json" },
    ...(method === "PUT" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
  });
}
async function call(method, body, origin = ORIGIN, projectId = "7") {
  const response = await route[method](request(method, body, origin, projectId), { params: Promise.resolve({ projectId }) });
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  return { status: response.status, body: await response.json() };
}
async function refused(promise, status, error, repositoryIds) {
  await assert.rejects(promise, (result) => {
    assert.ok(result instanceof service.BoardGithubSettingsError);
    assert.equal(result.status, status);
    assert.equal(result.error, error);
    if (repositoryIds) assert.deepEqual(result.repositoryIds, repositoryIds);
    return true;
  });
  assert.deepEqual(world.writes, []);
}

test("installer still connects a private covered repo and normalizes its name", scenario(async () => {
  const initial = await get();
  assert.equal(initial.canConnect, true);
  assert.deepEqual(initial.installations, [{ id: "123", accountLogin: "acme", accountType: "Organization", installedByMe: true }]);
  assert.equal(initial.available.find((row) => row.repositoryId === "456").isPrivate, true);
  const result = await save(["456"], 10, initial.version);
  assert.notEqual(result.version, initial.version);
  assert.deepEqual(result.connected, [{ repositoryId: "456", fullName: "acme/api", provenance: "installed", installationId: "123", isPrivate: true }]);
  assert.deepEqual(result.available.map((row) => row.repositoryId), ["789"]);
  assert.equal(world.writes.filter((write) => write.op === "create").length, 1);
  assert.ok(world.authorityReads >= 3);
  assert.ok(!JSON.stringify(result).includes("installation-token"));
}));

test("non-installer board admin sees connected repos but cannot connect; removal is still allowed", scenario(async () => {
  world.rows = [mapping()];
  const initial = await get(11);
  assert.equal(initial.canConnect, false);
  assert.deepEqual(initial.available, []);
  assert.equal(initial.connected[0].isPrivate, true);
  await refused(save(["456", "789"], 11, initial.version), 403, "not_installer");
  world.down = true;
  const result = await save([], 11, initial.version);
  assert.deepEqual(result.connected, []);
  assert.notEqual(result.version, initial.version);
  assert.ok(world.rows[0].revokedAt instanceof Date);
}));

test("uncovered repo and fork are refused while a covered private repo is still allowed", scenario(async () => {
  world.repositories["123"].push(repository({ id: 900, full_name: "acme/fork", fork: true }));
  assert.ok(!(await get()).available.some((row) => row.repositoryId === "900"));
  await refused(save(["999"]), 403, "repo_not_installed", ["999"]);
  await refused(save(["900"]), 403, "repo_not_installed", ["900"]);
  assert.equal((await save(["456"])).connected.length, 1);
}));

test("repo on another board is marked unavailable and refused by ID or legacy name", scenario(async () => {
  world.rows = [mapping({ projectId: 8 })];
  assert.equal((await get()).available.find((row) => row.repositoryId === "456").onOtherBoard, true);
  await refused(save(["456"]), 409, "repo_on_other_board", ["456"]);
  world.rows = [mapping({ projectId: 15, provenance: "legacy", repositoryId: null, installationId: null })];
  await refused(save(["456"]), 409, "repo_on_other_board", ["456"]);
}));

test("stale version refuses writes and version changes after remove and re-add", scenario(async () => {
  const before = await get();
  const first = await save(["456"]);
  world.writes = [];
  await refused(save(["789"], 10, before.version), 409, "stale");
  const removed = await save([], 10, first.version);
  const readded = await save(["456"], 10, removed.version);
  assert.equal(new Set([before.version, first.version, removed.version, readded.version]).size, 4);
}));

test("another team's, revoked and null-installer installations grant nobody connect authority", scenario(async () => {
  for (const change of [{ teamId: "team-b" }, { revokedAt: new Date() }, { installedByUserId: null }]) {
    world.installations = [installation(change)];
    const settings = await get();
    assert.equal(settings.canConnect, false);
    assert.deepEqual(settings.available, []);
    assert.deepEqual(world.fetches, []);
    await refused(save(["456"], 10, settings.version), 403, "not_installer");
  }
}));

test("GitHub down on add is 503 with no write; GET retains rows and reports unavailable", scenario(async () => {
  world.rows = [mapping()];
  world.down = true;
  const result = await get();
  assert.equal(result.githubUnavailable, true);
  assert.deepEqual(result.available, []);
  assert.equal(result.connected.length, 1);
  assert.equal(result.connected[0].isPrivate, null);
  await refused(save(["456", "789"], 10, result.version), 503, "github_unavailable");
}));

test("save rechecks live GitHub coverage rather than trusting GET", scenario(async () => {
  const initial = await get();
  world.repositories["123"] = [];
  await refused(save(["456"], 10, initial.version), 403, "repo_not_installed", ["456"]);
}));

test("board authority, installation ownership and version are rechecked inside transaction", scenario(async () => {
  const initial = await get();
  world.beforeTransaction = async () => { world.admins = []; };
  await refused(save(["456"], 10, initial.version), 403, "board_access_denied");
  world.admins = [10];
  world.beforeTransaction = async () => { world.installations[0].installedByUserId = 11; };
  await refused(save(["456"], 10, initial.version), 403, "not_installer");
  world.installations[0].installedByUserId = 10;
  world.beforeTransaction = async () => { world.installations[0].revokedAt = new Date(); };
  await refused(save(["456"], 10, initial.version), 403, "not_installer");
  world.installations[0].revokedAt = null;
  world.beforeTransaction = async () => { world.rows.push(mapping({ repositoryId: "789", fullName: "acme/web" })); };
  await refused(save(["456"], 10, initial.version), 409, "stale");
}));

test("serializable/unique conflicts roll back removals", scenario(async () => {
  world.rows = [mapping()];
  const initial = await get();
  world.createFailure = "P2002";
  await refused(save(["789"], 10, initial.version), 409, "repo_on_other_board", ["789"]);
  assert.equal(world.rows[0].revokedAt, null);
  world.createFailure = null;
  world.transactionFailure = "P2034";
  await refused(save(["789"], 10, initial.version), 409, "stale");
  assert.equal(world.rows[0].revokedAt, null);
  world.transactionFailure = null;
  await save(["789"], 10, initial.version);
  assert.ok(world.writes.filter((write) => write.op === "updateMany").every((write) => write.where.provenance === "installed"));
}));

test("legacy rows on board 15 survive installed repository replacement", scenario(async () => {
  world.board.id = 15;
  world.rows = [mapping({ id: "legacy", projectId: 15, provenance: "legacy", repositoryId: null, installationId: null, fullName: "acme/legacy" }), mapping({ projectId: 15 })];
  const legacy = structuredClone(world.rows[0]);
  const initial = await service.getBoardGithubSettings(10, 15, deps);
  assert.equal(initial.connected[0].isPrivate, null);
  const result = await service.saveBoardGithubRepositories(10, 15, { repositoryIds: ["789"], version: initial.version }, deps);
  assert.deepEqual(world.rows[0], legacy);
  assert.ok(result.connected.some((row) => row.provenance === "legacy"));
  assert.ok(result.connected.some((row) => row.repositoryId === "789"));
}));

test("a repo already connected to this board through the legacy path is refused as already connected", scenario(async () => {
  world.board.id = 15;
  world.rows = [mapping({ id: "legacy", projectId: 15, provenance: "legacy", repositoryId: null, installationId: null, fullName: "acme/web" })];
  const initial = await service.getBoardGithubSettings(10, 15, deps);
  await refused(service.saveBoardGithubRepositories(10, 15, { repositoryIds: ["789"], version: initial.version }, deps), 409, "already_connected", ["789"]);
  assert.equal(world.rows.length, 1);
}));

test("invalid bodies reject non-decimal, duplicate and over-limit selections without writes", scenario(async () => {
  const { version } = await get();
  for (const body of [null, [], {}, { version }, { repositoryIds: [], version: "" }, { repositoryIds: [456], version }, { repositoryIds: ["01"], version }, { repositoryIds: ["456", "456"], version }, { repositoryIds: Array.from({ length: 51 }, (_, i) => String(i + 1)), version }]) {
    await refused(service.saveBoardGithubRepositories(10, 7, body, deps), 400, "invalid");
  }
}));

test("flag Off returns exact 404 for GET and PUT with no GitHub request or writes", scenario(async () => {
  world.flagOn = false;
  for (const method of ["GET", "PUT"]) {
    assert.deepEqual(await call(method, {}), { status: 404, body: { error: "not_found" } });
  }
  assert.deepEqual(world.fetches, []);
  assert.deepEqual(world.writes, []);
  assert.ok(world.flagCalls.every(({ key, userId }) => key === FLAG && userId === 10));
}));

test("signed-out, unsigned-cookie and agent sessions are refused; a human remains allowed", scenario(async () => {
  world.session = null;
  for (const method of ["GET", "PUT"]) assert.deepEqual(await call(method, {}), { status: 401, body: { error: "not_signed_in" } });
  const unsigned = request("GET");
  unsigned.headers.set("cookie", "userId=10");
  assert.equal((await route.GET(unsigned, { params: Promise.resolve({ projectId: "7" }) })).status, 401);
  world.session = { userId: 10, agentId: "agent-1" };
  for (const method of ["GET", "PUT"]) assert.equal((await call(method, {})).status, 401);
  assert.deepEqual(world.fetches, []);
  world.session = { userId: 10, source: "better-auth" };
  assert.equal((await call("GET")).status, 200);
}));

test("non-admin is 403 and missing board is 404; cross-origin PUT cannot mutate", scenario(async () => {
  world.admins = [];
  assert.deepEqual(await call("GET"), { status: 403, body: { error: "board_access_denied" } });
  assert.equal((await call("PUT", { repositoryIds: [], version: "x" })).status, 403);
  world.admins = [10];
  assert.deepEqual(await call("GET", null, ORIGIN, "999"), { status: 404, body: { error: "not_found" } });
  assert.equal((await call("GET", null, ORIGIN, "2147483648")).status, 404);
  assert.equal((await call("PUT", {}, "https://evil.example")).status, 403);
  assert.equal((await call("PUT", {}, "")).status, 403);
  assert.deepEqual(world.writes, []);
  const initial = (await call("GET")).body;
  assert.equal((await call("PUT", { repositoryIds: ["456"], version: initial.version })).status, 200);
}));

test("PUT maps validation, repository and transport errors without leaking upstream details", scenario(async () => {
  assert.deepEqual(await call("PUT", "{"), { status: 400, body: { error: "invalid" } });
  const initial = (await call("GET")).body;
  assert.deepEqual(await call("PUT", { repositoryIds: ["999"], version: initial.version }), { status: 403, body: { error: "repo_not_installed", repositoryIds: ["999"] } });
  world.down = true;
  assert.deepEqual(await call("PUT", { repositoryIds: ["456"], version: initial.version }), { status: 503, body: { error: "github_unavailable" } });
  assert.deepEqual(world.writes, []);
}));

test("App JWT signs installation tokens and repository listing paginates with private/fork metadata", scenario(async () => {
  world.repositories["123"] = Array.from({ length: 101 }, (_, index) => repository({ id: index + 1, full_name: `Acme/Repo-${index}`, fork: index === 100 }));
  const result = await appApi.listInstallationRepositories("123", fakeGithub);
  assert.equal(result.length, 101);
  assert.deepEqual(result[100], { id: "101", fullName: "acme/repo-100", isPrivate: true, isFork: true });
  assert.equal(world.fetches.filter((url) => url.includes("/installation/repositories?")).length, 2);
}));

test("App transport fails closed on partial, failed, malformed, duplicate and excessive pages", scenario(async () => {
  const full = Array.from({ length: 100 }, (_, i) => repository({ id: i + 1 }));
  for (const pages of [
    [{ total_count: 101, repositories: full }, { total_count: 101, repositories: [] }],
    [{ total_count: 101, repositories: full }, { status: 502, body: { message: "SECRET upstream detail" } }],
    [{ total_count: 2, repositories: [repository()] }],
    [{ status: 206, body: { total_count: 1, repositories: [repository()] } }],
    [{ total_count: 1, repositories: [{ id: 1, full_name: "acme/api" }] }],
    [{ total_count: 2, repositories: [repository(), repository()] }],
    [{ total_count: 1001, repositories: full }],
    [{ total_count: 101, repositories: full }, { total_count: 102, repositories: [repository({ id: 101 })] }],
  ]) {
    world.pages = pages;
    await assert.rejects(appApi.listInstallationRepositories("123", fakeGithub), (error) => error instanceof userApi.GithubRequestError && !error.message.includes("SECRET"));
  }
  world.pages = null;
  world.repositories["123"] = Array.from({ length: 1000 }, (_, i) => repository({ id: i + 1 }));
  world.fetches = [];
  assert.equal((await appApi.listInstallationRepositories("123", fakeGithub)).length, 1000);
  assert.equal(world.fetches.filter((url) => url.includes("/installation/repositories?")).length, 10);
}));

test("App configuration and network failures are sanitized unavailable errors", scenario(async () => {
  for (const mode of ["config", "key", "network", "invalid-key"]) {
    world.config = mode === "config" ? null : { appId: "424242" };
    world.down = mode === "network";
    if (mode === "key") delete process.env.GITHUB_APP_PRIVATE_KEY;
    else process.env.GITHUB_APP_PRIVATE_KEY = mode === "invalid-key" ? "not a key" : privateKey;
    await assert.rejects(appApi.fetchInstallationToken("123", fakeGithub), (error) => error instanceof userApi.GithubRequestError && error.status === 503 && !error.message.includes("SECRET"));
  }
  world.down = false;
  process.env.GITHUB_APP_PRIVATE_KEY = privateKey;
  await assert.rejects(appApi.fetchInstallationToken("../123", fakeGithub), (error) => error instanceof userApi.GithubRequestError && error.status === 400);
}));
