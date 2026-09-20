import type { Prisma, PrismaClient } from "@prisma/client";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { maskAgentProviderKey } from "@/lib/agents/maskAgentProviderKey";
import { boardAgentVisibilityWhere } from "@/lib/agents/visibility";
import { HTPR_6530_MCP_LIST_QUERY_FLAG, isFeatureEnabled } from "@/lib/flags";
import type { AgentScopes } from "@/lib/mcp/agents/scopes";
import { getAgentTeamId } from "@/utils/controllers/agents/teamScope";
import {
  checkMcpRateLimit,
  validateManagementOrSessionAuth,
  validateMcpAuth,
} from "@/lib/mcp/auth";
import {
  listOwnedAgents,
  type AgentManagementDatabase,
} from "@/lib/mcp/agents/ownedAgents";
import { hasManagementReadPermission } from "@/lib/mcp/managementPermissions";
import { readEnabledListQuery, tryApplyCollectionQuery } from "@/lib/mcp/readListQuery";
import prisma from "@/lib/prisma";

type AgentDatabase = Pick<PrismaClient | Prisma.TransactionClient, "agent">;

export function agentStore(database: AgentDatabase = prisma) {
  return database.agent;
}

export async function listTeamAgents(currentUserId: number, teamId: string) {
  const agents = await agentStore().findMany({
    where: {
      members: { some: { project: { teamId } } },
      ...boardAgentVisibilityWhere(currentUserId),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      displayName: true,
      visibility: true,
      photoURL: true,
      createdAt: true,
      revokedAt: true,
      userId: true,
      mcpTokenJti: true,
      mcpTokenExpiresAt: true,
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
        orderBy: { id: "asc" },
        select: {
          project: { select: { id: true, name: true, teamId: true, title: true } },
        },
      },
    },
  });

  const scopedAgents = agents.filter(
    (agent) =>
      getAgentTeamId(agent.members.map(({ project }) => project.teamId)) === teamId,
  );
  const agentIds = scopedAgents.map((agent) => agent.id);
  const lastPostedByAgentId = new Map<string, string>();
  const lastOAuthByAgentId = new Map<
    string,
    { clientId: string; clientName: string | null; lastAuthorizedAt: string }
  >();

  if (agentIds.length > 0) {
    const [lastPosts, usedCodes] = await Promise.all([
      prisma.comment.groupBy({
        by: ["agentId"],
        where: { agentId: { in: agentIds } },
        _max: { createdAt: true },
      }),
      prisma.oAuthAuthorizationCode.findMany({
        where: { user_id: currentUserId, used: true, agent_id: { in: agentIds } },
        include: { client: { select: { client_id: true, client_name: true } } },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    for (const row of lastPosts) {
      if (row.agentId && row._max.createdAt) {
        lastPostedByAgentId.set(row.agentId, row._max.createdAt.toISOString());
      }
    }
    for (const row of usedCodes) {
      if (!row.agent_id || lastOAuthByAgentId.has(row.agent_id)) continue;
      lastOAuthByAgentId.set(row.agent_id, {
        clientId: row.client.client_id,
        clientName: row.client.client_name,
        lastAuthorizedAt: row.createdAt.toISOString(),
      });
    }
  }

  return scopedAgents.map(
    ({ members, permissions, mcpTokenJti, mcpTokenExpiresAt, byokApiKeys, ...agent }) => ({
      ...agent,
      providerKey:
        agent.userId === currentUserId ? maskAgentProviderKey(byokApiKeys) : null,
      postsToImportant:
        (permissions as AgentScopes | null)?.postsToImportant !== false,
      createdAt: agent.createdAt.toISOString(),
      revokedAt: agent.revokedAt?.toISOString() ?? null,
      hasMcpToken: agent.userId === currentUserId ? Boolean(mcpTokenJti) : false,
      mcpTokenExpiresAt:
        agent.userId === currentUserId
          ? mcpTokenExpiresAt?.toISOString() ?? null
          : null,
      prompt: agent.userId === currentUserId ? agent.prompt ?? null : null,
      heartbeatAt: agent.heartbeatAt?.toISOString() ?? null,
      lastPostedAt: lastPostedByAgentId.get(agent.id) ?? null,
      lastOAuthMcpClient: lastOAuthByAgentId.get(agent.id) ?? null,
      boards: Array.from(
        new Map(
          members
            .filter(({ project }) => project.teamId === teamId)
            .map(({ project }) => [
              project.id,
              { id: project.id, name: project.title ?? project.name },
            ]),
        ).values(),
      ),
    }),
  );
}

export async function handleListAgentsRequest(
  request: NextRequest,
  authMode: "mcp" | "management" = "mcp",
): Promise<NextResponse> {
  const rateLimited = await checkMcpRateLimit(request);
  if (rateLimited) return rateLimited;

  const ctx = authMode === "management"
    ? await validateManagementOrSessionAuth(request, "read")
    : await validateMcpAuth(request, { deferManagementPermissionCheck: true });
  if (!ctx) {
    return NextResponse.json(
      { success: false, error: "Unauthorized. Invalid or missing authentication token." },
      { status: 401 },
    );
  }
  if (ctx.agentId) {
    return NextResponse.json(
      { success: false, error: "Agents cannot list managed agent identities" },
      { status: 403 },
    );
  }
  if (ctx.management && !hasManagementReadPermission(ctx.management.permissions)) {
    return NextResponse.json(
      { success: false, error: "Management key does not have permission to list agents" },
      { status: 403 },
    );
  }

  const agents = await listOwnedAgents(
    prisma as unknown as AgentManagementDatabase,
    ctx.user.id,
    ctx.management?.teamId,
  );
  const listQueryEnabled = await isFeatureEnabled(
    HTPR_6530_MCP_LIST_QUERY_FLAG,
    ctx.user.id,
  );
  const parsedListQuery = readEnabledListQuery(
    listQueryEnabled,
    request.nextUrl.searchParams,
  );
  if (parsedListQuery.error) return parsedListQuery.error;
  if (!parsedListQuery.listQuery) {
    return NextResponse.json({ success: true, agents });
  }
  const projected = tryApplyCollectionQuery(
    agents as unknown as Array<Record<string, unknown>>,
    parsedListQuery.listQuery,
    { searchFields: ["display_name", "id"] },
  );
  if (!projected.ok) return projected.error;
  return NextResponse.json({
    success: true,
    agents: projected.value.items,
    total: projected.value.total,
    nextCursor: projected.value.nextCursor,
  });
}
