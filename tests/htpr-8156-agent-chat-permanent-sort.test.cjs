const test = require("node:test");
const assert = require("node:assert/strict");
const { NextRequest } = require("next/server");
const { load } = require("./task-route-loader.cjs");

const agents = [
  { id: "poster", displayName: "Poster", lastPostedAt: "2026-10-29T12:00:00Z", lastChatMessageAt: null },
  { id: "chat", displayName: "Chat", lastPostedAt: null, lastChatMessageAt: "2026-10-28T12:00:00Z" },
  { id: "amy", displayName: "Amy", lastChatMessageAt: null },
].map((agent) => ({ ...agent, revokedAt: null, archivedAt: null, boards: [{ teamId: "team" }] }));

function navigation(rows, { search = "", teamId = null } = {}) {
  const { useAgentChatNavigation } = load("src/app/agents/chat/useAgentChatNavigation.ts", {
    react: { useMemo: (fn) => fn(), useCallback: (fn) => fn, useRef: (value) => ({ current: value }), useEffect() {} },
    "@/lib/agents/registerView": { listTeams: () => [{ id: "team" }] },
    "@/lib/lastBoardTeam": { setLastBoardTeam() {} },
    "@/lib/state": { useRecoilValue: () => null },
    "@/store": { agentChatTeamCycleAtom: "cycle" },
    "./AgentChatFeedItems": { agentDictationProjectId: () => null },
  });
  return useAgentChatNavigation({ agents: rows, selectedId: null, isMbl: false, search, teamId }).roster;
}

test("navigation always ranks chat recency above board posts and keeps name ties", () => {
  assert.deepEqual(navigation(agents).map((a) => a.id), ["chat", "amy", "poster"]);
  assert.deepEqual(agents.map((a) => a.id), ["poster", "chat", "amy"]);
  assert.deepEqual(navigation(agents, { search: "POST" }).map((a) => a.id), ["poster"]);
  assert.deepEqual(navigation([
    ...agents,
    { ...agents[0], id: "revoked", revokedAt: "2026-10-29" },
    { ...agents[0], id: "archived", archivedAt: "2026-10-29" },
    { ...agents[0], id: "other-team", boards: [{ teamId: "other" }] },
  ], { teamId: "team" }).map((a) => a.id), ["chat", "amy", "poster"]);
});

test("chat recency bumps reorder the real navigation without mutating the roster", () => {
  const { bumpRosterChatRecency } = load("src/app/agents/chat/rosterSort.ts", {});
  const bumped = bumpRosterChatRecency(agents, "poster", "2026-10-29T13:00:00Z");
  assert.deepEqual(navigation(bumped).map((a) => a.id), ["poster", "chat", "amy"]);
  assert.equal(agents[0].lastChatMessageAt, null);
  assert.equal(bumped[1], agents[1]);
  assert.equal(bumpRosterChatRecency(null, "poster", "2026-10-29"), null);
});

function ownedRoute(userId) {
  const queries = [];
  const agent = {
    id: "chat", displayName: "Chat", runtimeType: "EXTERNAL", permissions: {}, members: [], byokApiKeys: [],
    createdAt: new Date("2026-10-01"), revokedAt: null, archivedAt: null,
  };
  const db = {
    agent: { findMany: async ({ where }) => { assert.deepEqual(where, { userId }); return [agent]; } },
    comment: { groupBy: async () => [] },
    $queryRaw: async (strings, ...values) => {
      queries.push({ sql: strings.join("?"), values });
      return strings.join("").includes('MAX(m."createdAt")')
        ? [{ agentId: "chat", lastMessageAt: new Date("2026-10-28T12:00:00Z") }]
        : [{ agentId: "chat", unread: 2n }];
    },
  };
  const route = load("src/app/api/agents/owned/route.ts", {
    "@/lib/prisma": { default: db },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => userId ? { userId } : null },
    "@/lib/flags": { isOwnerOrQaUserId: async () => false },
    "@/app/api/ai/_lib/planGate": { haiku55ModelEnabled: async () => false },
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: () => ({}) },
    "@/lib/agents/working": { workingOnByAgent: async () => new Map() },
    "@/lib/agents/ownedSlugs": { ownedAgentSlugs: async () => new Map() },
    "@/lib/agents/maskAgentProviderKey": { maskAgentProviderKey: () => null },
    "@/lib/aiAllowancePolicy": { aiAllowancePeriod: () => ({ startDate: "2026-10-01", key: "2026-10" }) },
    "@/app/api/ai/_lib/heartbeatExecution": {},
    "@/lib/nativeAgent/agentMessageEnvelope": {},
    "@/lib/aiModelOptions": {},
    "@/utils/controllers/agents/ensureDefaultTeamAgent": {},
  });
  return { route, queries };
}

test("owned GET always returns participant-scoped last chat timestamps and unread counts", async () => {
  const { route, queries } = ownedRoute(2343);
  const response = await route.GET(new NextRequest("https://example.test/api/agents/owned"));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.success, true);
  assert.deepEqual(data.agents.map(({ id, lastChatMessageAt, unreadCount }) => ({ id, lastChatMessageAt, unreadCount })), [
    { id: "chat", lastChatMessageAt: "2026-10-28T12:00:00.000Z", unreadCount: 2 },
  ]);
  assert.equal(queries.length, 2);
  for (const query of queries) {
    assert.match(query.sql, /WHERE p\."userId" = \?/);
    assert.deepEqual(query.values, query.sql.includes('MAX(m."createdAt")') ? [2343] : [2343, 2343]);
  }
});

test("owned GET still refuses anonymous requests before querying chat data", async () => {
  const { route, queries } = ownedRoute(null);
  const response = await route.GET(new NextRequest("https://example.test/api/agents/owned"));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { success: false, error: "Unauthorized" });
  assert.deepEqual(queries, []);
});
