import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  DEFAULT_SEEDED_AGENT_NAME,
  ensureDefaultAgentsOnAccessibleTeams,
  ensureDefaultTeamAgent,
} from "../src/utils/controllers/agents/ensureDefaultTeamAgent";

const OWNER = 985;
const TEAM = "team-hypertask";
const BOARD_ID = 15;

type FakeState = {
  agents: Array<{
    id: string;
    userId: number;
    revokedAt: Date | null;
    archivedAt: Date | null;
    teamId: string;
  }>;
  boards: Array<{ id: number; teamId: string | null; ownerId: number }>;
  members: Array<{ projectId: number; userId: number; agentId: string }>;
  creates: number;
};

function fakeDatabase(state: FakeState) {
  const store = {
    agent: {
      findFirst: async ({ where }: { where: { userId: number } }) => {
        const match = state.agents.find(
          (agent) =>
            agent.userId === where.userId &&
            agent.revokedAt === null &&
            agent.archivedAt === null &&
            agent.teamId === TEAM,
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
    },
    project: {
      findFirst: async ({
        where,
      }: {
        where: { teamId: string };
      }) => {
        const board = state.boards.find(
          (row) => row.teamId === where.teamId && row.ownerId === OWNER,
        );
        return board ? { id: board.id } : null;
      },
      findMany: async () =>
        state.boards.map((board) => ({ teamId: board.teamId })),
    },
    member: {
      create: async ({
        data,
      }: {
        data: { projectId: number; userId: number; agentId: string };
      }) => {
        state.members.push(data);
        return data;
      },
    },
    $transaction: async <T,>(
      fn: (tx: Omit<typeof store, "$transaction">) => Promise<T>,
    ) => fn(store),
  };
  return store;
}

test("seeds a native Hyper AI agent on an empty team board", async () => {
  const state: FakeState = {
    agents: [],
    boards: [{ id: BOARD_ID, teamId: TEAM, ownerId: OWNER }],
    members: [],
    creates: 0,
  };
  const result = await ensureDefaultTeamAgent(
    OWNER,
    TEAM,
    fakeDatabase(state) as never,
  );
  assert.deepEqual(result, { id: "agent-1", created: true });
  assert.equal(state.creates, 1);
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
    boards: [{ id: BOARD_ID, teamId: TEAM, ownerId: OWNER }],
    members: [],
    creates: 0,
  };
  const result = await ensureDefaultTeamAgent(
    OWNER,
    TEAM,
    fakeDatabase(state) as never,
  );
  assert.deepEqual(result, { id: "existing", created: false });
  assert.equal(state.creates, 0);
});

test("does not seed when the user has no board on that team", async () => {
  const state: FakeState = {
    agents: [],
    boards: [{ id: 99, teamId: "other-team", ownerId: OWNER }],
    members: [],
    creates: 0,
  };
  const result = await ensureDefaultTeamAgent(
    OWNER,
    TEAM,
    fakeDatabase(state) as never,
  );
  assert.equal(result, null);
  assert.equal(state.creates, 0);
});

test("covers every accessible team that still has no live agent", async () => {
  const state: FakeState = {
    agents: [],
    boards: [{ id: BOARD_ID, teamId: TEAM, ownerId: OWNER }],
    members: [],
    creates: 0,
  };
  const created = await ensureDefaultAgentsOnAccessibleTeams(
    OWNER,
    fakeDatabase(state) as never,
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
});
