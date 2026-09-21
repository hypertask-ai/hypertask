import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isValidUser } from "@/utils/edgeHelpers";
import prisma from "@/lib/prisma";

/**
 * GET /api/connections/list
 * Returns all OAuth clients that have been authorized by the current user
 */
export async function GET(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const userCookie = cookieStore.get("nookies_user");
    const { isValid, user } = isValidUser(userCookie?.value);

    if (!isValid || !user || !user.id) {
      return NextResponse.json(
        { success: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Find all OAuth clients that have been authorized by this user
    // We check for authorization codes that have been used (meaning tokens were issued)
    const authorizedCodes = await prisma.oAuthAuthorizationCode.findMany({
      where: {
        user_id: user.id,
        used: true, // Only show clients that have successfully completed OAuth flow
      },
      include: {
        client: true,
        agent: { select: { displayName: true } },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Group by client_id and get the most recent authorization
    // Now mapping agent connection as well
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
