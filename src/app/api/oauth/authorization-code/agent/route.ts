import { readJsonBody } from "@/lib/mcp/readJsonBody";
import { loadCurrentUser } from "@/lib/auth/currentUser";
import { HTPR_6924_REST_COMPAT_FLAG, isFeatureEnabled } from "@/lib/flags";
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
    const currentUser = await loadCurrentUser(request.headers, true).catch(() => null);
    let restCompat = false;
    if (currentUser) {
      try {
        restCompat = await isFeatureEnabled(HTPR_6924_REST_COMPAT_FLAG, currentUser.userId);
      } catch {
        // Flag lookup failure preserves the legacy entry path.
      }
    }
    const user = restCompat && currentUser
      ? currentUser.user
      : await getCurrentUserFromCookies();
    if (!user?.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    let body: Awaited<ReturnType<typeof request.json>>;
    if (restCompat) {
      // Capture once: preserve accepted non-objects and the original parse error/fallback.
      let jsonError: unknown;
      const result = await readJsonBody<typeof body>({
        json: async () => {
          try {
            body = await request.json();
            return body;
          } catch (error) {
            jsonError = error;
            throw error;
          }
        },
      } as Request, {
        invalidJson: () => { throw jsonError },
        invalidObject: () => NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 }),
      });
      if (result.ok) body = result.body;
    } else {
      body = await request.json();
    }
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
