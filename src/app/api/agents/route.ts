import { getAuthSession, withAuth } from "#with-auth";
import { listTeamAgents } from "@/utils/controllers/agents";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import {
  agentTokenCredentialFields,
  createMcpToken,
} from "@/lib/mcp/auth";
import { getAccessibleAgentBoard } from "@/utils/controllers/agents/boardMembers";
import { hasTeamMembershipAccess } from "@/utils/controllers/teams/hasTeamMembershipAccess";
import { isFeatureEnabled, HTPR_6512_SEED_TEAM_AGENT_FLAG } from "@/lib/flags";
import {
  ensureDefaultTeamAgent,
  lockTeamAgentSeed,
} from "@/utils/controllers/agents/ensureDefaultTeamAgent";

async function getCurrentUser(request: NextRequest) {
  const session = await getAuthSession(request.headers);
  return session ? { id: session.userId } : null;
}

async function GETHandler(request: NextRequest) {
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

  if (await isFeatureEnabled(HTPR_6512_SEED_TEAM_AGENT_FLAG, currentUserId)) {
    await ensureDefaultTeamAgent(currentUserId, teamId, prisma);
  }

  const agents = await listTeamAgents(currentUserId, teamId);
  return NextResponse.json({ success: true, agents });
}

/**
 * POST /api/agents — create an agent
 * Body: { displayName: string, photoURL?: string, projectId: number }
 */
async function POSTHandler(request: NextRequest) {
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
  const teamId = project.teamId;
  if (!teamId) {
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
    await lockTeamAgentSeed(tx, currentUserId, teamId);
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

export const GET = withAuth(GETHandler);
export const POST = withAuth(POSTHandler);
