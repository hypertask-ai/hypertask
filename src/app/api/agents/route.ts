import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { maskAgentProviderKey } from "@/lib/agents/maskAgentProviderKey";
import {
  agentTokenCredentialFields,
  createMcpToken,
} from "@/lib/mcp/auth";
import { getAccessibleAgentBoard } from "@/utils/controllers/agents/boardMembers";
import { getAgentTeamId } from "@/utils/controllers/agents/teamScope";
import { hasTeamMembershipAccess } from "@/utils/controllers/teams/hasTeamMembershipAccess";
import type { AgentScopes } from "@/lib/mcp/agents/scopes";
import { boardAgentVisibilityWhere } from "@/lib/agents/visibility";
import { getSessionUser } from "@/lib/auth/getSessionUser";

async function getCurrentUser(request: NextRequest) {
  const session = await getSessionUser(request.headers);
  return session ? { id: session.userId } : null;
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user?.id) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }
  const currentUserId = user.id;

  const teamId = new URL(request.url).searchParams.get("teamId")?.trim();
  if (!teamId) {
    return NextResponse.json(
      { success: false, error: "teamId is required" },
      { status: 400 },
    );
  }

  if (!(await hasTeamMembershipAccess(currentUserId, teamId))) {
    return NextResponse.json(
      { success: false, error: "Team access denied" },
      { status: 403 },
    );
  }

  const agents = await prisma.agent.findMany({
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
      // Which provider account this agent spends on (HTPR-5389). Only the
      // masked tail ever leaves this route, and only to the agent's owner.
      byokApiKeys: {
        where: { enabled: true },
        orderBy: { provider: "asc" },
        select: { provider: true, ciphertext: true },
      },
      members: {
        orderBy: { id: "asc" },
        select: {
          project: {
            select: { id: true, name: true, teamId: true, title: true },
          },
        },
      },
    },
  });

  const scopedAgents = agents.filter(
    (agent) =>
      getAgentTeamId(
        agent.members.map(({ project: memberProject }) => memberProject.teamId),
      ) === teamId,
  );

  //Attaching the agents with the mcp client they are connected to
  const agentIds = scopedAgents.map((a) => a.id);
  const lastPostedByAgentId = new Map<string, string>();
  const lastOAuthByAgentId = new Map<
    string,
    { clientId: string; clientName: string | null; lastAuthorizedAt: string }
  >();

  if (agentIds.length > 0) {
    const lastPosts = await prisma.comment.groupBy({
      by: ["agentId"],
      where: { agentId: { in: agentIds } },
      _max: { createdAt: true },
    });

    for (const row of lastPosts) {
      if (!row.agentId || !row._max.createdAt) continue;
      lastPostedByAgentId.set(row.agentId, row._max.createdAt.toISOString());
    }

    const usedCodes = await prisma.oAuthAuthorizationCode.findMany({
      where: {
        user_id: currentUserId,
        used: true,
        agent_id: { in: agentIds },
      },
      include: {
        client: { select: { client_id: true, client_name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    for (const row of usedCodes) {
      if (!row.agent_id || lastOAuthByAgentId.has(row.agent_id)) continue;
      lastOAuthByAgentId.set(row.agent_id, {
        clientId: row.client.client_id,
        clientName: row.client.client_name,
        lastAuthorizedAt: row.createdAt.toISOString(),
      });
    }
  }

  const agentsWithOAuth = scopedAgents.map(
    ({ members, permissions, mcpTokenJti, mcpTokenExpiresAt, byokApiKeys, ...a }) => ({
      ...a,
      providerKey:
        a.userId === currentUserId ? maskAgentProviderKey(byokApiKeys) : null,
      postsToImportant:
        (permissions as AgentScopes | null)?.postsToImportant !== false,
      createdAt: a.createdAt.toISOString(),
      revokedAt: a.revokedAt ? a.revokedAt.toISOString() : null,
      hasMcpToken: a.userId === currentUserId ? Boolean(mcpTokenJti) : false,
      mcpTokenExpiresAt:
        a.userId === currentUserId
          ? (mcpTokenExpiresAt?.toISOString() ?? null)
          : null,
      prompt: a.userId === currentUserId ? (a.prompt ?? null) : null,
      heartbeatAt: a.heartbeatAt ? a.heartbeatAt.toISOString() : null,
      lastPostedAt: lastPostedByAgentId.get(a.id) ?? null,
      lastOAuthMcpClient: lastOAuthByAgentId.get(a.id) ?? null,
      // `name` is the slug ("project-15"); `title` is what the board is called
      // everywhere in the UI. Same `title ?? name` fallback the rest of the app uses.
      boards: Array.from(
        new Map(
          members
            .filter(
              ({ project: memberProject }) => memberProject.teamId === teamId,
            )
            .map(({ project: memberProject }) => [
              memberProject.id,
              {
                id: memberProject.id,
                name: memberProject.title ?? memberProject.name,
              },
            ]),
        ).values(),
      ),
    }),
  );

  return NextResponse.json({ success: true, agents: agentsWithOAuth });
}

/**
 * POST /api/agents — create an agent
 * Body: { displayName: string, photoURL?: string, projectId: number }
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser(request);
  if (!user?.id) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 },
    );
  }
  const currentUserId = user.id;

  let body: {
    displayName?: unknown;
    photoURL?: unknown;
    projectId?: unknown;
    runtimeType?: unknown;
    prompt?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }

  const displayName =
    typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (!displayName || displayName.length > 200) {
    return NextResponse.json(
      { success: false, error: "displayName is required (max 200 chars)" },
      { status: 400 },
    );
  }

  const photoURL =
    typeof body.photoURL === "string" && body.photoURL.length > 0
      ? body.photoURL.trim()
      : undefined;

  const runtimeType = body.runtimeType === "NATIVE" ? "NATIVE" : "EXTERNAL";
  let prompt: string | undefined;
  if (runtimeType === "NATIVE" && typeof body.prompt === "string") {
    const p = body.prompt.trim();
    if (p.length > 8000) {
      return NextResponse.json(
        { success: false, error: "Instructions are too long (max 8000 chars)" },
        { status: 400 },
      );
    }
    prompt = p.length > 0 ? p : undefined;
  }

  const projectId = Number(body.projectId);
  if (!Number.isInteger(projectId) || projectId < 1) {
    return NextResponse.json(
      { success: false, error: "projectId is required" },
      { status: 400 },
    );
  }

  const project = await getAccessibleAgentBoard(projectId, currentUserId);
  if (!project) {
    return NextResponse.json(
      { success: false, error: "Board not found" },
      { status: 404 },
    );
  }
  if (!project.teamId) {
    return NextResponse.json(
      { success: false, error: "Agents require a team board" },
      { status: 400 },
    );
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: currentUserId },
    select: { email: true },
  });
  if (!dbUser) {
    return NextResponse.json(
      { success: false, error: "User not found" },
      { status: 404 },
    );
  }

  const agent = await prisma.$transaction(async (tx) => {
    const createdAgent = await tx.agent.create({
      data: {
        displayName,
        userId: currentUserId,
        runtimeType,
        ...(photoURL ? { photoURL } : {}),
        ...(prompt ? { prompt } : {}),
      },
      select: {
        id: true,
        displayName: true,
        visibility: true,
        photoURL: true,
        createdAt: true,
        revokedAt: true,
        runtimeType: true,
        prompt: true,
        modelOptionId: true,
      },
    });

    // Native agents run on the in-app AI loop under the user's own session;
    // they have no external MCP client to authenticate, so no token.
    const mcpToken =
      runtimeType === "NATIVE"
        ? null
        : createMcpToken(currentUserId, dbUser.email, "30d", createdAgent.id);

    await Promise.all([
      mcpToken
        ? tx.agent.update({
            where: { id: createdAgent.id },
            data: {
              ...agentTokenCredentialFields(mcpToken),
              mcpTokenExpiresAt: null,
            },
          })
        : Promise.resolve(),
      tx.member.create({
        data: {
          projectId: project.id,
          userId: currentUserId,
          agentId: createdAgent.id,
        },
      }),
    ]);

    return { ...createdAgent, mcpToken };
  });

  return NextResponse.json(
    {
      success: true,
      agent: {
        ...agent,
        createdAt: agent.createdAt.toISOString(),
        revokedAt: null,
        boards: [
          {
            id: project.id,
            name: project.title ?? project.name,
          },
        ],
      },
    },
    { status: 201 },
  );
}
