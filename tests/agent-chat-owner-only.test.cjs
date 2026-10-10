const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const React = require("react");

const root = path.resolve(__dirname, "..");
let userId = 6;
let ownerEmail = "valentin.yeo@gmail.com";
let businessCalls = 0;
let ownerGateMode = "EVERYONE";
let rateLimitCalls = 0;
let rateLimitResponse = null;
const checkRateLimit = async () => { rateLimitCalls++; return rateLimitResponse; };
const reached = () => { businessCalls++; throw new Error("REACHED_CHAT"); };
const downstream = new Proxy(reached, { get: () => downstream });
const prisma = new Proxy({ user: { findUnique: async () => ({ email: ownerEmail }) }, featureFlag: { findUnique: async () => ({ mode: ownerGateMode }) } }, { get: (obj, key) => key in obj ? obj[key] : downstream });
const json = (body, options = {}) => ({ body, status: options.status ?? 200, headers: new Headers(options.headers) });
const session = async () => userId ? { userId } : null;
const request = () => new Request("https://app.hypertask.ai/api/chat", {
  method: "POST", headers: { "Content-Type": "application/json", Origin: "https://app.hypertask.ai" },
  body: JSON.stringify({ agentId: "11111111-1111-4111-8111-111111111111", projectId: 15, text: "hello", content: "hello", clientMessageId: "message-1" }),
});

function load(relative, overrides = {}) {
  const filename = path.join(root, relative);
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const mocks = {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/auth/getSessionUser": { getSessionUser: session },
    "@/lib/flags": flags,
    "@/lib/flags/keys": keys,
    "next/server": { NextResponse: { json } },
    "next/headers": { headers: async () => new Headers(), cookies: async () => ({ get: () => ({ value: JSON.stringify({ id: userId }) }) }) },
    "next/navigation": { notFound: () => { throw new Error("NOT_FOUND"); }, redirect: reached },
    "@/lib/mcp/routeWrapper": { wrapMcpRoute: (handler) => handler, checkMcpRouteRateLimit: checkRateLimit, validateMcpRouteAuth: async () => userId ? ({ user: { id: userId }, agentId: "agent-1" }) : null },
    "@/lib/mcp/auth": { checkMcpRateLimit: async () => null },
    "@/lib/agentRuns/service": { authenticateAgentRunRequest: async () => ({ userId, source: "browser" }), browserMutationIsSameOrigin: () => true, stopAgentChatTurn: reached },
    "@/lib/agents/roomAccess": { loadUserAgentRoom: reached, loadAgentTokenRoom: reached },
    "@/lib/agents/chatAccess": { loadUserAgentChatSession: reached, loadAgentTokenChatSession: reached },
    "@/lib/api/rateLimit": { checkRestRateLimit: async () => null },
    ...overrides,
  };
  const requireModule = (id) => {
    if (Object.hasOwn(mocks, id)) return mocks[id];
    if (["react", "react/jsx-runtime", "zod"].includes(id)) return require(id);
    return new Proxy({ __esModule: true, default: downstream }, { get: (obj, key) => key in obj ? obj[key] : downstream });
  };
  vm.runInNewContext(`(function(require,exports){${source}\n})`, { console: { error() {}, warn() {} }, Headers, URL, Request, process, Buffer, setTimeout })(requireModule, exports);
  return exports;
}

let flags;
let keys;
keys = load("src/lib/flags/keys.ts", {
  "./definitions/index.generated": { HTPR_7070_AGENT_CHAT_OWNER_ONLY_FLAG: "htpr-7070-agent-chat-owner-only", HTPR_7070_PARKED_FLAGS_FLAG: "htpr-7070-parked-flags" },
});
flags = load("src/lib/flags.ts", {
  "@/lib/flags/definitions": { FEATURE_FLAG_DEFINITIONS: [] },
  "react": { cache: (fn) => fn },
  "@/lib/agentRuns/model": { AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG: "htpr-6154-chat-stop-and-timeout" },
});
// Exercise the real admin identity check, not a stubbed owner boolean.
flags.isFeatureEnabled = async () => true;
const page = load("src/app/agents/chat/page.tsx").default;
const layout = load("src/app/agents/chat/layout.tsx").default;

function routes(directory) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const filename = `${directory}/${entry.name}`;
    return entry.isDirectory() ? routes(filename) : entry.name === "route.ts" ? [filename] : [];
  });
}
const dedicated = ["src/app/api/agent-chat", "src/app/api/agent-rooms", "src/app/api/mcp/chat"].flatMap(routes);
const params = () => ({ params: Promise.resolve({ sessionId: "session-1", roomId: "room-1", proposalId: "proposal-1", messageId: "message-1" }) });

