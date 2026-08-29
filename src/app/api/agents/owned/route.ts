import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import type { AgentScopes } from "@/lib/mcp/agents/scopes";
import { workingOnByAgent } from "@/lib/agents/working";
import { ownedAgentSlugs } from "@/lib/agents/ownedSlugs";
import { maskAgentProviderKey } from "@/lib/agents/maskAgentProviderKey";

// An owner can keep an agent on a board they themselves were removed from, so
// board names are filtered by the caller's own access, not the agent's.
const MAX_AGENTS = 200;

export const runtime = "nodejs";

/**
 * Every agent the signed-in user owns, across every team and board.
 *
 * The sibling routes answer different questions: `/api/agents` lists a single
 * team's agents and `/api/agents/all` a single board's. Neither fits the agents
 * register, which is "my agents" and must not silently show one arbitrary team
 * out of the several a user belongs to. Ownership scoping here also matches
 * `/api/agents/[agentId]`, so a card and its detail page never disagree.
 */
export async function GET() {
  let userId: number | undefined;
  try {
    const userCookie = (await cookies()).get("nookies_user");
    userId = userCookie?.value
      ? (JSON.parse(userCookie.value) as { id?: number }).id
      : undefined;
  } catch {
    userId = undefined;
  }
  if (!userId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const agents = await prisma.agent.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: MAX_AGENTS,
    select: {
      id: true,
      displayName: true,
      photoURL: true,
      createdAt: true,
      revokedAt: true,
      archivedAt: true,
      permissions: true,
      runtimeType: true,
      prompt: true,
      modelOptionId: true,
      heartbeatAt: true,
      // Owner-only endpoint, so the masked tail of the agent's own provider
      // key belongs on the register card too (HTPR-5389).
      byokApiKeys: {
        where: { enabled: true },
        orderBy: { provider: "asc" },
        select: { provider: true, ciphertext: true },
      },
      members: {
        where: {
          status: "Accepted",
          project: { status: "Normal", ...getProjectWhere(userId) },
        },
        select: {
          project: {
            select: {
              id: true,
              name: true,
              title: true,
              team: { select: { id: true, title: true } },
            },
          },
        },
      },
    },
  });

  // "Last acted" is the newest thing the agent actually did. A heartbeat that
  // found nothing is not an action, so it is not counted here; the detail page
  // shows that separately.
  const lastComments = agents.length
    ? await prisma.comment.groupBy({
        by: ["agentId"],
        where: {
          agentId: { in: agents.map((agent) => agent.id) },
          task: { project: getProjectWhere(userId) },
        },
        _max: { createdAt: true },
      })
    : [];
  const lastCommentByAgent = new Map(
    lastComments.flatMap((row) =>
      row.agentId ? [[row.agentId, row._max.createdAt]] : [],
    ),
  );

  // Its own query over every owned agent, not this capped page: a slug has to
  // mean the same thing here as it does when the detail route resolves it.
  const slugs = await ownedAgentSlugs(userId);

  const workingByAgent = await workingOnByAgent(
    agents.map((agent) => agent.id),
    userId,
  );

  return NextResponse.json({
    success: true,
    agents: agents.map(({ permissions, members, byokApiKeys, ...agent }) => ({
      providerKey: maskAgentProviderKey(byokApiKeys),
      ...agent,
      slug: slugs.get(agent.id) ?? agent.id,
      createdAt: agent.createdAt.toISOString(),
      revokedAt: agent.revokedAt?.toISOString() ?? null,
      archivedAt: agent.archivedAt?.toISOString() ?? null,
      heartbeatAt: agent.heartbeatAt?.toISOString() ?? null,
      lastPostedAt: lastCommentByAgent.get(agent.id)?.toISOString() ?? null,
      // An unexpired task lease is the agent saying "I am on this right now",
      // which is what the card's spinner reports.
      working: workingByAgent.get(agent.id) ?? null,
      postsToImportant:
        (permissions as AgentScopes | null)?.postsToImportant !== false,
      // Teams come from the boards, since an agent belongs to its owner rather
      // than to a team. `members` is already scoped to boards the caller can
      // see, so "no team" here means "no board you have access to", not "no
      // boards at all" — do not widen this to the agent's own membership.
      boards: members.map(({ project }) => ({
        id: project.id,
        name: project.title ?? project.name,
        teamId: project.team?.id ?? null,
        teamName: project.team?.title ?? null,
      })),
    })),
  });
}
