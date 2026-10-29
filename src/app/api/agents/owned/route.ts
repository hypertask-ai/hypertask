import { haiku55ModelEnabled } from "@/app/api/ai/_lib/planGate";
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
import { isOwnerOrQaUserId } from "@/lib/flags";
import { getAiModelOptionById } from "@/lib/aiModelOptions";
import { ensureDefaultAgentsOnAccessibleTeams } from "@/utils/controllers/agents/ensureDefaultTeamAgent";

const MAX_AGENTS = 200;

export const runtime = "nodejs";

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

export async function GET(request: NextRequest) {
  const userId = (await getSessionUser(request.headers))?.userId;
  if (!userId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }
  if (await isOwnerOrQaUserId(userId)) {
    await ensureDefaultAgentsOnAccessibleTeams(userId, prisma);
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

  const slugs = await ownedAgentSlugs(userId);

  const workingByAgent = await workingOnByAgent(
    agents.map((agent) => agent.id),
    userId,
  );

  const [unreadByAgent, lastChatMessageByAgent] = await Promise.all([
    unreadChatCounts(userId),
    lastChatMessageAtByAgent(userId),
  ]);

  const nativeIds = agents
    .filter((agent) => agent.runtimeType === "NATIVE")
    .map((agent) => agent.id);
  const outOfTokensByAgent = new Set<string>();
  if (nativeIds.length > 0) {
    const period = aiAllowancePeriod();
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

  const haiku55Enabled = await haiku55ModelEnabled(userId);
  return NextResponse.json({
    success: true,
    agents: agents.map(({ permissions, members, byokApiKeys, ...agent }) => ({
      providerKey: maskAgentProviderKey(byokApiKeys),
      ...agent,
      modelOptionId: haiku55Enabled ? getAiModelOptionById(agent.modelOptionId, true)?.id ?? agent.modelOptionId : agent.modelOptionId,
      slug: slugs.get(agent.id) ?? agent.id,
      createdAt: agent.createdAt.toISOString(),
      revokedAt: agent.revokedAt?.toISOString() ?? null,
      archivedAt: agent.archivedAt?.toISOString() ?? null,
      heartbeatAt: agent.heartbeatAt?.toISOString() ?? null,
      lastPostedAt: lastCommentByAgent.get(agent.id)?.toISOString() ?? null,
      lastChatMessageAt: lastChatMessageByAgent.get(agent.id)?.toISOString() ?? null,
      working: workingByAgent.get(agent.id) ?? null,
      unreadCount: unreadByAgent.get(agent.id) ?? 0,
      outOfTokens: outOfTokensByAgent.has(agent.id),
      postsToImportant:
        (permissions as AgentScopes | null)?.postsToImportant !== false,
      boards: members.map(({ project }) => ({
        id: project.id,
        name: project.title ?? project.name,
        teamId: project.team?.id ?? null,
        teamName: project.team?.title ?? null,
      })),
    })),
  });
}