test.beforeEach(() => { ownerGateMode = "EVERYONE"; userId = 6; ownerEmail = "valentin.yeo@gmail.com"; businessCalls = 0; rateLimitCalls = 0; rateLimitResponse = null; });

test("the admin owner identity requires both the signed-in ID and stored email", async () => {
  assert.equal(await flags.isFeatureFlagOwner(new Headers()), true);
  ownerEmail = "different@example.com";
  assert.equal(await flags.isFeatureFlagOwner(new Headers()), false);
  ownerEmail = " VALENTIN.YEO@GMAIL.COM ";
  assert.equal(await flags.isFeatureFlagOwner(new Headers()), true);
  for (const id of [7, 985, 0]) {
    userId = id;
    assert.equal(await flags.isFeatureFlagOwner(new Headers()), false);
  }
});

for (const id of [7, 985, 0]) {
  test(`page, rooms view and subtree layout return not found for user ${id}`, async () => {
    userId = id;
    for (const view of [undefined, "rooms"]) await assert.rejects(page({ searchParams: Promise.resolve({ view }) }), /NOT_FOUND/);
    await assert.rejects(layout({ children: "sub-route" }), /NOT_FOUND/);
    assert.equal(businessCalls, 0);
  });
}

test("owner can render direct chat, rooms, and subtree children", async () => {
  for (const view of [undefined, "rooms"]) assert.ok(React.isValidElement(await page({ searchParams: Promise.resolve({ view }) })));
  assert.equal(await layout({ children: "sub-route" }), "sub-route");
});

for (const filename of dedicated) {
  const route = load(filename);
  for (const method of ["GET", "POST", "PATCH", "DELETE"].filter((method) => typeof route[method] === "function")) {
    for (const id of [7, 985, 0]) {
      test(`${filename} ${method} refuses user ${id} before business logic`, async () => {
        userId = id;
        // MCP routes keep their production order: rate limit first, then the owner gate.
        if (!filename.includes("/api/mcp/")) rateLimitResponse = json({ error: "Too many requests" }, { status: 429 });
        const response = await route[method](request(), params());
        assert.equal(response.status, filename.includes("/api/mcp/") && id === 0 ? 401 : 404);
        assert.equal(businessCalls, 0);
        if (!filename.includes("/api/mcp/")) assert.equal(rateLimitCalls, 0);
      });
    }
    test(`${filename} ${method} admits the owner to existing validation or business logic`, async () => {
      let response;
      try { response = await route[method](request(), params()); } catch (error) { assert.match(error.message, /REACHED_CHAT/); }
      assert.ok(businessCalls > 0 || response?.status === 400, `${filename}: owner must get past the access gate`);
    });
  }
}

test("with the owner-only flag off every Agent Chat page and route keeps production access", async () => {
  ownerGateMode = "OFF";
  for (const id of [7, 985]) {
    userId = id;
    for (const view of [undefined, "rooms"]) assert.ok(React.isValidElement(await page({ searchParams: Promise.resolve({ view }) })));
    assert.equal(await layout({ children: "sub-route" }), "sub-route");
    assert.equal(await flags.canUseAgentChat(new Headers()), true);
    assert.equal(await flags.canUseAgentChatUser(id), true);
  }
  userId = 7;
  for (const filename of dedicated) {
    const route = load(filename);
    for (const method of ["GET", "POST", "PATCH", "DELETE"].filter((method) => typeof route[method] === "function")) {
      businessCalls = 0;
      let response;
      try { response = await route[method](request(), params()); } catch (error) { assert.match(error.message, /REACHED_CHAT/); }
      assert.ok(businessCalls > 0 || (response && response.status !== 404), `${filename} ${method}: flag off must not add the owner gate`);
    }
  }
});

test("with the owner-only flag off a missing MCP token still gets the previous 401 and rate limit order", async () => {
  ownerGateMode = "OFF";
  userId = 0;
  rateLimitResponse = json({ error: "Too many requests" }, { status: 429 });
  const route = load("src/app/api/mcp/chat/pending/route.ts");
  assert.equal((await route.GET(request())).status, 429);
  assert.equal(rateLimitCalls, 1);
  rateLimitResponse = null;
  assert.equal((await route.GET(request())).status, 401);
});

test("owner-only flag on: owner and QA decisions come from one helper", async () => {
  assert.equal(await flags.canUseAgentChatUser(6), true);
  for (const id of [7, 985]) assert.equal(await flags.canUseAgentChatUser(id), false);
  ownerGateMode = "OWNER_ONLY";
  assert.equal(await flags.canUseAgentChatUser(6), true);
  userId = 0;
  assert.equal(await flags.canUseAgentChat(new Headers()), false);
  ownerGateMode = "EVERYONE";
  assert.equal(await flags.canUseAgentChat(new Headers()), false);
});

