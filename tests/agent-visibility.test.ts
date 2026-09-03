import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function main() {
  process.env.DATABASE_URL =
    "postgresql://unused:unused@localhost:5432/unused";

  const {
    TEAM_VISIBILITY_KEY_REQUIRED_ERROR,
    accessibleAgentWhere,
    boardAgentVisibilityWhere,
    deleteOwnedAgentProviderKeyInTransaction,
    setOwnedAgentVisibilityInTransaction,
    upsertOwnedAgentProviderKeyInTransaction,
  } = await import("@/lib/agents/visibility");

  assert.deepEqual(boardAgentVisibilityWhere(42), {
    OR: [{ userId: 42 }, { visibility: "TEAM" }],
  });
  assert.deepEqual(accessibleAgentWhere(42), {
    OR: [
      { userId: 42 },
      {
        visibility: "TEAM",
        members: {
          some: {
            project: {
              status: "Normal",
              OR: [
                { ownerId: 42 },
                { members: { some: { userId: 42, agentId: null } } },
              ],
            },
          },
        },
      },
    ],
  });

  let updateCount = 0;
  const noKeyTx = {
    agent: {
      findFirst: async () => ({ id: "owned-agent" }),
      update: async () => {
        updateCount += 1;
        return { visibility: "TEAM" };
      },
    },
    agentByokApiKey: { count: async () => 0 },
  } as any;
  const blocked = await setOwnedAgentVisibilityInTransaction(
    noKeyTx,
    "owned-agent",
    42,
    "TEAM",
  );
  assert.deepEqual(blocked, {
    ok: false,
    status: 409,
    error: TEAM_VISIBILITY_KEY_REQUIRED_ERROR,
  });
  assert.equal(updateCount, 0, "TEAM must not be saved without an enabled key");

  let guessedUpdateCount = 0;
  const guessedIdTx = {
    agent: {
      findFirst: async ({ where }: any) => {
        assert.deepEqual(where, { id: "another-users-agent", userId: 42 });
        return null;
      },
      update: async () => {
        guessedUpdateCount += 1;
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

  const [
    detail,
    providerRoute,
    agentRoute,
    activityRoute,
    notificationsRoute,
    tokenRoute,
    inboxPage,
  ] = await Promise.all([
    readFile("src/app/agents/[agentId]/AgentDetail.tsx", "utf8"),
    readFile("src/app/api/agents/[agentId]/provider-key/route.ts", "utf8"),
    readFile("src/app/api/agents/[agentId]/route.ts", "utf8"),
    readFile("src/app/api/agents/[agentId]/activity/route.ts", "utf8"),
    readFile("src/app/api/agents/[agentId]/notifications/route.ts", "utf8"),
    readFile("src/app/api/agents/[agentId]/mcp-token/route.ts", "utf8"),
    readFile("src/app/inbox/agent/[agentId]/page.tsx", "utf8"),
  ]);
  assert.match(detail, /<InfoRow label="Visibility">/);
  assert.match(detail, /<AgentOption value="PRIVATE">Private<\/AgentOption>/);
  assert.match(detail, /<AgentOption value="TEAM">Team<\/AgentOption>/);
  assert.match(
    detail,
    /Provider key removed\. This agent is now private\./,
  );
  assert.match(providerRoute, /deleteOwnedAgentProviderKey\(/);
  assert.match(providerRoute, /upsertOwnedAgentProviderKey\(/);
  assert.match(agentRoute, /setOwnedAgentVisibility\(/);
  for (const ownerSurface of [
    agentRoute,
    activityRoute,
    notificationsRoute,
    tokenRoute,
    inboxPage,
  ]) {
    assert.match(ownerSurface, /getSessionUser\(/);
    assert.doesNotMatch(ownerSurface, /JSON\.parse\(userCookie\.value\)/);
  }

  console.log("agent-visibility.test.ts: all assertions passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
