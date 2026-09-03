import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

export const AGENT_VISIBILITIES = ["PRIVATE", "TEAM"] as const;
export type AgentVisibility = (typeof AGENT_VISIBILITIES)[number];

export const TEAM_VISIBILITY_KEY_REQUIRED_ERROR =
  "Add an API key before sharing this agent with the team.";

export function isAgentVisibility(value: unknown): value is AgentVisibility {
  return AGENT_VISIBILITIES.includes(value as AgentVisibility);
}

export function isAgentVisibleToUser(
  agent: { userId: number; visibility: AgentVisibility },
  userId: number,
): boolean {
  return agent.userId === userId || agent.visibility === "TEAM";
}

/** Visibility inside a board/team query whose human access is already proven. */
export function boardAgentVisibilityWhere(
  userId: number,
): Prisma.AgentWhereInput {
  return { OR: [{ userId }, { visibility: "TEAM" }] };
}

/** Visibility for an agent-id lookup without an existing board scope. */
export function accessibleAgentWhere(userId: number): Prisma.AgentWhereInput {
  return {
    OR: [
      { userId },
      {
        visibility: "TEAM",
        members: {
          some: {
            project: {
              status: "Normal",
              OR: [
                { ownerId: userId },
                { members: { some: { userId, agentId: null } } },
              ],
            },
          },
        },
      },
    ],
  };
}

function isSerializationConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2034"
  );
}

async function serializableAgentChange<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: "Serializable",
      });
    } catch (error) {
      if (attempt >= 2 || !isSerializationConflict(error)) throw error;
    }
  }
}

export async function setOwnedAgentVisibility(
  agentId: string,
  userId: number,
  visibility: AgentVisibility,
) {
  return serializableAgentChange((tx) =>
    setOwnedAgentVisibilityInTransaction(tx, agentId, userId, visibility),
  );
}

export async function setOwnedAgentVisibilityInTransaction(
  tx: Prisma.TransactionClient,
  agentId: string,
  userId: number,
  visibility: AgentVisibility,
) {
  const agent = await tx.agent.findFirst({
    where: { id: agentId, userId },
    select: { id: true },
  });
  if (!agent) {
    return { ok: false as const, status: 404, error: "Agent does not exist" };
  }

  if (visibility === "TEAM") {
    const enabledKeyCount = await tx.agentByokApiKey.count({
      where: { agentId, enabled: true, ciphertext: { not: null } },
    });
    if (enabledKeyCount === 0) {
      return {
        ok: false as const,
        status: 409,
        error: TEAM_VISIBILITY_KEY_REQUIRED_ERROR,
      };
    }
  }

  const updated = await tx.agent.update({
    where: { id: agentId },
    data: { visibility },
    select: { visibility: true },
  });
  return { ok: true as const, visibility: updated.visibility };
}

export async function upsertOwnedAgentProviderKey(input: {
  agentId: string;
  userId: number;
  provider: string;
  ciphertext: string;
  enabled: boolean;
}) {
  return serializableAgentChange((tx) =>
    upsertOwnedAgentProviderKeyInTransaction(tx, input),
  );
}

export async function upsertOwnedAgentProviderKeyInTransaction(
  tx: Prisma.TransactionClient,
  input: {
    agentId: string;
    userId: number;
    provider: string;
    ciphertext: string;
    enabled: boolean;
  },
) {
  const agent = await tx.agent.findFirst({
    where: { id: input.agentId, userId: input.userId },
    select: { id: true, visibility: true },
  });
  if (!agent) {
    return { ok: false as const, status: 404, error: "Agent does not exist" };
  }

  await tx.agentByokApiKey.upsert({
    where: {
      agentId_provider: {
        agentId: input.agentId,
        provider: input.provider,
      },
    },
    create: {
      agentId: input.agentId,
      provider: input.provider,
      ciphertext: input.ciphertext,
      enabled: input.enabled,
    },
    update: { ciphertext: input.ciphertext, enabled: input.enabled },
  });

  let visibility = agent.visibility;
  if (!input.enabled && visibility === "TEAM") {
    const enabledKeyCount = await tx.agentByokApiKey.count({
      where: {
        agentId: input.agentId,
        enabled: true,
        ciphertext: { not: null },
      },
    });
    if (enabledKeyCount === 0) {
      visibility = "PRIVATE";
      await tx.agent.update({
        where: { id: input.agentId },
        data: { visibility },
      });
    }
  }

  return {
    ok: true as const,
    visibility,
    visibilityChanged: visibility !== agent.visibility,
  };
}

export async function deleteOwnedAgentProviderKey(input: {
  agentId: string;
  userId: number;
  provider: string;
}) {
  return serializableAgentChange((tx) =>
    deleteOwnedAgentProviderKeyInTransaction(tx, input),
  );
}

export async function deleteOwnedAgentProviderKeyInTransaction(
  tx: Prisma.TransactionClient,
  input: { agentId: string; userId: number; provider: string },
) {
  const agent = await tx.agent.findFirst({
    where: { id: input.agentId, userId: input.userId },
    select: { id: true, visibility: true },
  });
  if (!agent) {
    return { ok: false as const, status: 404, error: "Agent does not exist" };
  }

  await tx.agentByokApiKey.deleteMany({
    where: { agentId: input.agentId, provider: input.provider },
  });

  let visibility = agent.visibility;
  if (visibility === "TEAM") {
    const enabledKeyCount = await tx.agentByokApiKey.count({
      where: {
        agentId: input.agentId,
        enabled: true,
        ciphertext: { not: null },
      },
    });
    if (enabledKeyCount === 0) {
      visibility = "PRIVATE";
      await tx.agent.update({
        where: { id: input.agentId },
        data: { visibility },
      });
    }
  }

  return {
    ok: true as const,
    visibility,
    visibilityChanged: visibility !== agent.visibility,
  };
}
