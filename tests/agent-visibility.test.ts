import { assertAgentVisibilitySources } from "./helpers/agent-visibility-source";
import assert from "node:assert/strict";

async function main() {
  process.env.DATABASE_URL =
    "postgresql://unused:unused@localhost:5432/unused";

  const {
    TEAM_VISIBILITY_OWNER_PLAN_WARNING,
    accessibleAgentMembershipWhere,
    accessibleAgentWhere,
    boardAgentVisibilityWhere,
    deleteOwnedAgentProviderKeyInTransaction,
    isAgentVisibleToUser,
    setOwnedAgentVisibilityInTransaction,
    upsertOwnedAgentProviderKeyInTransaction,
  } = await import("@/lib/agents/visibility");

  assert.deepEqual(boardAgentVisibilityWhere(42), {
    OR: [{ userId: 42 }, { visibility: "TEAM" }],
  });
  const accessibleMembership = {
    project: {
      status: "Normal",
      OR: [
        { ownerId: 42 },
        { members: { some: { userId: 42, agentId: null } } },
      ],
    },
  };
  assert.deepEqual(accessibleAgentMembershipWhere(42), accessibleMembership);
  assert.deepEqual(accessibleAgentWhere(42), {
    OR: [
      { userId: 42 },
      {
        visibility: "TEAM",
        members: { some: accessibleMembership },
      },
    ],
  });
  assert.equal(
    isAgentVisibleToUser(
      { userId: 42, visibility: "PRIVATE", members: [] },
      42,
    ),
    true,
  );
  assert.equal(
    isAgentVisibleToUser(
      { userId: 7, visibility: "PRIVATE", members: [{ projectId: 15 }] },
      42,
    ),
    false,
  );
  assert.equal(
    isAgentVisibleToUser(
      { userId: 7, visibility: "TEAM", members: [] },
      42,
    ),
    false,
  );
  assert.equal(
    isAgentVisibleToUser(
      { userId: 7, visibility: "TEAM", members: [{ projectId: 15 }] },
      42,
    ),
    true,
  );

  const { mapVisibleMcpAgent, mcpVisibleAgentSelect } = await import(
    "@/lib/mcp/agents"
  );
  assert.deepEqual(mcpVisibleAgentSelect(42).members, {
    where: accessibleMembership,
    select: { projectId: true },
  });
  assert.deepEqual(mcpVisibleAgentSelect(42, 15).members, {
    where: {
      project: { ...accessibleMembership.project, id: 15 },
    },
    select: { projectId: true },
    take: 1,
  });
  const privateMcpAgent = {
    id: "private-agent",
    displayName: "Private helper",
    photoURL: null,
    userId: 7,
    visibility: "PRIVATE" as const,
    members: [],
  };
  assert.equal(mapVisibleMcpAgent(privateMcpAgent, 42, 15), undefined);
  assert.equal(mapVisibleMcpAgent(privateMcpAgent, 7, 15)?.id, "private-agent");
  assert.equal(
    mapVisibleMcpAgent(
      { ...privateMcpAgent, visibility: "TEAM", members: [] },
      42,
      15,
    ),
    undefined,
  );
  assert.equal(
    mapVisibleMcpAgent(
      {
        ...privateMcpAgent,
        visibility: "TEAM",
        members: [{ projectId: 15 }],
      },
      42,
      15,
    )?.id,
    "private-agent",
  );
  assert.equal(
    mapVisibleMcpAgent(
      {
        ...privateMcpAgent,
        visibility: "TEAM",
        members: [{ projectId: 99 }],
      },
      42,
      15,
    ),
    undefined,
  );

  const { projectVisibleTaskAgent } = await import(
    "@/utils/controllers/taskDetail/load"
  );
  const taskAgent = {
    id: "private-agent",
    userId: 7,
    displayName: "Private helper",
    photoURL: null,
    createdAt: new Date("2026-09-03T00:00:00Z"),
    revokedAt: null,
    runtimeType: "NATIVE" as const,
    heartbeatAt: null,
    permissions: {},
    visibility: "PRIVATE" as const,
    members: [],
  };
  assert.equal(projectVisibleTaskAgent(taskAgent, 42, 15), null);
  const ownerTaskAgent = projectVisibleTaskAgent(taskAgent, 7, 15);
  assert.equal(ownerTaskAgent?.id, taskAgent.id);
  assert.equal("visibility" in (ownerTaskAgent ?? {}), false);
  assert.equal(
    projectVisibleTaskAgent(
      { ...taskAgent, visibility: "TEAM", members: [] },
      42,
      15,
    ),
    null,
  );
  assert.equal(
    projectVisibleTaskAgent(
      { ...taskAgent, visibility: "TEAM", members: [{ projectId: 15 }] },
      42,
      15,
    )?.id,
    taskAgent.id,
  );
  assert.equal(
    projectVisibleTaskAgent(
      { ...taskAgent, visibility: "TEAM", members: [{ projectId: 99 }] },
      42,
      15,
    ),
    null,
  );

  let updateCount = 0;
  const nativeNoKeyTx = {
    agent: {
      findFirst: async () => ({ id: "owned-agent", runtimeType: "NATIVE" }),
      updateMany: async () => {
        updateCount += 1;
        return { count: 1 };
      },
    },
    agentByokApiKey: { count: async () => 0 },
  } as any;
  assert.deepEqual(
    await setOwnedAgentVisibilityInTransaction(
      nativeNoKeyTx,
      "owned-agent",
      42,
      "TEAM",
    ),
    {
      ok: true,
      visibility: "TEAM",
      warning: TEAM_VISIBILITY_OWNER_PLAN_WARNING,
    },
  );
  assert.equal(updateCount, 1, "the owner may share a native agent without a key");

  const nativeWithKeyTx = {
    ...nativeNoKeyTx,
    agentByokApiKey: { count: async () => 1 },
  } as any;
  assert.deepEqual(
    await setOwnedAgentVisibilityInTransaction(
      nativeWithKeyTx,
      "owned-agent",
      42,
      "TEAM",
    ),
    { ok: true, visibility: "TEAM" },
  );

  const externalNoKeyTx = {
    ...nativeNoKeyTx,
    agent: {
      ...nativeNoKeyTx.agent,
      findFirst: async () => ({ id: "owned-agent", runtimeType: "EXTERNAL" }),
    },
    agentByokApiKey: {
      count: async () => {
        throw new Error("external agents must not be checked for a provider key");
      },
    },
  } as any;
  assert.deepEqual(
    await setOwnedAgentVisibilityInTransaction(
      externalNoKeyTx,
      "owned-agent",
      42,
      "TEAM",
    ),
    { ok: true, visibility: "TEAM" },
  );

  let guessedUpdateCount = 0;
  const guessedIdTx = {
    agent: {
      findFirst: async ({ where }: any) => {
        assert.deepEqual(where, { id: "another-users-agent", userId: 42 });
        return null;
      },
      updateMany: async () => {
        guessedUpdateCount += 1;
        return { count: 1 };
      },
    },
  } as any;
  const denied = await setOwnedAgentVisibilityInTransaction(
    guessedIdTx,
    "another-users-agent",
    42,
    "PRIVATE",
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 404);
  assert.equal(guessedUpdateCount, 0, "a guessed agent id must not be mutated");

  const keyState = new Map([
    ["openrouter", { ciphertext: "secret", enabled: true }],
  ]);
  let visibility: "PRIVATE" | "TEAM" = "TEAM";
  const keyTx = {
    agent: {
      findFirst: async () => ({ id: "owned-agent", visibility }),
      update: async ({ data }: any) => {
        visibility = data.visibility;
        return { visibility };
      },
    },
    agentByokApiKey: {
      upsert: async ({ create, update }: any) => {
        keyState.set(create.provider, {
          ciphertext: update.ciphertext,
          enabled: update.enabled,
        });
      },
      deleteMany: async ({ where }: any) => {
        keyState.delete(where.provider);
      },
      count: async () =>
        [...keyState.values()].filter(
          (key) => key.enabled && key.ciphertext !== null,
        ).length,
    },
  } as any;

  const disabled = await upsertOwnedAgentProviderKeyInTransaction(keyTx, {
    agentId: "owned-agent",
    userId: 42,
    provider: "openrouter",
    ciphertext: "secret",
    enabled: false,
  });
  assert.deepEqual(disabled, {
    ok: true,
    visibility: "PRIVATE",
    visibilityChanged: true,
  });
  assert.equal(visibility, "PRIVATE");

  visibility = "TEAM";
  keyState.set("openrouter", { ciphertext: "secret", enabled: true });
  const deleted = await deleteOwnedAgentProviderKeyInTransaction(keyTx, {
    agentId: "owned-agent",
    userId: 42,
    provider: "openrouter",
  });
  assert.deepEqual(deleted, {
    ok: true,
    visibility: "PRIVATE",
    visibilityChanged: true,
  });
  assert.equal(visibility, "PRIVATE");

  visibility = "TEAM";
  keyState.set("openrouter", { ciphertext: "secret", enabled: true });
  keyState.set("anthropic", { ciphertext: "other", enabled: true });
  const retained = await deleteOwnedAgentProviderKeyInTransaction(keyTx, {
    agentId: "owned-agent",
    userId: 42,
    provider: "openrouter",
  });
  assert.deepEqual(retained, {
    ok: true,
    visibility: "TEAM",
    visibilityChanged: false,
  });

  await assertAgentVisibilitySources();

  console.log("agent-visibility.test.ts: all assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
