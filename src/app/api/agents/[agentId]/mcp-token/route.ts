import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { agentTokenCredentialFields, createMcpToken } from "@/lib/mcp/auth";

async function getCurrentUserFromCookies() {
  try {
    const cookieStore = await cookies();
    const userCookie = cookieStore.get("nookies_user");
    if (!userCookie?.value) return null;
    return JSON.parse(userCookie.value) as { id?: number };
  } catch {
    return null;
  }
}

export async function POST(_request: NextRequest, props: { params: Promise<{ agentId: string }> }) {
  const params = await props.params;
  const currentUser = await getCurrentUserFromCookies();
  if (!currentUser?.id) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const agent = await prisma.agent.findFirst({
    where: {
      id: params.agentId,
      userId: currentUser.id,
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
    where: { id: currentUser.id },
    select: { email: true },
  });

  if (!user) {
    return NextResponse.json(
      { success: false, error: "User not found" },
      { status: 404 }
    );
  }

  const token = createMcpToken(currentUser.id, user.email, undefined, agent.id);

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

export async function DELETE(_request: NextRequest, props: { params: Promise<{ agentId: string }> }) {
  const params = await props.params;
  const currentUser = await getCurrentUserFromCookies();
  if (!currentUser?.id) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const agent = await prisma.agent.findFirst({
    where: { id: params.agentId, userId: currentUser.id, revokedAt: null },
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
