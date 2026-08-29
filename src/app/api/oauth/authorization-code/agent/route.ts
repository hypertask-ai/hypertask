import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";

async function getCurrentUserFromCookies() {
  try {
    const cookieStore = await cookies();
    const userCookie = cookieStore.get("nookies_user");
    if (!userCookie?.value) return null;
    return JSON.parse(userCookie.value) as { id?: number };
  } catch (error: any) {
    console.log("🚀 ~ getCurrentUserFromCookies ~ error:", error);
    return null;
  }
}

// For binding or clearing the agent_id on a pending OAuth authorization code (right before token exchange)
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUserFromCookies();
    if (!user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const body = await request.json();
    const code = body?.code as string | undefined;
    const agentId = body?.agentId as string | null | undefined;

    if (!code || typeof code !== "string") {
      return NextResponse.json(
        { success: false, error: "code is required" },
        { status: 400 }
      );
    }

    const authCode = await prisma.oAuthAuthorizationCode.findUnique({
      where: { code },
    });

    if (!authCode) {
      return NextResponse.json(
        { success: false, error: "Authorization code does not exist" },
        { status: 404 }
      );
    }

    if (authCode.used) {
      return NextResponse.json(
        { success: false, error: "Authorization code has already been used" },
        { status: 400 }
      );
    }

    if (authCode.expires_at < new Date()) {
      return NextResponse.json(
        { success: false, error: "Authorization code has expired" },
        { status: 400 }
      );
    }

    if (authCode.user_id !== user.id) {
      return NextResponse.json(
        { success: false, error: "Forbidden" },
        { status: 403 }
      );
    }

    let agentIdToSet: string | null = null;
    if (agentId != null && agentId !== "") {
      const agent = await prisma.agent.findFirst({
        where: {
          id: agentId,
          userId: user.id,
          revokedAt: null,
        },
        select: { id: true },
      });
      if (!agent) {
        return NextResponse.json(
          { success: false, error: "Invalid or revoked agent" },
          { status: 400 }
        );
      }
      agentIdToSet = agent.id;
    }

    await prisma.oAuthAuthorizationCode.update({
      where: { code },
      data: { agent_id: agentIdToSet },
    });

    return NextResponse.json({ success: true, agentId: agentIdToSet });
  } catch (error) {
    console.error("Error binding/clearing agent_id on auth code:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
