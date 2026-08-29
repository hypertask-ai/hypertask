/**
 * Behavioural tests for the shared agent lifecycle used by the web dashboard,
 * MCP, the CLI and AI chat (HTPR-5418). The module takes its database and its
 * token/runtime dependencies as arguments, so these run against fakes.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  archiveOwnedAgent,
  launchOwnedAgent,
  renameOwnedAgent,
  type AgentLifecycleDatabase,
  type AgentLifecycleRow,
} from "../src/lib/mcp/agents/lifecycle";

type FakeState = {
  row: AgentLifecycleRow | null;
  ownerEmail: string | null;
  updateManyCount: number;
  mintCalls: number;
  clearCalls: number;
  /** Simulates another tab winning the enable race. */
  loseTransition?: boolean;
};

/** Stands in for agentTokenCredentialFields: these fakes are not real JWTs. */
function fakeCredentialFields(token: string | null) {
  return token
    ? { mcpTokenHash: `hash:${token}`, mcpTokenJti: `jti:${token}` }
    : { mcpTokenHash: null, mcpTokenJti: null };
}

function agentRow(overrides: Partial<AgentLifecycleRow> = {}): AgentLifecycleRow {
  return {
    id: "agent-1",
    displayName: "Board Maintainer",
    photoURL: null,
    revokedAt: new Date("2026-08-01T00:00:00.000Z"),
    archivedAt: null,
    runtimeType: "EXTERNAL",
    mcpTokenHash: null,
    mcpTokenJti: null,
    ...overrides,
  };
}

function fakeSetup(state: FakeState) {
  const database = {
    agent: {
      findFirst: async ({ where }: any) =>
        state.row && state.row.id === where.id ? { ...state.row } : null,
      updateMany: async ({ where, data }: any) => {
        if (state.loseTransition) return { count: 0 };
        if (!state.row || state.row.revokedAt === null) return { count: 0 };
        assert.equal(where.userId, 6);
        state.row = {
          ...state.row,
          revokedAt: data.revokedAt,
          mcpTokenHash: data.mcpTokenHash,
          mcpTokenJti: data.mcpTokenJti,
        };
        state.updateManyCount += 1;
        return { count: 1 };
      },
      update: async ({ data }: any) => {
        state.row = { ...(state.row as AgentLifecycleRow), ...data };
        return { ...(state.row as AgentLifecycleRow) };
      },
    },
    user: {
      findUnique: async () =>
        state.ownerEmail ? { email: state.ownerEmail } : null,
    },
  } as unknown as AgentLifecycleDatabase;

  const deps = {
    mintToken: (userId: number, email: string, agentId: string) => {
      state.mintCalls += 1;
      return `token-${userId}-${email}-${agentId}`;
    },
    clearRuntime: async () => {
      state.clearCalls += 1;
    },
    // HTPR-4671: the row keeps a digest and a generation, never the token.
    credentialFields: fakeCredentialFields,
  };

  return { database, deps };
}

test("launching a disabled external agent switches it on and reveals one token", async () => {
  const state: FakeState = {
    row: agentRow(),
    ownerEmail: "valentin@example.com",
    updateManyCount: 0,
    mintCalls: 0,
    clearCalls: 0,
  };
  const { database, deps } = fakeSetup(state);

  const result = await launchOwnedAgent(database, deps, 6, "agent-1");

  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.alreadyRunning, false);
  assert.equal(result.agent.revokedAt, null);
  assert.equal(result.token, "token-6-valentin@example.com-agent-1");
  // The destroyed token cannot be reused, so a fresh one is stored, and the
  // stale runtime snapshot is dropped before the agent comes back.
  assert.deepEqual(state.row && {
    mcpTokenHash: state.row.mcpTokenHash,
    mcpTokenJti: state.row.mcpTokenJti,
  }, fakeCredentialFields(result.token));
  assert.equal(state.clearCalls, 1);
  assert.equal(state.mintCalls, 1);
});

test("launching a native agent switches it on without minting a credential", async () => {
  const state: FakeState = {
    row: agentRow({ runtimeType: "NATIVE" }),
    ownerEmail: "valentin@example.com",
    updateManyCount: 0,
    mintCalls: 0,
    clearCalls: 0,
  };
  const { database, deps } = fakeSetup(state);

  const result = await launchOwnedAgent(database, deps, 6, "agent-1");

  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.token, null);
  assert.equal(state.mintCalls, 0);
  assert.equal(state.row?.revokedAt, null);
});

