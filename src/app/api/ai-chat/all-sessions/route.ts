import { HTPR_6924_REST_COMPAT_FLAG, isFeatureEnabled } from "@/lib/flags";
import { checkRestRateLimit } from "@/lib/api/rateLimit";
import prisma from "@/lib/prisma";
import { loadCurrentUser } from "@/lib/auth/currentUser";
import { unauthorized } from "@/lib/api/response";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const currentUser = await loadCurrentUser(request.headers, true);
    if (!currentUser) return unauthorized();
    const { user } = currentUser;

    let restCompat = false;
    try {
      restCompat = await isFeatureEnabled(HTPR_6924_REST_COMPAT_FLAG, currentUser.userId);
    } catch {
      // Flag lookup failure preserves the legacy route.
    }
    if (restCompat) {
      const limited = await checkRestRateLimit(currentUser.userId, "read");
      if (limited) return limited;
    }

    const sessions = await prisma.chatSession.findMany({
      relationLoadStrategy: "join",
      where: {
        userId: user.id,
        // External agents (self-hosted runtimes) are only chatted with from
        // Agent Chat, which sends through /api/agent-chat, not this general
        // AI chat surface. Listing their sessions here lets a user open one
        // and hit the /api/ai/chat/stream guard that rejects the send.
        OR: [{ agentId: null }, { agent: { runtimeType: { not: "EXTERNAL" } } }],
      },
      include: {
        messages: {
          orderBy: {
            createdAt: "asc",
          },
          include: {
            attachments: true,
            // HTPR-6284: agent-attributed replies keep their author on reload.
            authorAgent: { select: { displayName: true } },
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    if (sessions.length === 0) {
      console.warn("No sessions found, creating new session");
      const session = await prisma.chatSession.create({
        data: {
          userId: user.id,
        },
        include: {
          messages: {
            orderBy: {
              createdAt: "asc",
            },
            include: {
              attachments: true,
              authorAgent: { select: { displayName: true } },
            },
          },
        },
      });
      sessions.push(session);
    }

    return NextResponse.json({ success: true, sessions });
  } catch (error) {
    console.error("🚀 ~ GET ~ Error listing chat sessions:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
      },
      { status: 500 }
    );
  }
}
