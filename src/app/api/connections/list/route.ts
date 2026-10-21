import { loadCurrentUser } from "@/lib/auth/currentUser";
import { HTPR_6924_REST_COMPAT_FLAG, isFeatureEnabled } from "@/lib/flags";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidUser } from "@/utils/edgeHelpers";
import prisma from "@/lib/prisma";

export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const userCookie = cookieStore.get("nookies_user");
    const currentUser = await loadCurrentUser(request.headers, true).catch(() => null);
    let restCompat = false;
    if (currentUser) {
      try {
        restCompat = await isFeatureEnabled(HTPR_6924_REST_COMPAT_FLAG, currentUser.userId);
      } catch {
      }
    }
    const { isValid, user } = restCompat && currentUser
      ? { isValid: true, user: currentUser.user }
      : isValidUser(userCookie?.value);

    if (!isValid || !user || !user.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const authorizedCodes = await prisma.oAuthAuthorizationCode.findMany({
      where: {
        user_id: user.id,
        used: true,
      },
      include: {
        client: true,
        agent: { select: { displayName: true } },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const clientMap = new Map<
      string,
      {
        client_id: string;
        client_name: string | null;
        createdAt: Date;
        lastAuthorized: Date;
        enabled: boolean | null;
        is_owner: boolean;
        connected_via_agent: boolean;
        agent_display_name: string | null;
      }
    >();

    for (const authCode of authorizedCodes) {
      const clientId = authCode.client_id;
      const client = authCode.client;
      const existing = clientMap.get(clientId);
      if (!existing || authCode.createdAt > existing.lastAuthorized) {
        clientMap.set(clientId, {
          client_id: clientId,
          client_name: client.client_name,
          createdAt: client.createdAt,
          lastAuthorized: authCode.createdAt,
          enabled: (client as { enabled?: boolean }).enabled ?? true,
          is_owner: client.owner_id === user.id,
          connected_via_agent: Boolean(authCode.agent_id),
          agent_display_name: authCode.agent?.displayName ?? null,
        });
      }
    }

    const connections = Array.from(clientMap.values());

    return NextResponse.json({
      success: true,
      connections,
    });
  } catch (error) {
    console.error("Error listing connections:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
