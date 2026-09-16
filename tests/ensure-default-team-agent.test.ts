import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";

import {
  DEFAULT_SEEDED_AGENT_NAME,
  ensureDefaultAgentsOnAccessibleTeams,
  ensureDefaultTeamAgent,
} from "../src/utils/controllers/agents/ensureDefaultTeamAgent";

const OWNER = 985;
const MEMBER = 986;
const TEAM = "team-hypertask";
const BOARD_ID = 15;

type FakeMember = {
  projectId: number;
  userId: number;
  agentId: string | null;
  status: "Accepted" | "Invited";
};

type FakeState = {
  agents: Array<{
    id: string;
    userId: number;
    revokedAt: Date | null;
    archivedAt: Date | null;
    teamId: string;
  }>;
  boards: Array<{
    id: number;
    teamId: string | null;
    ownerId: number;
    members: FakeMember[];
  }>;
  members: Array<{ projectId: number; userId: number; agentId: string }>;
  creates: number;
  locks: string[];
  onLock?: () => void;
};

type Where = Record<string, unknown>;

function asRecord(value: unknown): Where | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Where)
    : null;
}

function collectOrBranches(where: Where): Where[] {
  const branches: Where[] = [];
  const direct = where.OR;
  if (Array.isArray(direct)) {
    for (const branch of direct) {
      const record = asRecord(branch);
      if (record) branches.push(record);
    }
  }
  const and = where.AND;
  if (Array.isArray(and)) {
    for (const part of and) {
      const record = asRecord(part);
      if (record) branches.push(...collectOrBranches(record));
    }
  } else {
    const record = asRecord(and);
    if (record) branches.push(...collectOrBranches(record));
  }
  return branches;
}

function requestedTeamId(where: Where): string | null {
  return typeof where.teamId === "string" ? where.teamId : null;
}

function accessUserId(where: Where): number | null {
  for (const branch of collectOrBranches(where)) {
    if (typeof branch.ownerId === "number") return branch.ownerId;
    const memberFilter = asRecord(asRecord(branch.members)?.some);
    if (typeof memberFilter?.userId === "number") return memberFilter.userId;
  }
  return null;
}

function boardMatchesAccess(
  board: FakeState["boards"][number],
  where: Where,
  userId: number,
): boolean {
  const teamId = requestedTeamId(where);
  if (teamId && board.teamId !== teamId) return false;
  if (asRecord(where.teamId)?.not === null && !board.teamId) return false;

  return collectOrBranches(where).some((branch) => {
    if (branch.ownerId === userId) return board.ownerId === userId;
    const memberFilter = asRecord(asRecord(branch.members)?.some);
    if (!memberFilter) return false;
    if (memberFilter.userId !== userId || memberFilter.agentId !== null) {
      return false;
    }
    if (memberFilter.status !== "Accepted") return false;
    return board.members.some(
      (member) =>
        member.userId === userId &&
        member.agentId === null &&
        member.status === "Accepted",
    );
  });
}

function fakeDatabase(state: FakeState) {
  const agent = {
    findFirst: async ({ where }: { where: { userId: number } }) => {
      const match = state.agents.find(
        (row) =>
          row.userId === where.userId &&
          row.revokedAt === null &&
          row.archivedAt === null &&
          row.teamId === TEAM,
      );
      return match ? { id: match.id } : null;
    },
    create: async ({
      data,
    }: {
      data: { displayName: string; userId: number; runtimeType: string };
    }) => {
      assert.equal(data.displayName, DEFAULT_SEEDED_AGENT_NAME);
      assert.equal(data.runtimeType, "NATIVE");
      const id = `agent-${state.creates + 1}`;
      state.creates += 1;
      state.agents.push({
        id,
        userId: data.userId,
        revokedAt: null,
        archivedAt: null,
        teamId: TEAM,
      });
      return { id };
    },
  };
  const project = {
    findFirst: async ({ where }: { where: Where }) => {
      const userId = accessUserId(where);
      if (userId == null) return null;
      const board = state.boards.find((row) =>
        boardMatchesAccess(row, where, userId),
      );
      return board ? { id: board.id } : null;
    },
    findMany: async ({ where }: { where: Where }) => {
      const userId = accessUserId(where);
      if (userId == null) return [];
      return state.boards
        .filter((row) => boardMatchesAccess(row, where, userId))
        .map((board) => ({ teamId: board.teamId }));
    },
  };
  const member = {
    create: async ({
      data,
    }: {
      data: { projectId: number; userId: number; agentId: string };
    }) => {
      state.members.push(data);
      return data;
    },
  };
  const queryRaw = async (query: { values?: unknown[] } | unknown) => {
    const values = Array.isArray((query as { values?: unknown[] }).values)
      ? ((query as { values: unknown[] }).values as unknown[])
      : [];
    state.locks.push(String(values[0] ?? "lock"));
    state.onLock?.();
    return [{ lock_result: "t" }];
  };
  const tx = { agent, project, member, $queryRaw: queryRaw };
  const store = {
    agent,
    project,
    member,
    $queryRaw: queryRaw,
    $transaction: async <T>(fn: (client: typeof tx) => Promise<T>) => fn(tx),
  };
  return store;
}

function ownedBoard(): FakeState["boards"][number] {
  return {
    id: BOARD_ID,
    teamId: TEAM,
    ownerId: OWNER,
    members: [],
  };
}

