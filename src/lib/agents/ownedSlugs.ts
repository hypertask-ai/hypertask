import prisma from "@/lib/prisma";
import {
  assignAgentSlugs,
  looksLikeAgentId,
  resolveAgentRef,
} from "@/lib/agents/slug";

/**
 * Slugs for every agent the user owns.
 *
 * Deliberately its own query rather than reusing whatever list the caller has:
 * the register caps its page at 200 agents, and a slug assigned over a subset
 * could resolve to a different agent than the one whose card carried it.
 */
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

/**
 * The id behind whatever the URL carried, plus its canonical slug. Ids still
 * resolve, which is what keeps old links and API callers working.
 */
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
