// HTPR-6002: the durable side of an agent conversation. Who wrote each
// message, one authorization rule for every chat route, and history that can
// be read in order and in pages.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
let loadId = 0;

function stub(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function load(relativePath) {
  return createJiti(
    path.join(root, `tests/agent-chat-durable-conversation-${++loadId}.cjs`),
    { alias: { "@": path.join(root, "src") }, interopDefault: true },
  )(path.join(root, relativePath));
}

// ---------------------------------------------------------------------------
// A small stand-in database. Sessions and agents are matched against the real
// `where` the code builds, so the authorization rule is exercised rather than
// read.
// ---------------------------------------------------------------------------
const AGENTS = {
  "agent-live": {
    id: "agent-live",
    revokedAt: null,
    ownerId: 6,
    sharedWith: [6, 7],
  },
  "agent-revoked": {
    id: "agent-revoked",
    revokedAt: new Date("2026-09-01"),
    ownerId: 6,
    sharedWith: [6],
  },
  "agent-private": {
    id: "agent-private",
    revokedAt: null,
    ownerId: 6,
    sharedWith: [6],
  },
  // The create-session route validates the id as a uuid, so the open path
  // needs one that looks real.
  "11111111-1111-4111-8111-111111111111": {
    id: "11111111-1111-4111-8111-111111111111",
    revokedAt: null,
    ownerId: 6,
    sharedWith: [6, 7],
  },
};

const OPENABLE_AGENT = "11111111-1111-4111-8111-111111111111";

const SESSIONS = [
  {
    id: "session-1",
    userId: 6,
    agentId: "agent-live",
    teamId: "team-a",
    runtimeType: "EXTERNAL",
  },
  { id: "session-revoked", userId: 6, agentId: "agent-revoked", teamId: "team-a" },
  // Same agent, but the conversation was scoped to a team 6 is not in: this is
  // the shape an agent that moved teams leaves behind.
  { id: "session-other-team", userId: 9, agentId: "agent-live", teamId: "team-z" },
  // No team of its own, so it never got past the person who opened it.
  { id: "session-teamless", userId: 9, agentId: "agent-live", teamId: null },
  { id: "session-plain", userId: 6, agentId: null, teamId: null },
  // Owned by 7, but agent-private is shared only with 6: the sharing clause is
  // the only thing that can deny this one.
  { id: "session-unshared", userId: 7, agentId: "agent-private", teamId: "team-a" },
];

// Which teams each person is an accepted member of.
const TEAMS = { 6: ["team-a"], 7: ["team-a"], 9: ["team-a", "team-z"] };

let messages = [];
let participants = [];

function agentMatches(agent, where) {
  if (!where) return true;
  if (where.revokedAt === null && agent.revokedAt !== null) return false;
  // Stands in for accessibleAgentWhere: the requester must still share a board
  // with the agent, which is how this codebase draws the team boundary.
  // Fail closed, so dropping that clause from the real rule fails here rather
  // than quietly widening access.
  assert.notEqual(
    where.__visibleTo,
    undefined,
    "the rule must still narrow the agent to one the requester can see",
  );
  return agent.sharedWith.includes(where.__visibleTo);
}

function sessionMatches(session, where) {
  if (where.id !== undefined && session.id !== where.id) return false;
  if (where.userId !== undefined && session.userId !== where.userId) return false;
  if (where.teamId !== undefined) {
    if (where.teamId === null) {
      if (session.teamId !== null) return false;
    } else if (where.teamId.in) {
      if (!where.teamId.in.includes(session.teamId)) return false;
    } else if (session.teamId !== where.teamId) {
      // A shape this stub does not model must still narrow, or the DENIED
      // table below would pass without the rule doing anything.
      return false;
    }
  }
  // The scope clause: the conversation's own team, or its creator when it has
  // none. A person's rule must carry it -- fail closed, so dropping it from the
  // real rule fails here instead of quietly handing an old team's transcript to
  // a new one. An agent's own token is the other side of the conversation and
  // is scoped by its identity instead, so it has no agent clause and no scope.
  if (where.agent !== undefined) {
    assert.ok(where.OR, "the rule must still scope a thread to its own team");
  }
  if (where.OR && !where.OR.some((branch) => sessionMatches(session, branch))) {
    return false;
  }
  if (where.agentId?.not === null && session.agentId === null) return false;
  if (where.agent) {
    const agent = AGENTS[session.agentId];
    if (!agent || !agentMatches(agent, where.agent)) return false;
  }
  return true;
}

function orderedDesc(rows) {
  return [...rows].sort((left, right) => {
    const byTime = right.createdAt - left.createdAt;
    return byTime !== 0 ? byTime : right.id.localeCompare(left.id);
  });
}

const prisma = {
  chatSession: {
    findFirst: async ({ where }) => SESSIONS.find((s) => sessionMatches(s, where)) ?? null,
    upsert: async ({ create }) => {
      createdSessions.push(create);
      return { id: "session-1", teamId: create.teamId ?? null };
    },
    updateMany: async () => ({ count: 1 }),
  },
  chatMessage: {
    findFirst: async ({ where }) =>
      messages.find(
        (message) =>
          message.id === where.id &&
          (where.sessionId === undefined || message.sessionId === where.sessionId),
      ) ?? null,
    findMany: async ({ where, orderBy, take, cursor, skip }) => {
      assert.deepEqual(
        orderBy,
        [{ createdAt: "desc" }, { id: "desc" }],
        "same-millisecond messages need id as the tiebreak, or a page boundary moves",
      );
      let rows = orderedDesc(messages.filter((m) => m.sessionId === where.sessionId));
      if (cursor) {
        const at = rows.findIndex((row) => row.id === cursor.id);
        assert.notEqual(at, -1, "cursor must exist in the ordered set");
        rows = rows.slice(at + (skip ?? 0));
      }
      return rows.slice(0, take);
    },
    count: async ({ where }) => {
      // An agent's reply has no author user, and those are exactly the rows
      // that should count as unread, so the clause has to name the null case.
      const mine = where.OR?.find((branch) => branch.authorUserId?.not)
        ?.authorUserId.not;
      assert.ok(
        where.OR?.some((branch) => branch.authorUserId === null),
        "a bare NOT would drop the agent's own replies from the count",
      );
      return messages.filter(
        (message) =>
          message.sessionId === where.sessionId &&
          message.createdAt > where.createdAt.gt &&
          (message.authorUserId === null ||
            message.authorUserId === undefined ||
            message.authorUserId !== mine),
      ).length;
    },
  },
  chatSessionParticipant: {
    upsert: async ({ where, create }) => {
      const key = where.sessionId_userId;
      const existing = participants.find(
        (row) => row.sessionId === key.sessionId && row.userId === key.userId,
      );
      if (existing) return existing;
      const row = { joinedAt: new Date(), lastReadAt: null, draft: null, ...create };
      participants.push(row);
      return row;
    },
    findMany: async ({ where }) =>
      participants
        .filter((row) => row.sessionId === where.sessionId)
        .map((row) => ({ ...row, user: { displayName: `user ${row.userId}`, email: "" } })),
    update: async ({ where, data }) => {
      const key = where.sessionId_userId;
      const row = participants.find(
        (candidate) =>
          candidate.sessionId === key.sessionId && candidate.userId === key.userId,
      );
      assert.ok(row, "update of a participant row that was never created");
      Object.assign(row, data);
      return row;
    },
    findUnique: async ({ where }) => {
      const key = where.sessionId_userId;
      return (
        participants.find(
          (row) =>
            row.sessionId === key.sessionId && row.userId === key.userId,
        ) ?? null
      );
    },
    // The read marker is written through updateMany because it carries a
    // "only if this is newer" guard that a keyed update cannot express. The
    // stub honours that guard, so a test can prove the marker never goes back.
    updateMany: async ({ where, data }) => {
      assert.ok(
        Array.isArray(where.OR),
        "the read marker must be written with a forward-only guard",
      );
      const matches = participants.filter((row) => {
        if (row.sessionId !== where.sessionId || row.userId !== where.userId) {
          return false;
        }
        return where.OR.some((clause) =>
          clause.lastReadAt === null
            ? row.lastReadAt === null
            : row.lastReadAt !== null && row.lastReadAt < clause.lastReadAt.lt,
        );
      });
      for (const row of matches) Object.assign(row, data);
      return { count: matches.length };
    },
  },
  member_Team: {
    findMany: async ({ where }) =>
      (TEAMS[where.userId] ?? []).map((teamId) => ({ teamId })),
  },
  agent: {
    findFirst: async ({ where }) => {
      const agent = AGENTS[where.id];
      if (!agent || !agent.sharedWith.includes(where.__visibleTo)) return null;
      return { id: agent.id, displayName: agent.id, userId: agent.ownerId };
    },
  },
  agentWebhookSubscription: {
    findUnique: async () => ({ active: true, events: ["chat.message"] }),
  },
};

let sessionUserId = 6;

stub("src/lib/prisma.ts", { default: prisma });
stub("src/lib/auth/getSessionUser.ts", {
  getSessionUser: async () => ({ userId: sessionUserId }),
});
stub("src/lib/agents/visibility.ts", {
  accessibleAgentWhere: (userId) => ({ __visibleTo: userId }),
});
stub("src/lib/flags.ts", {
  AGENT_CHAT_TICKET_CONFIRM_FLAG: "htpr-6006-chat-confirm-ticket",
  isFeatureEnabled: async () => false,
});
stub("src/lib/agents/agentChatActivity.ts", {
  listAgentChatActivity: async () => [],
});

const chatAccess = load("src/lib/agents/chatAccess.ts");
stub("src/utils/controllers/agents/boardMembers.ts", {
  getAgentTeamIds: async () => agentTeams,
});
let agentTeams = new Map([[OPENABLE_AGENT, "team-a"]]);
let createdSessions = [];

const historyRoute = load("src/app/api/agent-chat/[sessionId]/route.ts");
const createSessionRoute = load("src/app/api/ai-chat/create-session/route.ts");
const participantRoute = load(
  "src/app/api/agent-chat/[sessionId]/participant/route.ts",
);

function message(index, sessionId = "session-1") {
  return {
    id: `message-${String(index).padStart(3, "0")}`,
    sessionId,
    role: index % 2 === 0 ? "assistant" : "human",
    content: `message ${index}`,
    // Every row shares one timestamp: the ordering must survive it.
    createdAt: new Date(Date.UTC(2026, 8, 4, 12, 0, 0)),
  };
}

function historyRequest(query = "") {
  return new Request(
    `https://app.hypertask.ai/api/agent-chat/session-1${query}`,
  );
}

function routeContext(sessionId = "session-1") {
  return { params: Promise.resolve({ sessionId }) };
}

// ---------------------------------------------------------------------------
// Authorization boundaries, one rule, both callers
// ---------------------------------------------------------------------------
test("a person reaches their own live agent thread", async () => {
  const access = await chatAccess.loadUserAgentChatSession({
    sessionId: "session-1",
    userId: 6,
    select: {},
  });
  assert.equal(access.ok, true);
  assert.equal(access.agentId, "agent-live");
});

const DENIED = [
  ["a thread scoped to a team they are not in", "session-other-team", 6],
  ["a thread with no team, opened by someone else", "session-teamless", 6],
  ["a thread whose agent was revoked", "session-revoked", 6],
  ["a thread whose agent is no longer shared with them", "session-unshared", 7],
  ["a thread that is not an agent thread", "session-plain", 6],
  ["a thread that does not exist", "session-missing", 6],
];

for (const [label, sessionId, userId] of DENIED) {
  test(`the shared rule refuses ${label}`, async () => {
    const access = await chatAccess.loadUserAgentChatSession({
      sessionId,
      userId,
      select: {},
    });
    assert.equal(access.ok, false);
    assert.equal(access.status, 404);
    assert.equal(access.error, chatAccess.AGENT_CHAT_SESSION_NOT_FOUND);
  });
}

test("an agent token reaches only its own thread", async () => {
  const own = await chatAccess.loadAgentTokenChatSession({
    sessionId: "session-1",
    agentId: "agent-live",
    select: {},
  });
  assert.equal(own.ok, true);

  const foreign = await chatAccess.loadAgentTokenChatSession({
    sessionId: "session-1",
    agentId: "agent-private",
    select: {},
  });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.status, 403, "a mismatched identity is diagnosable, not hidden");
  assert.equal(foreign.error, chatAccess.AGENT_CHAT_WRONG_AGENT);

  const missing = await chatAccess.loadAgentTokenChatSession({
    sessionId: "session-missing",
    agentId: "agent-live",
    select: {},
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 404);
});

test("the history route refuses a revoked agent's thread", async () => {
  messages = [message(1, "session-revoked")];
  const response = await historyRoute.GET(
    new Request("https://app.hypertask.ai/api/agent-chat/session-revoked"),
    routeContext("session-revoked"),
  );
  assert.equal(response.status, 404);
});

// ---------------------------------------------------------------------------
// Ordering and pagination
// ---------------------------------------------------------------------------
test("history returns one page oldest first and reports more above it", async () => {
  messages = Array.from({ length: 5 }, (_, index) => message(index + 1));

  const response = await historyRoute.GET(historyRequest("?limit=2"), routeContext());
  const body = await response.json();

  assert.deepEqual(
    body.messages.map((m) => m.id),
    ["message-004", "message-005"],
    "a page is the newest rows, handed back oldest first",
  );
  assert.equal(body.hasMore, true);
  assert.equal(body.nextBefore, "message-004", "paging continues above the page");
  assert.equal(body.awaiting, true, "the newest message is the person's, so the agent owes a reply");
});

test("the page above continues from the cursor without repeating a row", async () => {
  messages = Array.from({ length: 5 }, (_, index) => message(index + 1));

  const first = await (
    await historyRoute.GET(historyRequest("?limit=2"), routeContext())
  ).json();
  const second = await (
    await historyRoute.GET(
      historyRequest(`?limit=2&before=${first.nextBefore}`),
      routeContext(),
    )
  ).json();

  assert.deepEqual(second.messages.map((m) => m.id), ["message-002", "message-003"]);
  assert.equal(second.hasMore, true);
  assert.equal(
    second.awaiting,
    null,
    "an older page says nothing about whose turn it is",
  );

  const third = await (
    await historyRoute.GET(
      historyRequest(`?limit=2&before=${second.nextBefore}`),
      routeContext(),
    )
  ).json();
  assert.deepEqual(third.messages.map((m) => m.id), ["message-001"]);
  assert.equal(third.hasMore, false);
  assert.equal(third.nextBefore, null);
});

test("a paged read says the feed is absent, not empty", async () => {
  messages = Array.from({ length: 3 }, (_, index) => message(index + 1));

  const first = await (
    await historyRoute.GET(historyRequest("?limit=1"), routeContext())
  ).json();
  assert.deepEqual(first.activity, [], "the newest page carries the feed");

  const older = await (
    await historyRoute.GET(
      historyRequest(`?limit=1&before=${first.nextBefore}`),
      routeContext(),
    )
  ).json();
  assert.equal(
    older.activity,
    null,
    "an empty list would read as 'this thread has no activity'",
  );
});

test("a cursor from another thread is rejected instead of paging it", async () => {
  messages = [message(1), message(2, "session-other-team")];
  const response = await historyRoute.GET(
    historyRequest("?before=message-002"),
    routeContext(),
  );
  assert.equal(response.status, 400);
});

test("limit is capped so one request cannot pull the whole transcript", async () => {
  messages = Array.from({ length: 3 }, (_, index) => message(index + 1));
  let requestedTake = null;
  const realFindMany = prisma.chatMessage.findMany;
  prisma.chatMessage.findMany = async (args) => {
    requestedTake = args.take;
    return realFindMany(args);
  };
  try {
    await historyRoute.GET(historyRequest("?limit=100000"), routeContext());
  } finally {
    prisma.chatMessage.findMany = realFindMany;
  }
  // 200 rows plus the one has-more probe.
  assert.equal(requestedTake, 201);
});

// ---------------------------------------------------------------------------
// One shared conversation, with private state inside it
// ---------------------------------------------------------------------------
test("everyone the agent is shared with reads the same thread", async () => {
  const opener = await chatAccess.loadUserAgentChatSession({
    sessionId: "session-1",
    userId: 6,
    select: {},
  });
  const teammate = await chatAccess.loadUserAgentChatSession({
    sessionId: "session-1",
    userId: 7,
    select: {},
  });
  assert.equal(opener.ok, true);
  assert.equal(
    teammate.ok,
    true,
    "a teammate on the same board joins the conversation instead of getting a private copy",
  );
  assert.equal(teammate.session.id, opener.session.id);
});

test("opening a thread records who turned up", async () => {
  participants = [];
  messages = [message(1)];
  sessionUserId = 7;
  try {
    const body = await (
      await historyRoute.GET(historyRequest(), routeContext())
    ).json();
    assert.deepEqual(
      body.participants.map((row) => row.userId),
      [7],
      "reading the thread is taking part in it",
    );
  } finally {
    sessionUserId = 6;
  }
});

test("unread counts what arrived after you caught up, and never your own", async () => {
  const caughtUpAt = new Date(Date.UTC(2026, 8, 4, 12, 0, 0));
  participants = [
    {
      sessionId: "session-1",
      userId: 6,
      joinedAt: caughtUpAt,
      lastReadAt: caughtUpAt,
      draft: null,
    },
  ];
  const later = (minutes, authorUserId) => ({
    ...message(minutes),
    createdAt: new Date(Date.UTC(2026, 8, 4, 12, minutes, 0)),
    authorUserId,
  });
  // One before the marker, two from a teammate, one from the agent, one of mine.
  messages = [
    { ...message(9), authorUserId: 7 },
    later(1, 7),
    later(2, 7),
    later(3, null),
    later(4, 6),
  ];

  const body = await (
    await historyRoute.GET(historyRequest(), routeContext())
  ).json();
  assert.equal(
    body.viewer.unreadCount,
    3,
    "my own message is not news to me, and neither is one I had already read",
  );
});

test("a draft is private to the person who typed it", async () => {
  participants = [];
  messages = [message(1)];
  const patch = (sessionId, body) =>
    participantRoute.PATCH(
      new Request(`https://app.hypertask.ai/api/agent-chat/${sessionId}/participant`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
      routeContext(sessionId),
    );

  sessionUserId = 6;
  assert.equal((await patch("session-1", { draft: "mine" })).status, 200);
  sessionUserId = 7;
  assert.equal((await patch("session-1", { draft: "theirs" })).status, 200);
  sessionUserId = 6;

  assert.deepEqual(
    participants
      .filter((row) => row.sessionId === "session-1")
      .map((row) => [row.userId, row.draft]),
    [
      [6, "mine"],
      [7, "theirs"],
    ],
    "one row each: writing a draft must never reach anyone else's composer",
  );

  const mine = await (
    await historyRoute.GET(historyRequest(), routeContext())
  ).json();
  assert.equal(mine.viewer.draft, "mine");
});

test("a slow catch-up cannot drag the read marker back", async () => {
  // Two tabs catch up at once. The one that started first can commit last, and
  // an unconditional write would then resurrect messages already read.
  const ahead = new Date(Date.now() + 60_000);
  participants = [
    { sessionId: "session-1", userId: 6, joinedAt: new Date(0), lastReadAt: ahead, draft: null },
  ];
  messages = [message(1)];
  const response = await participantRoute.PATCH(
    new Request("https://app.hypertask.ai/api/agent-chat/session-1/participant", {
      method: "PATCH",
      body: JSON.stringify({ read: true }),
    }),
    routeContext(),
  );
  assert.equal(response.status, 200);
  const row = participants.find((candidate) => candidate.userId === 6);
  assert.equal(
    row.lastReadAt.getTime(),
    ahead.getTime(),
    "a marker already further ahead must stay where it is",
  );
});

test("the read marker is stamped by the server, so it cannot move backwards", async () => {
  participants = [];
  messages = [message(1)];
  const response = await participantRoute.PATCH(
    new Request("https://app.hypertask.ai/api/agent-chat/session-1/participant", {
      method: "PATCH",
      // A client-supplied time is not part of the contract; it must be ignored.
      body: JSON.stringify({ read: true, lastReadAt: "1999-01-01T00:00:00.000Z" }),
    }),
    routeContext(),
  );
  assert.equal(response.status, 200);
  const row = participants.find((candidate) => candidate.userId === 6);
  assert.ok(
    row.lastReadAt > new Date(Date.UTC(2026, 0, 1)),
    "the server stamps now(), it does not take a cursor from the client",
  );
});

test("the participant route refuses a thread the person cannot reach", async () => {
  participants = [];
  const response = await participantRoute.PATCH(
    new Request(
      "https://app.hypertask.ai/api/agent-chat/session-other-team/participant",
      { method: "PATCH", body: JSON.stringify({ draft: "leak" }) },
    ),
    routeContext("session-other-team"),
  );
  assert.equal(response.status, 404);
  assert.deepEqual(participants, [], "a refused write leaves no row behind");
});

test("opening a teamless agent's thread is refused without leaving a row behind", async () => {
  agentTeams = new Map();
  createdSessions = [];
  participants = [];
  sessionUserId = 7;
  try {
    const response = await createSessionRoute.POST(
      new Request("https://app.hypertask.ai/api/ai-chat/create-session", {
        method: "POST",
        body: JSON.stringify({ agentId: OPENABLE_AGENT }),
      }),
    );
    assert.equal(response.status, 404);
    assert.deepEqual(
      createdSessions,
      [],
      "creating the conversation and then refusing the caller leaves an orphan row",
    );
    assert.deepEqual(participants, [], "a refused open leaves no row behind");
  } finally {
    sessionUserId = 6;
    agentTeams = new Map([[OPENABLE_AGENT, "team-a"]]);
  }
});

test("its owner still gets the thread when the agent has no team", async () => {
  agentTeams = new Map();
  createdSessions = [];
  participants = [];
  try {
    const response = await createSessionRoute.POST(
      new Request("https://app.hypertask.ai/api/ai-chat/create-session", {
        method: "POST",
        body: JSON.stringify({ agentId: OPENABLE_AGENT }),
      }),
    );
    assert.equal(response.status, 200);
    assert.equal(createdSessions[0].userId, 6, "keyed on the agent's owner");
    assert.deepEqual(
      participants.map((row) => row.userId),
      [6],
      "opening the thread records the person who opened it",
    );
  } finally {
    agentTeams = new Map([[OPENABLE_AGENT, "team-a"]]);
  }
});

test("seeing an agent across a board is not enough to open its team's thread", async () => {
  // 8 can see the agent (it is shared with them) but belongs to no team, which
  // is the shape a board member who was never added to the team leaves behind.
  agentTeams = new Map([[OPENABLE_AGENT, "team-a"]]);
  AGENTS[OPENABLE_AGENT].sharedWith.push(8);
  createdSessions = [];
  participants = [];
  sessionUserId = 8;
  try {
    const response = await createSessionRoute.POST(
      new Request("https://app.hypertask.ai/api/ai-chat/create-session", {
        method: "POST",
        body: JSON.stringify({ agentId: OPENABLE_AGENT }),
      }),
    );
    assert.equal(response.status, 404);
    assert.deepEqual(
      createdSessions,
      [],
      "the refusal has to come before the write, not after it",
    );
    assert.deepEqual(participants, [], "a refused open leaves no row behind");
  } finally {
    sessionUserId = 6;
    AGENTS[OPENABLE_AGENT].sharedWith = AGENTS[OPENABLE_AGENT].sharedWith.filter(
      (id) => id !== 8,
    );
  }
});

test("the shared thread is keyed on the agent's owner, not on whoever opens it", () => {
  const source = fs.readFileSync(
    path.join(root, "src/app/api/ai-chat/create-session/route.ts"),
    "utf8",
  );
  assert.match(
    source,
    /userId_agentId:\s*\{\s*userId:\s*agent\.userId/,
    "keying on the caller gives each person a private copy of the conversation",
  );
});

test("the agent is told who actually sent the message", () => {
  const source = fs.readFileSync(
    path.join(root, "src/app/api/agent-chat/[sessionId]/messages/route.ts"),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /session\.user\.displayName/,
    "the session's owner is not the sender in a shared thread",
  );
  assert.match(source, /displayName: senderName/);
});

// Every write to a shared thread has to wake every tab on it. The one that
// matters most is the agent's reply, which arrives through the MCP route and
// used to reach only the person whose name is on the session row.
const CHAT_BROADCASTERS = [
  "src/app/api/agent-chat/[sessionId]/messages/route.ts",
  "src/app/api/mcp/chat/sessions/[sessionId]/messages/route.ts",
  "src/lib/agentRuns/service.ts",
];

for (const relativePath of CHAT_BROADCASTERS) {
  test(`a live update from ${relativePath} reaches everyone in the thread`, () => {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    assert.match(
      source,
      /broadcastChatSession\(/,
      "a teammate watching the same conversation has to see this arrive",
    );
    assert.doesNotMatch(
      source,
      /userChannel\((?:session|run\.chatSession)\.userId\)/,
      "the session's owner is not the only person watching the thread",
    );
  });
}

test("the fan-out list is resolved before the response, not after it", () => {
  const source = fs.readFileSync(
    path.join(root, "src/lib/agents/chatBroadcast.ts"),
    "utf8",
  );
  // A serverless runtime can freeze once the response is flushed, so the
  // participant lookup has to be awaited rather than started and abandoned.
  assert.match(source, /await chatParticipantUserIds\(sessionId\)/);
});

// ---------------------------------------------------------------------------
// Attribution: every stored message says who wrote it, or says nothing on
// purpose. A new write path that forgets this fails here.
// ---------------------------------------------------------------------------
const MESSAGE_WRITERS = [
  ["src/app/api/agent-chat/[sessionId]/messages/route.ts", "authorUserId: userId"],
  [
    "src/app/api/mcp/chat/sessions/[sessionId]/messages/route.ts",
    "authorAgentId: tokenAgentId",
  ],
  ["src/lib/agentRuns/service.ts", "authorAgentId: run.agentId"],
  ["src/lib/agentRuns/service.ts", "authorUserId: principal.userId"],
  ["src/app/api/ai/chat/stream/ensureNativeChatTurn.ts", "authorUserId: userId"],
  [
    "src/app/api/ai/chat/stream/persistAssistantMessage.ts",
    "authorAgentId: session.agentId",
  ],
  [
    "src/app/api/ai-chat/add-message/route.ts",
    'authorUserId: messageData.role === "human" ? user.id : null',
  ],
  [
    "src/app/api/ai-chat/add-message/route.ts",
    'messageData.role === "assistant" ? session.agentId : null',
  ],
];

for (const [file, expected] of MESSAGE_WRITERS) {
  test(`${file} records ${expected.split(":")[0]}`, () => {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.ok(
      source.includes(expected),
      `${file} stores chat messages without saying who wrote them`,
    );
  });
}

test("the scheduled heartbeat prompt stays unattributed on purpose", () => {
  const source = fs.readFileSync(
    path.join(root, "src/app/api/cron/native-agent-heartbeat/route.ts"),
    "utf8",
  );
  const start = source.indexOf("transaction.chatMessage.create(");
  assert.notEqual(start, -1, "the heartbeat must still store its prompt");
  const createCall = source.slice(start, source.indexOf("});", start));
  assert.doesNotMatch(
    createCall,
    /author(UserId|AgentId)\s*:/,
    "a machine-written prompt must not be signed with a person's or agent's name",
  );
});

// ---------------------------------------------------------------------------
// Schema and migration
// ---------------------------------------------------------------------------
const schema = fs.readFileSync(path.join(root, "src/prisma/schema.prisma"), "utf8");
function migration(name) {
  return fs.readFileSync(
    path.join(root, `src/prisma/migrations/${name}/migration.sql`),
    "utf8",
  );
}

/** Statement keywords only: comments and clauses like ON UPDATE do not count. */
function statements(sql) {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

const authorMigration = migration("20260905140000_chat_message_author");
const backfillMigration = migration("20260905140010_chat_message_author_backfill");
const validateMigration = migration("20260905140015_chat_message_author_validate");
const indexMigration = migration("20260905140020_chat_message_history_index");
test("the migration adds attribution without touching stored history", () => {
  assert.match(authorMigration, /ADD COLUMN "authorUserId" INTEGER;/);
  assert.match(authorMigration, /ADD COLUMN "authorAgentId" TEXT;/);
  assert.doesNotMatch(
    authorMigration,
    /\b(DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM)\b/i,
    "a data-foundation migration must not remove anything",
  );
  assert.doesNotMatch(
    authorMigration,
    /SET NOT NULL/i,
    "a NOT NULL column would rewrite the table and reject existing rows",
  );
});

test("the column, the backfill and the indexes hold separate locks", () => {
  // ADD COLUMN holds ACCESS EXCLUSIVE to the end of its transaction, so a
  // bundled backfill and index build would block every chat read for the
  // whole deploy.
  assert.doesNotMatch(
    statements(authorMigration),
    /^\s*(UPDATE|CREATE INDEX)\b/im,
  );
  assert.doesNotMatch(
    statements(backfillMigration),
    /^\s*(ALTER TABLE|CREATE INDEX)\b/im,
  );
  assert.doesNotMatch(statements(indexMigration), /^\s*(ALTER TABLE|UPDATE)\b/im);
  assert.doesNotMatch(
    statements(indexMigration),
    /^\s*DROP INDEX(?! CONCURRENTLY)/im,
    "a blocking drop does not belong in the concurrent build migration",
  );
});

test("constraints are added unvalidated and validated on their own", () => {
  // A validated foreign key scans ChatMessage and locks User and Agent against
  // writes; NOT VALID plus a later VALIDATE keeps both tables usable.
  for (const constraint of [
    "ChatMessage_author_check",
    "ChatMessage_authorUserId_fkey",
    "ChatMessage_authorAgentId_fkey",
  ]) {
    assert.match(
      authorMigration,
      new RegExp(`"${constraint}"[\\s\\S]{0,240}NOT VALID;`),
      `${constraint} must be added unvalidated`,
    );
    assert.match(
      validateMigration,
      new RegExp(`VALIDATE CONSTRAINT "${constraint}"`),
      `${constraint} must still be validated`,
    );
  }
});

test("existing messages keep their history and gain their author", () => {
  assert.match(
    backfillMigration,
    /"authorUserId" = CASE WHEN message\."role" = 'human' THEN session\."userId" END/,
    "a human message belongs to the person who owns the thread",
  );
  assert.match(
    backfillMigration,
    /"authorAgentId" = CASE WHEN message\."role" = 'assistant' THEN session\."agentId" END/,
    "a reply in an agent thread belongs to that agent",
  );
  assert.match(
    backfillMigration,
    /role" = 'assistant'[\s\S]{0,120}isDelivered" = true[\s\S]{0,120}agentId" IS NOT NULL/,
    "an undelivered assistant row is a system notice about the turn, not the agent's answer",
  );
  assert.equal(
    (statements(backfillMigration).match(/^\s*UPDATE\b/gim) || []).length,
    1,
    "the human and assistant row sets are disjoint, so a second pass would rewrite the table for nothing",
  );
});

test("the backfill leaves scheduled heartbeat prompts unattributed", () => {
  assert.match(
    backfillMigration,
    /NOT LIKE '%<!--ht-heartbeat:v1:%'/,
    "a heartbeat prompt turns delivered when its turn starts, so delivered alone would sign the scheduler's words with the owner's name",
  );
});

test("a message can never claim two authors", () => {
  assert.match(
    authorMigration,
    /CHECK \(NOT \("authorUserId" IS NOT NULL AND "authorAgentId" IS NOT NULL\)\)/,
  );
});

test("deleting a person or an agent keeps the transcript", () => {
  for (const column of ["authorUserId", "authorAgentId"]) {
    assert.match(
      authorMigration,
      new RegExp(`"ChatMessage_${column}_fkey"[\\s\\S]{0,160}ON DELETE SET NULL`),
      `${column} must drop the attribution, not the message`,
    );
  }
  assert.match(
    schema,
    /session ChatSession @relation\(fields: \[sessionId\], references: \[id\], onDelete: Cascade\)/,
    "clearing a conversation still removes its messages",
  );
});

function modelBlock(name) {
  const start = schema.indexOf(`model ${name} {`);
  assert.notEqual(start, -1, `schema no longer declares model ${name}`);
  const end = schema.indexOf("\n}", start);
  assert.notEqual(end, -1, `model ${name} is not closed`);
  return schema.slice(start, end);
}

test("the turn event log stays append-only, ordered and duplicate-proof", () => {
  const activityBlock = modelBlock("AgentRunActivity");
  assert.match(
    activityBlock,
    /@@unique\(\[runId, idempotencyKey\]\)/,
    "a replayed event must collide instead of appending twice",
  );
  assert.match(
    activityBlock,
    /@@index\(\[runId, createdAt, id\]\)/,
    "events need a total order inside their turn",
  );
});

test("history has an index that matches how it is read", () => {
  assert.match(modelBlock("ChatMessage"), /@@index\(\[sessionId, createdAt, id\]\)/);
  for (const index of [
    "ChatMessage_sessionId_createdAt_id_idx",
    "ChatMessage_authorUserId_idx",
    "ChatMessage_authorAgentId_idx",
  ]) {
    assert.match(
      indexMigration,
      new RegExp(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS "${index}"`,
      ),
      "a plain build holds a SHARE lock and blocks chat inserts for its duration; IF NOT EXISTS keeps a hand-applied index a no-op here",
    );
  }
  assert.doesNotMatch(
    statements(indexMigration),
    /^\s*(?!CREATE INDEX CONCURRENTLY)\S.*;/m,
    "only concurrent builds belong here; anything else shares their file and their fate",
  );
  assert.match(
    modelBlock("ChatMessage"),
    /@@index\(\[sessionId\]\)/,
    "the pre-existing prefix index stays: removing it is not this change's mess to clean",
  );
});

const participantMigration = migration("20260907120000_chat_session_participant");

test("the participant table carries exactly one row per person per thread", () => {
  const block = modelBlock("ChatSessionParticipant");
  assert.match(block, /@@unique\(\[sessionId, userId\]\)/);
  assert.match(block, /lastReadAt\s+DateTime\?/);
  assert.match(block, /draft\s+String\?/);
  assert.match(
    participantMigration,
    /CREATE UNIQUE INDEX "ChatSessionParticipant_sessionId_userId_key"/,
  );
});

test("the migration only records a team the agent's boards agree on", () => {
  assert.match(
    participantMigration,
    /HAVING COUNT\(DISTINCT p\."teamId"\) = 1/,
    "guessing a scope for an agent whose boards span two teams widens who can read the thread",
  );
  assert.match(participantMigration, /WHERE s\."agentId" = agent_team\."agentId" AND s\."teamId" IS NULL/);
});

test("the migration seeds participants without inventing unread messages", () => {
  assert.match(
    participantMigration,
    /INSERT INTO "ChatSessionParticipant"[\s\S]*SELECT s\."userId" AS "userId"[\s\S]*SELECT m\."authorUserId"/,
    "an existing thread's participants are the person who opened it plus everyone who wrote in it",
  );
  assert.match(
    participantMigration,
    /"lastReadAt", "updatedAt"\)\s*\nSELECT [^\n]*NOW\(\), NOW\(\), NOW\(\)/,
    "seeding a null read marker would badge every existing thread as unread on deploy",
  );
  assert.match(participantMigration, /ON CONFLICT \("sessionId", "userId"\) DO NOTHING/);
});

test("the transcript itself is not touched by this migration", () => {
  assert.doesNotMatch(
    statements(participantMigration),
    /UPDATE "ChatMessage"|DELETE FROM "Chat(Message|Session)"|DROP INDEX/,
    "sharing a conversation must not move or drop a single stored message",
  );
});
