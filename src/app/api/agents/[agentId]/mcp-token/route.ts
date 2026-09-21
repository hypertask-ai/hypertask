import { getAuthSession, withAuth } from "#with-auth";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { agentTokenCredentialFields, createMcpToken } from "@/lib/mcp/auth";

async function POSTHandler(request: NextRequest, props: { params: Promise<{ agentId: string }> }) {
  const params = await props.params;
  const userId = (await getAuthSession(request.headers))?.userId;
  if (!userId) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const agent = await prisma.agent.findFirst({
    where: {
      id: params.agentId,
      userId: userId,
      revokedAt: null,
      runtimeType: "EXTERNAL",
    },
    select: { id: true },
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

  const token = createMcpToken(userId, user.email, undefined, agent.id);

  await prisma.agent.update({
    where: { id: agent.id },
    data: {
      ...agentTokenCredentialFields(token),
      mcpTokenExpiresAt: null,
      runtimeGeneration: { increment: 1 },
    },
  });

  return NextResponse.json({ success: true, token });
}

async function DELETEHandler(request: NextRequest, props: { params: Promise<{ agentId: string }> }) {
  const params = await props.params;
  const userId = (await getAuthSession(request.headers))?.userId;
  if (!userId) {
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

export const POST = withAuth(POSTHandler, { authenticateInHandler: true });
export const DELETE = withAuth(DELETEHandler, { authenticateInHandler: true });
