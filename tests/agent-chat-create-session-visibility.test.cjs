// HTPR-6039 acceptance criterion: "a teammate who guesses a private agent's id
// still cannot read its chat or send it a message". Reading and writing an
// existing thread is already covered behaviourally by the shared rule in
// agent-chat-durable-conversation.test.cjs. The remaining door is this route:
// it is where a first message to a guessed agent id would open a thread, and
// until now it was only checked by matching its source text, which passes even
// if the guard sits in the wrong place.
//
// The real accessibleAgentWhere is used here, not a stub, and the fake database
// throws on any filter key it does not understand, so widening the rule fails
// this test instead of quietly widening access.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");

function stub(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

const OWNER = 6;
const TEAMMATE = 7;
const OUTSIDER = 99;
// On the board, but not in the board's team.
const BOARD_ONLY = 8;
const TEAM = "team-1";

// One board, owned by the agent owner, with the teammate as a member. The board
// belongs to a team because the route asks which team an agent's board is in
// (getAgentTeamIds) and refuses to open a thread otherwise.
const SHARED_BOARD = {
  id: 15,
  status: "Normal",
  ownerId: OWNER,
  teamId: TEAM,
  memberships: [
    { userId: TEAMMATE, agentId: null },
    { userId: BOARD_ONLY, agentId: null },
  ],
};

// Being on a board and being in its team are two different things, and the
// route needs both. The outsider is in neither.
const TEAM_MEMBERSHIPS = [
  { userId: OWNER, teamId: TEAM },
  { userId: TEAMMATE, teamId: TEAM },
];

const PRIVATE_ID = "11111111-1111-4111-8111-111111111111";
const TEAM_ID = "22222222-2222-4222-8222-222222222222";
const REVOKED_TEAM_ID = "33333333-3333-4333-8333-333333333333";

const AGENTS = [
  {
    id: PRIVATE_ID,
    displayName: "Private helper",
    userId: OWNER,
    visibility: "PRIVATE",
    revokedAt: null,
    projects: [SHARED_BOARD],
  },
  {
    id: TEAM_ID,
    displayName: "Shared helper",
    userId: OWNER,
    visibility: "TEAM",
    revokedAt: null,
    projects: [SHARED_BOARD],
  },
  {
    id: REVOKED_TEAM_ID,
    displayName: "Retired helper",
    userId: OWNER,
    visibility: "TEAM",
    revokedAt: new Date("2026-09-01"),
    projects: [SHARED_BOARD],
  },
];

// The `Member` rows that put each agent on the shared board, which is how the
// route works out an agent's team.
const AGENT_BOARD_MEMBERS = AGENTS.map((agent, index) => ({
  id: index + 1,
  agentId: agent.id,
  project: { teamId: SHARED_BOARD.teamId },
}));

// Every filter this fake understands is spelled out, and anything else throws:
// an unknown key name, an unknown key inside a relation filter, and an operator
// object such as `{ not: null }` on a key it only knows how to compare. Reading
// `where.members.some.userId` by name, or comparing an operator object with
// `===`, would let a widened rule pass unnoticed.
function scalar(actual, value, key) {
  if (value !== null && typeof value === "object") {
    throw new Error(`unhandled operator filter on ${key}`);
  }
  return actual === value;
}

function someWhere(value, kind) {
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "some") {
    throw new Error(`unhandled ${kind} relation filter: ${keys.join(", ")}`);
  }
  return value.some;
}

function matchProjectMembership(membership, where) {
  return Object.entries(where).every(([key, value]) => {
    switch (key) {
      case "userId":
        return scalar(membership.userId, value, key);
      case "agentId":
        return scalar(membership.agentId, value, key);
      default:
        throw new Error(`unhandled project member filter: ${key}`);
    }
  });
}

function matchProject(project, where) {
  return Object.entries(where).every(([key, value]) => {
    switch (key) {
      case "id":
        return scalar(project.id, value, key);
      case "status":
        return scalar(project.status, value, key);
      case "ownerId":
        return scalar(project.ownerId, value, key);
      case "OR":
        return value.some((branch) => matchProject(project, branch));
      case "members":
        return project.memberships.some((membership) =>
          matchProjectMembership(membership, someWhere(value, "project member")),
        );
      default:
        throw new Error(`unhandled project filter: ${key}`);
    }
  });
}

function matchAgentMembership(project, where) {
  return Object.entries(where).every(([key, value]) => {
    switch (key) {
      case "project":
        return matchProject(project, value);
      default:
        throw new Error(`unhandled agent member filter: ${key}`);
    }
  });
}

function matchAgent(agent, where) {
  return Object.entries(where).every(([key, value]) => {
    switch (key) {
      case "id":
        return scalar(agent.id, value, key);
      case "userId":
        return scalar(agent.userId, value, key);
      case "visibility":
        return scalar(agent.visibility, value, key);
      case "revokedAt":
        return scalar(agent.revokedAt, value, key);
      case "OR":
        return value.some((branch) => matchAgent(agent, branch));
      case "members":
        return agent.projects.some((project) =>
          matchAgentMembership(project, someWhere(value, "agent member")),
        );
      default:
        throw new Error(`unhandled agent filter: ${key}`);
    }
  });
}

// The route re-reads the thread it just opened through the shared rule in
// chatAccess, so the fake has to store sessions rather than pretend one exists.
// Same discipline as the agent filters above: only the keys the rule really uses
// are understood, and anything else throws instead of silently matching.
function inFilter(value, kind) {
  const keys = Object.keys(value);
  if (keys.length !== 1 || keys[0] !== "in" || !Array.isArray(value.in)) {
    throw new Error(`unhandled ${kind} filter: ${keys.join(", ")}`);
  }
  return value.in;
}

