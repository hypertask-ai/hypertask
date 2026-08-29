const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(root, "tests/project-delegate-access-jiti-entry.cjs"),
  {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  },
);
const {
  getProjectWhere,
  getProjectListingWhere,
  projectContentAccessWhere,
  taskWriteAccessWhere,
} = jiti(
  path.join(root, "src/utils/controllers/projects/getAllIncludes.ts"),
);

const USER_ID = 6;
const AGENT_ID = "agent-owned";

function agentMatches(agent, where) {
  if (!agent) return false;
  if (where.id !== undefined && agent.id !== where.id) return false;
  if (where.userId !== undefined && agent.userId !== where.userId) return false;
  if (where.revokedAt !== undefined && agent.revokedAt !== where.revokedAt) {
    return false;
  }
  return true;
}

function userMatches(user, where) {
  if (!user) return false;
  if (where.id !== undefined && user.id !== where.id) return false;
  if (
    where.agents?.some &&
    !user.agents.some((agent) => agentMatches(agent, where.agents.some))
  ) {
    return false;
  }
  return true;
}

function memberMatches(member, where) {
  if (where.userId !== undefined && member.userId !== where.userId) return false;
  if (where.agentId !== undefined && member.agentId !== where.agentId) return false;

  if (where.agent) {
    if (!member.agent) return false;
    if (
      where.agent.userId !== undefined &&
      member.agent.userId !== where.agent.userId
    ) {
      return false;
    }
    if (
      where.agent.revokedAt !== undefined &&
      member.agent.revokedAt !== where.agent.revokedAt
    ) {
      return false;
    }
  }
  if (where.user && !userMatches(member.user, where.user)) return false;

  return true;
}

function projectMatches(project, where) {
  if (where.teamId?.not === null && project.teamId === null) return false;
  if (where.ownerId !== undefined && project.ownerId !== where.ownerId) {
    return false;
  }
  if (where.owner && !userMatches(project.owner, where.owner)) return false;
  if (
    where.members?.some &&
    !project.members.some((member) => memberMatches(member, where.members.some))
  ) {
    return false;
  }
  if (
    where.OR &&
    !where.OR.some((branch) => projectMatches(project, branch))
  ) {
    return false;
  }
  return true;
}

function project(overrides = {}) {
  return {
    ownerId: 99,
    owner: { id: 99, agents: [] },
    teamId: "team-1",
    members: [],
    ...overrides,
  };
}

test("an agent keeps the connecting human's owned boards in scope", () => {
  const ownedBoard = project({
    ownerId: USER_ID,
    owner: {
      id: USER_ID,
      agents: [{ id: AGENT_ID, userId: USER_ID, revokedAt: null }],
    },
  });

  assert.equal(
    projectMatches(ownedBoard, getProjectWhere(USER_ID, AGENT_ID)),
    true,
  );
});

test("an agent's own active board membership adds scope", () => {
  const agentBoard = project({
    members: [
      {
        userId: USER_ID,
        agentId: AGENT_ID,
        agent: { userId: USER_ID, revokedAt: null },
      },
    ],
  });

  assert.equal(
    projectMatches(agentBoard, getProjectWhere(USER_ID, AGENT_ID)),
    true,
  );
});

test("agent board discovery excludes the connecting human's unassigned boards", () => {
  const ownedBoard = project({
    ownerId: USER_ID,
    owner: {
      id: USER_ID,
      agents: [{ id: AGENT_ID, userId: USER_ID, revokedAt: null }],
    },
  });
  const assignedBoard = project({
    members: [
      {
        userId: USER_ID,
        agentId: AGENT_ID,
        agent: { userId: USER_ID, revokedAt: null },
      },
    ],
  });

  assert.equal(
    projectMatches(ownedBoard, getProjectListingWhere(USER_ID, AGENT_ID)),
    false,
  );
  assert.equal(
    projectMatches(assignedBoard, getProjectListingWhere(USER_ID, AGENT_ID)),
    true,
  );
});

test("human board discovery remains byte-for-byte unchanged", () => {
  assert.deepEqual(getProjectListingWhere(USER_ID), getProjectWhere(USER_ID));
  assert.deepEqual(getProjectListingWhere(USER_ID, null), getProjectWhere(USER_ID));
});

test("every MCP board-discovery payload uses the narrow listing scope", () => {
  const discoverySources = [
    "src/app/api/mcp/projects/route.ts",
    "src/app/api/mcp/user/context/route.ts",
    "src/lib/mcp/hello/getHelloPayload.ts",
  ];

  for (const relativePath of discoverySources) {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    assert.match(
      source,
      /getProjectListingWhere\([^)]*ctx\.agentId\)/,
      `${relativePath} must not enumerate the connecting human's full board scope`,
    );
  }
});

test("agent board discovery requires an owned, active agent membership", () => {
  const revokedBoard = project({
    members: [
      {
        userId: USER_ID,
        agentId: AGENT_ID,
        agent: {
          userId: USER_ID,
          revokedAt: new Date("2026-08-01"),
        },
      },
    ],
  });
  const foreignBoard = project({
    members: [
      {
        userId: 7,
        agentId: AGENT_ID,
        agent: { userId: 7, revokedAt: null },
      },
    ],
  });

  assert.equal(
    projectMatches(revokedBoard, getProjectListingWhere(USER_ID, AGENT_ID)),
    false,
  );
  assert.equal(
    projectMatches(foreignBoard, getProjectListingWhere(USER_ID, AGENT_ID)),
    false,
  );
});