test("launching an already running agent changes nothing", async () => {
  const state: FakeState = {
    row: agentRow({ revokedAt: null, ...fakeCredentialFields("existing-token") }),
    ownerEmail: "valentin@example.com",
    updateManyCount: 0,
    mintCalls: 0,
    clearCalls: 0,
  };
  const { database, deps } = fakeSetup(state);

  const result = await launchOwnedAgent(database, deps, 6, "agent-1");

  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.alreadyRunning, true);
  assert.equal(result.token, null);
  assert.equal(state.mintCalls, 0);
  assert.equal(state.updateManyCount, 0);
  assert.deepEqual(state.row && {
    mcpTokenHash: state.row.mcpTokenHash,
    mcpTokenJti: state.row.mcpTokenJti,
  }, fakeCredentialFields("existing-token"));
});

test("losing the enable race reveals no token", async () => {
  const state: FakeState = {
    row: agentRow(),
    ownerEmail: "valentin@example.com",
    updateManyCount: 0,
    mintCalls: 0,
    clearCalls: 0,
    loseTransition: true,
  };
  const { database, deps } = fakeSetup(state);

  const result = await launchOwnedAgent(database, deps, 6, "agent-1");

  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.token, null);
  assert.equal(result.alreadyRunning, true);
});

test("launching an agent the caller does not own is not found", async () => {
  const state: FakeState = {
    row: agentRow(),
    ownerEmail: "valentin@example.com",
    updateManyCount: 0,
    mintCalls: 0,
    clearCalls: 0,
  };
  const { database, deps } = fakeSetup(state);

  const result = await launchOwnedAgent(database, deps, 6, "someone-elses");

  assert.equal(result.status, "not_found");
  assert.equal(state.mintCalls, 0);
});

test("a runtime snapshot failure leaves the agent off and mints nothing", async () => {
  const state: FakeState = {
    row: agentRow(),
    ownerEmail: "valentin@example.com",
    updateManyCount: 0,
    mintCalls: 0,
    clearCalls: 0,
  };
  const { database } = fakeSetup(state);
  const deps = {
    mintToken: () => "token-after-snapshot-failure",
    clearRuntime: async () => {
      throw new Error("redis down");
    },
    credentialFields: fakeCredentialFields,
  };

  const result = await launchOwnedAgent(database, deps, 6, "agent-1");

  // Failing closed: a stale snapshot must never outlive the switch-on, so the
  // agent stays revoked, no credential is minted, and a retry is the way back.
  assert.equal(result.status, "runtime_invalidation_failed");
  assert.equal(state.mintCalls, 0);
  assert.equal(state.updateManyCount, 0);
});

test("archiving hides an agent without switching it off", async () => {
  const revokedAt = null;
  const state: FakeState = {
    row: agentRow({ revokedAt, ...fakeCredentialFields("live-token") }),
    ownerEmail: "valentin@example.com",
    updateManyCount: 0,
    mintCalls: 0,
    clearCalls: 0,
  };
  const { database } = fakeSetup(state);

  const archived = await archiveOwnedAgent(database, 6, "agent-1", true);
  assert.equal(archived.status, "ok");
  if (archived.status !== "ok") return;
  assert.notEqual(archived.agent.archivedAt, null);
  assert.equal(archived.agent.revokedAt, null);
  assert.equal(
    archived.agent.mcpTokenHash,
    fakeCredentialFields("live-token").mcpTokenHash,
  );

  const restored = await archiveOwnedAgent(database, 6, "agent-1", false);
  assert.equal(restored.status, "ok");
  if (restored.status !== "ok") return;
  assert.equal(restored.agent.archivedAt, null);
});

test("archiving an agent the caller does not own is not found", async () => {
  const state: FakeState = {
    row: agentRow(),
    ownerEmail: "valentin@example.com",
    updateManyCount: 0,
    mintCalls: 0,
    clearCalls: 0,
  };
  const { database } = fakeSetup(state);

  const result = await archiveOwnedAgent(database, 6, "someone-elses", true);
  assert.equal(result.status, "not_found");
});

test("renaming an owned agent updates its display name", async () => {
  const state: FakeState = {
    row: agentRow(),
    ownerEmail: "valentin@example.com",
    updateManyCount: 0,
    mintCalls: 0,
    clearCalls: 0,
  };
  const { database } = fakeSetup(state);

  const result = await renameOwnedAgent(
    database,
    6,
    "agent-1",
    "Release Helper"
  );

  assert.equal(result.status, "ok");
  if (result.status !== "ok") return;
  assert.equal(result.agent.displayName, "Release Helper");
  assert.equal(state.row?.displayName, "Release Helper");
  assert.equal(result.agent.revokedAt?.toISOString(), "2026-08-01T00:00:00.000Z");
});

test("renaming an agent the caller does not own is not found", async () => {
  const state: FakeState = {
    row: agentRow(),
    ownerEmail: "valentin@example.com",
    updateManyCount: 0,
    mintCalls: 0,
    clearCalls: 0,
  };
  const { database } = fakeSetup(state);

  const result = await renameOwnedAgent(
    database,
    6,
    "someone-elses",
    "Release Helper"
  );

  assert.equal(result.status, "not_found");
  assert.equal(state.row?.displayName, "Board Maintainer");
});