test("shared session creation refuses only the agent branch for ordinary and QA users", async () => {
  const route = load("src/app/api/ai-chat/create-session/route.ts", { "@/lib/flags": { ...flags, isFeatureEnabled: async () => false } });
  for (const id of [7, 985]) {
    userId = id;
    assert.equal((await route.POST(request())).status, 404);
    assert.equal(businessCalls, 0);
    const ordinary = new Request("https://app.hypertask.ai/api/ai-chat/create-session", { method: "POST", body: "{}" });
    await route.POST(ordinary);
    assert.ok(businessCalls > 0);
    businessCalls = 0;
  }
});

test("with the owner-only flag off shared AI session endpoints keep every session visible", async () => {
  ownerGateMode = "OFF";
  userId = 7;
  const wheres = [];
  const db = { chatSession: { findMany: async ({ where }) => { wheres.push(where); return []; } } };
  const mocks = {
    "@/lib/prisma": { __esModule: true, default: db },
    "@/lib/flags": { ...flags, isFeatureEnabled: async () => false },
    "next/headers": { cookies: async () => ({ get: () => ({ value: '{"id":6}' }) }) },
    "@/lib/auth/currentUser": { loadCurrentUser: async () => ({ userId: 7, user: { id: 7 } }) },
    "@/utils/edgeHelpers": { isValidUser: () => ({ isValid: true, user: { id: 7 } }) },
  };
  const req = new Request("https://app.hypertask.ai/api/ai-chat/test?taskId=15");
  req.nextUrl = new URL(req.url);
  await load("src/app/api/ai-chat/task-sessions/route.ts", mocks).GET(req);
  assert.equal(wheres.length, 1);
  assert.equal(wheres[0].OR, undefined);
  const create = load("src/app/api/ai-chat/create-session/route.ts", { "@/lib/flags": { ...flags, isFeatureEnabled: async () => false } });
  assert.notEqual((await create.POST(request())).status, 404);
});

test("shared AI session endpoints cannot read or mutate agent threads through a forged profile cookie", async () => {
  for (const id of [7, 985]) {
    userId = id;
    const queries = [];
    let mutations = 0;
    const db = {
      chatSession: {
        findFirst: async ({ where }) => { queries.push(where); return where.OR ? null : { id: "thread", agentId: "agent-1" }; },
        findMany: async ({ where }) => { queries.push(where); return where.OR ? [{ id: "ordinary", agentId: null }, { id: "native", agentId: "native-agent" }] : [{ id: "thread", agentId: "agent-1" }]; },
        update: async () => { mutations++; }, delete: async () => { mutations++; },
      },
    };
    const mocks = {
      "@/lib/prisma": { __esModule: true, default: db },
      "@/lib/flags": { ...flags, isFeatureEnabled: async () => false },
      "next/headers": { cookies: async () => ({ get: () => ({ value: '{"id":6}' }) }) },
      "@/lib/auth/currentUser": { loadCurrentUser: async () => ({ userId: id, user: { id } }) },
      "@/utils/edgeHelpers": { isValidUser: () => ({ isValid: true, user: { id: 6 } }) },
    };
    for (const [folder, method] of [["update-session", "POST"], ["add-message", "POST"], ["delete-session", "DELETE"]]) {
      const req = new Request("https://app.hypertask.ai/api/ai-chat/test?delete=thread", {
        method, body: method === "POST" ? JSON.stringify({ sessionId: "thread", title: "Changed", message: { content: "hello" } }) : undefined,
      });
      assert.equal((await load(`src/app/api/ai-chat/${folder}/route.ts`, mocks)[method](req)).status, 404);
    }
    for (const folder of ["all-sessions", "task-sessions"]) {
      const req = new Request("https://app.hypertask.ai/api/ai-chat/test?taskId=15");
      req.nextUrl = new URL(req.url);
      const response = await load(`src/app/api/ai-chat/${folder}/route.ts`, mocks).GET(req);
      assert.equal(response.status, 200);
      assert.deepEqual(Array.from(response.body.sessions, (session) => session.id), ["ordinary", "native"]);
      assert.ok(queries.at(-1).OR.some((clause) => clause.agent?.runtimeType?.not === "EXTERNAL"));
    }
    assert.equal(mutations, 0);
  }
});

test("public flag bootstrap exposes the same verified owner capability, never QA access", async () => {
  const route = load("src/app/api/flags/route.ts", { "@/lib/flags": { ...flags, featureFlagsForUser: async () => ({}) } });
  for (const id of [6, 7, 985]) {
    userId = id;
    const response = await route.GET(request());
    assert.equal(response.status, 200);
    assert.equal(response.body.isOwner, id === 6);
  }
});

