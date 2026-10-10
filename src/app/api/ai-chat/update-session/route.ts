import { readJsonBody } from "@/lib/mcp/readJsonBody";
import { checkRestRateLimit } from "@/lib/api/rateLimit";
import { loadCurrentUser } from "@/lib/auth/currentUser";
import { canUseAgentChat, HTPR_6924_REST_COMPAT_FLAG, isFeatureEnabled } from "@/lib/flags";
import prisma from "@/lib/prisma";
import { isValidUser } from "@/utils/edgeHelpers";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const userCookie = cookieStore.get("nookies_user");


    const currentUser = await loadCurrentUser(request.headers, true).catch(() => null);
    let restCompat = false;
    if (currentUser) {
      try {
        restCompat = await isFeatureEnabled(HTPR_6924_REST_COMPAT_FLAG, currentUser.userId);
      } catch {
        // Flag lookup failure preserves the legacy entry path.
      }
    }
    const { isValid, user } = restCompat && currentUser
      ? { isValid: true, user: currentUser.user }
      : isValidUser(userCookie?.value);

    if (!isValid || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (restCompat && currentUser) {
      const limited = await checkRestRateLimit(currentUser.userId, "write");
      if (limited) return limited;
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
    const { sessionId, title } = body;

    const existingSession = await prisma.chatSession.findFirst({
      where: {
        id: sessionId,
        userId: user.id,
        ...((await canUseAgentChat(request.headers)) ? {} : { OR: [{ agentId: null }, { agent: { runtimeType: { not: "EXTERNAL" as const } } }] }),
      },
      select: {
        id: true,
      },
    });

    if (!existingSession) {
      return NextResponse.json(
        { success: false, error: "Session not found" },
        { status: 404 }
      );
    }

    const session = await prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        title,
        updatedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true, session }, { status: 200 });
  } catch (error: any) {
    console.error("🚀 ~ POST ~ Error updating chat session", error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to update chat session",
      },
      { status: 500 }
    );
  }
}
