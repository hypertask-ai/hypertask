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

// One board, owned by the agent owner, with the teammate as a member.
const SHARED_BOARD = {
  id: 15,
  status: "Normal",
  ownerId: OWNER,
  memberships: [{ userId: TEAMMATE, agentId: null }],
};

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

let upserts = [];

const prisma = {
  agent: {
    findFirst: async ({ where }) =>
      AGENTS.find((agent) => matchAgent(agent, where)) ?? null,
  },
  chatSession: {
    upsert: async ({ where }) => {
      upserts.push(where.userId_agentId);
      return { id: "session-created" };
    },
    create: async () => {
      throw new Error("an agent request must not fall through to a plain session");
    },
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
  assert.deepEqual(upserts, [{ userId: TEAMMATE, agentId: TEAM_ID }]);
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