test("navigation commands, local palette group and shortcut help are absent for non-owners", () => {
  const enums = load("src/models/enums.ts");
  const navigation = load("src/components/Modals/commands/HTC/navigationCommands.ts", { "@/models/enums": enums });
  const all = load("src/components/Modals/commands/HTC/AllCommands.ts", {
    "@/models/enums": enums,
    "./navigationCommands": navigation,
  });
  const shortcuts = load("src/lib/constants/shortcuts.ts");
  for (const owner of [false, true]) {
    const options = { context: "Others", agentChatOwner: owner, agentChatOn: true };
    assert.equal(navigation.getNavigateCommands(options).commandLists.some((command) => command.key === "GoToAgentChat"), owner);
    // The complete registry is checked separately by existing command tests.
    assert.match(fs.readFileSync(path.join(root, "src/components/Modals/commands/HTC/AllCommands.ts"), "utf8"), /commandOptions\.agentChatOwner && commandOptions\.agentChatOn \? \[agentChat\]/);
    assert.equal(shortcuts.getKeyboardShortcuts(false, false, "Toggle history events", false, false, owner).some((group) => group.title === "Agent Chat"), owner);
  }
  assert.equal(typeof all.getAllCommands, "function");
  for (const filename of ["src/components/Modals/commands/HTC/commands.tsx", "src/components/commands.tsx", "src/components/Modals/Settings/ShortcutsSection.tsx", "src/components/sidebars/keyboardShortcuts.tsx"]) {
    assert.match(fs.readFileSync(path.join(root, filename), "utf8"), /useAgentChatAllowed\(\)/);
  }
});

test("Agent Chat entry points stay hidden until flags load, then follow the owner-only flag and owner capability", () => {
  let ctx;
  let hydrated;
  const hook = load("src/hooks/useAgentChatAllowed.ts", {
    react: { ...React, useContext: () => ctx },
    "@/hooks/General/useHydrated": { useHydrated: () => hydrated },
    "@/hooks/featureFlagsContext": { FeatureFlagsContext: {} },
  }).useAgentChatAllowed;
  const gate = "htpr-7070-agent-chat-owner-only";
  const base = { seeded: false, fallback: false };
  const cases = [
    [{ values: {}, ...base }, false, false],
    [{ values: {}, seeded: true, fallback: false }, true, false],
    [{ values: { [gate]: false }, ...base }, false, false],
    [{ values: { [gate]: false }, ...base }, true, true],
    [{ values: { [gate]: true, __featureFlagOwner: false }, ...base }, true, false],
    [{ values: { [gate]: true }, seeded: true, fallback: false }, true, false],
    [{ values: { [gate]: true, __featureFlagOwner: true }, ...base }, true, true],
    [{ values: { [gate]: true, __featureFlagOwner: true }, ...base }, false, false],
  ];
  for (const [value, isHydrated, expected] of cases) {
    ctx = value;
    hydrated = isHydrated;
    assert.equal(hook(), expected, JSON.stringify([value, isHydrated]));
  }
});

test("managed agents and general MCP do not acquire the Agent Chat owner gate", () => {
  for (const filename of ["src/app/agents/page.tsx", "src/app/agents/[agentId]/page.tsx", ...routes("src/app/api/agents"), "src/app/api/mcp/agents/route.ts"]) {
    assert.doesNotMatch(fs.readFileSync(path.join(root, filename), "utf8"), /isFeatureFlagOwner/);
  }
  assert.match(fs.readFileSync(path.join(root, "src/hooks/useFlag.tsx"), "utf8"), /__featureFlagOwner: body\.isOwner === true/);
  assert.match(fs.readFileSync(path.join(root, "src/app/api/flags/route.ts"), "utf8"), /isOwner: await isFeatureFlagOwnerUser\(session\.userId\)/);
});


test("shared ticket provenance has no Agent Chat entry link", () => {
  const { escapeHtml } = load("src/utils/htmlEscape.ts");
  const proposal = load("src/lib/agents/chatTicketProposal.ts", { "@/utils/htmlEscape": { escapeHtml } });
  const html = proposal.chatProposalDescriptionHtml({ outcome: "Ready <script>", agentName: "Helper <bot>", agentRef: "helper", plainProvenance: true });
  assert.doesNotMatch(html, /href=|agents\/chat/);
  assert.match(html, /Helper &lt;bot&gt;/);
  assert.match(html, /Ready &lt;script&gt;/);
  const original = proposal.chatProposalDescriptionHtml({ outcome: "Ready", agentName: "Helper <bot>", agentRef: "helper" });
  assert.equal(original, '<p>Ready</p><p>Confirmed by the user in Agent Chat with <a href="/agents/chat?agent=helper">Helper &lt;bot&gt;</a>.</p>');
});