test("seeds a native Hyper AI agent on an empty team board", async () => {
  const state: FakeState = {
    agents: [],
    boards: [ownedBoard()],
    members: [],
    creates: 0,
    locks: [],
  };
  const result = await ensureDefaultTeamAgent(
    OWNER,
    TEAM,
    fakeDatabase(state) as unknown as PrismaClient,
  );
  assert.deepEqual(result, { id: "agent-1", created: true });
  assert.equal(state.creates, 1);
  assert.equal(state.locks.length, 1);
  assert.match(state.locks[0], new RegExp(`htpr-6512:${OWNER}:${TEAM}`));
  assert.deepEqual(state.members, [
    { projectId: BOARD_ID, userId: OWNER, agentId: "agent-1" },
  ]);
});

test("does not create a second agent when one is already live on the team", async () => {
  const state: FakeState = {
    agents: [
      {
        id: "existing",
        userId: OWNER,
        revokedAt: null,
        archivedAt: null,
        teamId: TEAM,
      },
    ],
    boards: [ownedBoard()],
    members: [],
    creates: 0,
    locks: [],
  };
  const result = await ensureDefaultTeamAgent(
    OWNER,
    TEAM,
    fakeDatabase(state) as unknown as PrismaClient,
  );
  assert.deepEqual(result, { id: "existing", created: false });
  assert.equal(state.creates, 0);
  assert.deepEqual(state.locks, []);
});

test("does not seed when the user has no board on that team", async () => {
  const state: FakeState = {
    agents: [],
    boards: [
      {
        id: 99,
        teamId: "other-team",
        ownerId: OWNER,
        members: [],
      },
    ],
    members: [],
    creates: 0,
    locks: [],
  };
  const result = await ensureDefaultTeamAgent(
    OWNER,
    TEAM,
    fakeDatabase(state) as unknown as PrismaClient,
  );
  assert.equal(result, null);
  assert.equal(state.creates, 0);
});

test("does not treat an unaccepted board membership as access", async () => {
  const state: FakeState = {
    agents: [],
    boards: [
      {
        id: BOARD_ID,
        teamId: TEAM,
        ownerId: MEMBER,
        members: [
          {
            projectId: BOARD_ID,
            userId: OWNER,
            agentId: null,
            status: "Invited",
          },
        ],
      },
    ],
    members: [],
    creates: 0,
    locks: [],
  };
  const result = await ensureDefaultTeamAgent(
    OWNER,
    TEAM,
    fakeDatabase(state) as unknown as PrismaClient,
  );
  assert.equal(result, null);
  assert.equal(state.creates, 0);
});

test("seeds when the caller is an accepted board member, not the owner", async () => {
  const state: FakeState = {
    agents: [],
    boards: [
      {
        id: BOARD_ID,
        teamId: TEAM,
        ownerId: MEMBER,
        members: [
          {
            projectId: BOARD_ID,
            userId: OWNER,
            agentId: null,
            status: "Accepted",
          },
        ],
      },
    ],
    members: [],
    creates: 0,
    locks: [],
  };
  const result = await ensureDefaultTeamAgent(
    OWNER,
    TEAM,
    fakeDatabase(state) as unknown as PrismaClient,
  );
  assert.deepEqual(result, { id: "agent-1", created: true });
  assert.equal(state.creates, 1);
});

test("rechecks after the seed lock so a concurrent create wins", async () => {
  const state: FakeState = {
    agents: [],
    boards: [ownedBoard()],
    members: [],
    creates: 0,
    locks: [],
    onLock: () => {
      state.agents.push({
        id: "winner",
        userId: OWNER,
        revokedAt: null,
        archivedAt: null,
        teamId: TEAM,
      });
    },
  };
  const result = await ensureDefaultTeamAgent(
    OWNER,
    TEAM,
    fakeDatabase(state) as unknown as PrismaClient,
  );
  assert.deepEqual(result, { id: "winner", created: false });
  assert.equal(state.creates, 0);
  assert.equal(state.locks.length, 1);
});

test("covers every accessible team that still has no live agent", async () => {
  const state: FakeState = {
    agents: [],
    boards: [ownedBoard()],
    members: [],
    creates: 0,
    locks: [],
  };
  const created = await ensureDefaultAgentsOnAccessibleTeams(
    OWNER,
    fakeDatabase(state) as unknown as PrismaClient,
  );
  assert.equal(created, 1);
});

test("agent list routes seed behind the HTPR-6512 flag", () => {
  const root = path.resolve(__dirname, "..");
  const teamRoute = readFileSync(
    path.join(root, "src/app/api/agents/route.ts"),
    "utf8",
  );
  const ownedRoute = readFileSync(
    path.join(root, "src/app/api/agents/owned/route.ts"),
    "utf8",
  );
  const keys = readFileSync(path.join(root, "src/lib/flags/keys.ts"), "utf8");
  const flags = readFileSync(path.join(root, "src/lib/flags.ts"), "utf8");

  assert.match(keys, /HTPR_6512_SEED_TEAM_AGENT_FLAG/);
  assert.match(keys, /htpr-6512-seed-team-agent/);
  assert.match(
    flags,
    /key:\s*HTPR_6512_SEED_TEAM_AGENT_FLAG[\s\S]*?seed a Hyper AI agent/,
  );
  assert.match(teamRoute, /ensureDefaultTeamAgent\(/);
  assert.match(ownedRoute, /ensureDefaultAgentsOnAccessibleTeams\(/);
  assert.match(teamRoute, /HTPR_6512_SEED_TEAM_AGENT_FLAG/);
  assert.match(ownedRoute, /HTPR_6512_SEED_TEAM_AGENT_FLAG/);
  assert.doesNotMatch(teamRoute, /as unknown as TeamAgentStore/);
  assert.doesNotMatch(ownedRoute, /as unknown as TeamAgentStore/);
});
