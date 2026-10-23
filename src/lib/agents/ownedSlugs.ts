import prisma from "@/lib/prisma";
import {
  assignAgentSlugs,
  looksLikeAgentId,
  resolveAgentRef,
} from "@/lib/agents/slug";

async function ownedAgentNames(userId: number) {
  return prisma.agent.findMany({
    where: { userId },
    select: { id: true, displayName: true, createdAt: true },
  });
}

export async function ownedAgentSlugs(
  userId: number,
): Promise<Map<string, string>> {
  return assignAgentSlugs(await ownedAgentNames(userId));
}

export async function resolveOwnedAgent(
  userId: number,
  ref: string,
): Promise<{ id: string; slug: string } | null> {
  const owned = await ownedAgentNames(userId);
  const id =
    looksLikeAgentId(ref) && owned.some((agent) => agent.id === ref)
      ? ref
      : resolveAgentRef(owned, ref);
  if (!id) return null;
  return { id, slug: assignAgentSlugs(owned).get(id) ?? id };
}
