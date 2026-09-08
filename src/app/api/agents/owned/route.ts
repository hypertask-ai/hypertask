import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import type { AgentScopes } from "@/lib/mcp/agents/scopes";
import { workingOnByAgent } from "@/lib/agents/working";
import { ownedAgentSlugs } from "@/lib/agents/ownedSlugs";
import { maskAgentProviderKey } from "@/lib/agents/maskAgentProviderKey";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import {
  aiAllowancePeriod,
  parseAllowanceTeamStamp,
} from "@/lib/aiAllowancePolicy";
import { heartbeatAllowanceNoticeId } from "@/app/api/ai/_lib/heartbeatExecution";
import { agentMessageMarker } from "@/lib/nativeAgent/agentMessageEnvelope";

// An owner can keep an agent on a board they themselves were removed from, so
// board names are filtered by the caller's own access, not the agent's.
const MAX_AGENTS = 200;

export const runtime = "nodejs";

/**
 * Unread agent-chat messages per agent for one person. Every thread has its own
 * cutoff -- the reader's own `lastReadAt` -- so this cannot be a plain groupBy
 * over messages; the cutoff has to be joined in per row. Their own messages
 * never count, and neither does anything from before they joined the thread.
 */
async function unreadChatCounts(userId: number): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<{ agentId: string; unread: bigint }[]>`
    SELECT s."agentId" AS "agentId", COUNT(m.id) AS unread
    FROM "ChatSessionParticipant" p
    JOIN "ChatSession" s ON s.id = p."sessionId"
    JOIN "ChatMessage" m ON m."sessionId" = s.id
    WHERE p."userId" = ${userId}
      AND s."agentId" IS NOT NULL
      AND m."createdAt" > COALESCE(p."lastReadAt", p."joinedAt")
      AND (m."authorUserId" IS NULL OR m."authorUserId" <> ${userId})
    GROUP BY s."agentId"
  `;
  return new Map(rows.map((row) => [row.agentId, Number(row.unread)]));
}

/**
 * Most recent Agent Chat message timestamp per agent, for one person's own
 * thread with that agent. Distinct from `lastCommentByAgent` below, which
 * tracks board comments, not chat messages -- the Agent Chat list needs the
 * latter to reorder on real chat activity (HTPR-6283).
 */
async function lastChatMessageAtByAgent(userId: number): Promise<Map<string, Date>> {
  const rows = await prisma.$queryRaw<{ agentId: string; lastMessageAt: Date }[]>`
    SELECT s."agentId" AS "agentId", MAX(m."createdAt") AS "lastMessageAt"
    FROM "ChatSessionParticipant" p
    JOIN "ChatSession" s ON s.id = p."sessionId"
    JOIN "ChatMessage" m ON m."sessionId" = s.id
    WHERE p."userId" = ${userId}
      AND s."agentId" IS NOT NULL
    GROUP BY s."agentId"
  `;
  return new Map(rows.map((row) => [row.agentId, row.lastMessageAt]));
}

/**
 * Every agent the signed-in user owns, across every team and board.
 *
 * The sibling routes answer different questions: `/api/agents` lists a single
 * team's agents and `/api/agents/all` a single board's. Neither fits the agents
 * register, which is "my agents" and must not silently show one arbitrary team
 * out of the several a user belongs to. Ownership scoping here also matches
 * `/api/agents/[agentId]`, so a card and its detail page never disagree.
 */
export async function GET(request: NextRequest) {
  const userId = (await getSessionUser(request.headers))?.userId;
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
      visibility: true,
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

  const [unreadByAgent, lastChatMessageByAgent] = await Promise.all([
    unreadChatCounts(userId),
    lastChatMessageAtByAgent(userId),
  ]);

  // A spent shared AI allowance writes one durable stop notice per native
  // agent per period, the first time a turn of that agent ends on the stop.
  // The notice carries the charged team as an invisible stamp, so the stop is
  // propagated to native agents on exactly that team — the allowance is
  // funded per team, and board membership is only used where the stamp names
  // the team outright. External runtimes bring their own key and never hit
  // the shared allowance.
  const nativeIds = agents
    .filter((agent) => agent.runtimeType === "NATIVE")
    .map((agent) => agent.id);
  const outOfTokensByAgent = new Set<string>();
  if (nativeIds.length > 0) {
    const period = aiAllowancePeriod();
    // The period start bounds the scan: a notice for this period cannot be
    // older than the period, and prior periods' notices are dead state.
    const notices = await prisma.notification.findMany({
      where: {
        type: "AgentMessage",
        userId,
        fromAgentId: { in: nativeIds },
        createdAt: { gte: new Date(`${period.startDate}T00:00:00.000Z`) },
      },
      select: { fromAgentId: true, message: true },
    });
    for (const notice of notices) {
      if (!notice.fromAgentId) continue;
      if (
        !notice.message?.startsWith(
          agentMessageMarker(heartbeatAllowanceNoticeId(notice.fromAgentId, period.key)),
        )
      ) {
        continue;
      }
      outOfTokensByAgent.add(notice.fromAgentId);
      const chargedTeamId = parseAllowanceTeamStamp(notice.message);
      if (!chargedTeamId) continue;
      for (const agent of agents) {
        if (agent.runtimeType !== "NATIVE") continue;
        if (
          agent.members.some(({ project }) => project.team?.id === chargedTeamId)
        ) {
          outOfTokensByAgent.add(agent.id);
        }
      }
    }
  }

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
      // Real Agent Chat activity, separate from lastPostedAt's board comments.
      lastChatMessageAt: lastChatMessageByAgent.get(agent.id)?.toISOString() ?? null,
      // An unexpired task lease is the agent saying "I am on this right now",
      // which is what the card's spinner reports.
      working: workingByAgent.get(agent.id) ?? null,
      // Messages in this agent's shared thread that arrived after this person
      // last caught up. Private to them: it reads their own participant row.
      unreadCount: unreadByAgent.get(agent.id) ?? 0,
      outOfTokens: outOfTokensByAgent.has(agent.id),
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