function matchSession(session, where) {
  return Object.entries(where).every(([key, value]) => {
    switch (key) {
      case "id":
        return scalar(session.id, value, key);
      case "userId":
        return scalar(session.userId, value, key);
      case "teamId":
        return value !== null && typeof value === "object"
          ? inFilter(value, "session team").includes(session.teamId)
          : scalar(session.teamId, value, key);
      case "agentId": {
        if (value === null || typeof value !== "object") {
          return scalar(session.agentId, value, key);
        }
        const keys = Object.keys(value);
        if (keys.length !== 1 || keys[0] !== "not" || value.not !== null) {
          throw new Error(`unhandled session agentId filter: ${keys.join(", ")}`);
        }
        return session.agentId !== null;
      }
      case "OR":
        return value.some((branch) => matchSession(session, branch));
      case "agent": {
        // The same agent rule, applied to the thread's agent: a thread whose
        // agent this caller may no longer see must not come back.
        const agent = AGENTS.find((row) => row.id === session.agentId);
        return agent != null && matchAgent(agent, value);
      }
      default:
        throw new Error(`unhandled chat session filter: ${key}`);
    }
  });
}

let upserts = [];
let sessions = [];
let participants = [];

const prisma = {
  agent: {
    findFirst: async ({ where }) =>
      AGENTS.find((agent) => matchAgent(agent, where)) ?? null,
  },
  member: {
    findMany: async ({ where }) => {
      const keys = Object.keys(where);
      if (keys.length !== 1 || keys[0] !== "agentId") {
        throw new Error(`unhandled member filter: ${keys.join(", ")}`);
      }
      const ids = inFilter(where.agentId, "member agent");
      return AGENT_BOARD_MEMBERS.filter((row) => ids.includes(row.agentId));
    },
  },
  member_Team: {
    findMany: async ({ where }) => {
      const keys = Object.keys(where);
      if (keys.length !== 1 || keys[0] !== "userId") {
        throw new Error(`unhandled team member filter: ${keys.join(", ")}`);
      }
      return TEAM_MEMBERSHIPS.filter((row) =>
        scalar(row.userId, where.userId, "userId"),
      );
    },
  },
  chatSession: {
    upsert: async ({ where, create }) => {
      upserts.push(where.userId_agentId);
      const { userId, agentId } = where.userId_agentId;
      const existing = sessions.find(
        (row) => row.userId === userId && row.agentId === agentId,
      );
      if (existing) return existing;
      const session = { id: `session-${sessions.length + 1}`, ...create };
      sessions.push(session);
      return session;
    },
    findFirst: async ({ where }) =>
      sessions.find((session) => matchSession(session, where)) ?? null,
    create: async () => {
      throw new Error("an agent request must not fall through to a plain session");
    },
  },
  chatSessionParticipant: {
    upsert: async ({ where }) => {
      participants.push(where.sessionId_userId);
      return { draft: null, lastReadAt: new Date(), joinedAt: new Date() };
    },
    findMany: async () => [],
  },
};

let sessionUserId = OWNER;

stub("src/lib/prisma.ts", { default: prisma });
stub("src/lib/auth/getSessionUser.ts", {
  getSessionUser: async () => ({ userId: sessionUserId }),
});

const route = createJiti(path.join(root, "tests/agent-chat-create-session-visibility-load.cjs"), {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
})(path.join(root, "src/app/api/ai-chat/create-session/route.ts"));

async function openChat(userId, agentId) {
  sessionUserId = userId;
  upserts = [];
  sessions = [];
  participants = [];
  const response = await route.POST(
    new Request("https://app.hypertask.ai/api/ai-chat/create-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId }),
    }),
  );
  return { status: response.status, body: await response.json() };
}

test("the owner can open their own private agent's chat", async () => {
  const result = await openChat(OWNER, PRIVATE_ID);
  assert.equal(result.status, 200);
  assert.deepEqual(upserts, [{ userId: OWNER, agentId: PRIVATE_ID }]);
  assert.deepEqual(participants, [
    { sessionId: "session-1", userId: OWNER },
  ]);
});

test("a teammate who guesses a private agent's id cannot open its chat", async () => {
  const result = await openChat(TEAMMATE, PRIVATE_ID);
  assert.equal(result.status, 404);
  assert.equal(result.body.error, "Agent not found");
  assert.deepEqual(upserts, [], "a denied request must not create a thread");
});

test("a teammate on the same board can open a team agent's chat", async () => {
  // Without this the denial above could pass for the wrong reason.
  const result = await openChat(TEAMMATE, TEAM_ID);
  assert.equal(result.status, 200);
  // Keyed on the agent's owner, not on whoever opened it: everyone the agent is
  // shared with lands in one thread rather than a private copy each.
  assert.deepEqual(upserts, [{ userId: OWNER, agentId: TEAM_ID }]);
  assert.deepEqual(participants, [
    { sessionId: "session-1", userId: TEAMMATE },
  ]);
});

test("a board member outside the agent's team cannot open its chat", async () => {
  // Seeing the agent on a shared board is not the same as being in its team.
  // Refused before anything is written: without this the route would open a
  // thread and then refuse the caller who asked for it.
  const result = await openChat(BOARD_ONLY, TEAM_ID);
  assert.equal(result.status, 404);
  assert.deepEqual(upserts, [], "a denied request must not create a thread");
});

test("someone outside the board cannot open a team agent's chat", async () => {
  const result = await openChat(OUTSIDER, TEAM_ID);
  assert.equal(result.status, 404);
  assert.deepEqual(upserts, []);
});

test("a revoked agent's chat cannot be opened, even by its owner", async () => {
  const result = await openChat(OWNER, REVOKED_TEAM_ID);
  assert.equal(result.status, 404);
  assert.deepEqual(upserts, []);
});
