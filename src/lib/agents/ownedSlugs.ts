import prisma from "@/lib/prisma";
import {
  assignAgentSlugs,
  looksLikeAgentId,
  resolveAgentRef,
  type TSluggableAgent,
} from "@/lib/agents/slug";

/**
 * Slugs for every agent the user owns.
 *
 * Deliberately its own query rather than reusing whatever list the caller has:
 * the register caps its page at 200 agents, and a slug assigned over a subset
 * could resolve to a different agent than the one whose card carried it.
 */
export async function ownedAgentNames(userId: number) {
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
  return resolveOwnedAgentFrom(await ownedAgentNames(userId), ref);
}

/**
 * Same resolution over a list the caller already loaded with ownedAgentNames,
 * so a handler that also needs slugs later does not query the list twice.
 */
export function resolveOwnedAgentFrom(
  owned: TSluggableAgent[],
  ref: string,
): { id: string; slug: string } | null {
  const id =
    looksLikeAgentId(ref) && owned.some((agent) => agent.id === ref)
      ? ref
      : resolveAgentRef(owned, ref);
  if (!id) return null;
  return { id, slug: assignAgentSlugs(owned).get(id) ?? id };
}

/**
 * Slugs after one agent in an already-loaded list is renamed. Same result as
 * reloading the list after the write, since the rename changes only that row.
 */
export function ownedSlugsAfterRename(
  owned: TSluggableAgent[],
  agentId: string,
  displayName: string,
): Map<string, string> {
  return assignAgentSlugs(
    owned.map((agent) =>
      agent.id === agentId ? { ...agent, displayName } : agent,
    ),
  );
}