test("an agent id owned by another user grants no board access", () => {
  const foreignAgentBoard = project({
    members: [
      {
        userId: 7,
        agentId: AGENT_ID,
        agent: { userId: 7, revokedAt: null },
      },
    ],
  });

  assert.equal(
    projectMatches(foreignAgentBoard, getProjectWhere(USER_ID, AGENT_ID)),
    false,
  );
});

test("a revoked agent grants no board access", () => {
  const revokedAgentBoard = project({
    members: [
      {
        userId: USER_ID,
        agentId: AGENT_ID,
        agent: { userId: USER_ID, revokedAt: new Date("2026-08-01") },
      },
    ],
  });

  assert.equal(
    projectMatches(revokedAgentBoard, getProjectWhere(USER_ID, AGENT_ID)),
    false,
  );
});

test("omitting agentId leaves getProjectWhere byte-for-byte unchanged", () => {
  const expected = {
    teamId: { not: null },
    OR: [
      { ownerId: USER_ID },
      { members: { some: { userId: USER_ID, agentId: null } } },
    ],
  };

  assert.deepEqual(getProjectWhere(USER_ID), expected);
  assert.deepEqual(getProjectWhere(USER_ID, null), expected);
});

test("task writes allow owners, human members, and owned active agents", () => {
  const cases = [
    ["owner", project({ ownerId: USER_ID }), null],
    [
      "human member",
      project({ members: [{ userId: USER_ID, agentId: null }] }),
      null,
    ],
    [
      "owned active agent",
      project({
        members: [
          {
            userId: USER_ID,
            agentId: AGENT_ID,
            agent: { userId: USER_ID, revokedAt: null },
          },
        ],
      }),
      AGENT_ID,
    ],
  ];

  for (const [identity, board, agentId] of cases) {
    assert.equal(
      projectMatches(board, taskWriteAccessWhere(USER_ID, agentId)),
      true,
      `${identity} should have task-write access`,
    );
  }
});

test("task content keeps the connecting human's board scope for an active agent", () => {
  const activeAgent = {
    id: AGENT_ID,
    userId: USER_ID,
    revokedAt: null,
  };
  const ownedBoard = project({
    ownerId: USER_ID,
    owner: { id: USER_ID, agents: [activeAgent] },
  });
  const humanMemberBoard = project({
    members: [
      {
        userId: USER_ID,
        agentId: null,
        user: { id: USER_ID, agents: [activeAgent] },
      },
    ],
  });

  assert.equal(
    projectMatches(ownedBoard, projectContentAccessWhere(USER_ID, AGENT_ID)),
    true,
  );
  assert.equal(
    projectMatches(
      humanMemberBoard,
      projectContentAccessWhere(USER_ID, AGENT_ID),
    ),
    true,
  );
});

test("a revoked or foreign agent cannot borrow the human's board scope", () => {
  const revokedOwnedBoard = project({
    ownerId: USER_ID,
    owner: {
      id: USER_ID,
      agents: [
        {
          id: AGENT_ID,
          userId: USER_ID,
          revokedAt: new Date("2026-08-01"),
        },
      ],
    },
  });
  const foreignOwnedBoard = project({
    ownerId: USER_ID,
    owner: {
      id: USER_ID,
      agents: [{ id: AGENT_ID, userId: 7, revokedAt: null }],
    },
  });

  for (const accessWhere of [
    getProjectWhere,
    projectContentAccessWhere,
    taskWriteAccessWhere,
  ]) {
    assert.equal(
      projectMatches(revokedOwnedBoard, accessWhere(USER_ID, AGENT_ID)),
      false,
    );
    assert.equal(
      projectMatches(foreignOwnedBoard, accessWhere(USER_ID, AGENT_ID)),
      false,
    );
  }
});

test("task content accepts only an owned, active agent's additional scope", () => {
  const activeAgentBoard = project({
    members: [
      {
        userId: USER_ID,
        agentId: AGENT_ID,
        agent: { userId: USER_ID, revokedAt: null },
      },
    ],
  });
  const foreignAgentBoard = project({
    members: [
      {
        userId: 7,
        agentId: AGENT_ID,
        agent: { userId: 7, revokedAt: null },
      },
    ],
  });

  assert.equal(
    projectMatches(
      activeAgentBoard,
      projectContentAccessWhere(USER_ID, AGENT_ID),
    ),
    true,
  );
  assert.equal(
    projectMatches(
      foreignAgentBoard,
      projectContentAccessWhere(USER_ID, AGENT_ID),
    ),
    false,
  );
});

test("teamless boards remain outside getProjectWhere scope", () => {
  const teamlessOwnedBoard = project({
    ownerId: USER_ID,
    owner: {
      id: USER_ID,
      agents: [{ id: AGENT_ID, userId: USER_ID, revokedAt: null }],
    },
    teamId: null,
  });

  assert.equal(
    projectMatches(teamlessOwnedBoard, getProjectWhere(USER_ID, AGENT_ID)),
    false,
  );
});
