import { resolveAgentTeamScope } from "@/lib/auth/agentTeamScope";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { agentTokenCredentialFields, createMcpToken } from "@/lib/mcp/auth";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_8861_AGENT_LOGIN_RECOVERY_FLAG } from "@/lib/flags/definitions/htpr-8861-agent-login-recovery";

export async function POST(request: NextRequest, props: { params: Promise<{ agentId: string }> }) {
  const params = await props.params;
  const session = await getSessionUser(request.headers);
  const userId = session?.userId;
  if (!userId || session?.agentId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const loginRecovery = await isFeatureEnabled(HTPR_8861_AGENT_LOGIN_RECOVERY_FLAG, userId);
  const agent = await prisma.agent.findFirst({
    where: {
      id: params.agentId,
      userId: userId,
      ...(loginRecovery ? {} : { revokedAt: null }),
      runtimeType: "EXTERNAL",
    },
    select: { id: true, runtimeGeneration: true, credentialTeamId: true, credentialTeamAccessBinding: true },
  });

  if (!agent) {
    return NextResponse.json(
      { success: false, error: "Agent not found" },
      { status: 404 }
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  if (!user) {
    return NextResponse.json(
      { success: false, error: "User not found" },
      { status: 404 }
    );
  }

  let teamScope
  try {
    teamScope = await resolveAgentTeamScope(userId, agent)
  } catch {
    return NextResponse.json({ success: false, error: "Agent team grant is no longer valid" }, { status: 403 })
  }
  const token = createMcpToken(userId, user.email, undefined, agent.id, teamScope ?? undefined);

  const updated = await prisma.agent.updateMany({
    where: { id: agent.id, userId, runtimeType: "EXTERNAL", runtimeGeneration: agent.runtimeGeneration },
    data: {
      ...agentTokenCredentialFields(token),
      mcpTokenExpiresAt: null,
      ...(loginRecovery ? { revokedAt: null } : {}),
      runtimeGeneration: { increment: 1 },
    },
  });
  if (updated.count !== 1) {
    return NextResponse.json({ success: false, error: "Agent changed. Try generating the key again." }, { status: 409 });
  }

  return NextResponse.json({ success: true, token }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ agentId: string }> }) {
  const params = await props.params;
  const session = await getSessionUser(request.headers);
  const userId = session?.userId;
  if (!userId || session?.agentId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const agent = await prisma.agent.findFirst({
    where: { id: params.agentId, userId: userId, revokedAt: null },
    select: { id: true },
  });

  if (!agent) {
    return NextResponse.json(
      { success: false, error: "Agent not found" },
      { status: 404 }
    );
  }

  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      ...agentTokenCredentialFields(null),
      mcpTokenExpiresAt: null,
      runtimeGeneration: { increment: 1 },
    },
  });

  return NextResponse.json({ success: true });
}
