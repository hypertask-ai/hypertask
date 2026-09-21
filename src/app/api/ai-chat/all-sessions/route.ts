import { logger as htLogger } from "#logger";
import { getAuthSession, withAuth } from "#with-auth";
import { chatStore } from "@/utils/controllers/chat";
import { NextRequest, NextResponse } from "next/server";

async function GETHandler(request: NextRequest) {
  try {
    const session = await getAuthSession(request.headers);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const sessions = await chatStore().sessions.findMany({
      where: {
        userId: session.userId,
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
      htLogger.warn("No sessions found, creating new session");
      const createdSession = await chatStore().sessions.create({
        data: {
          userId: session.userId,
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
      sessions.push(createdSession);
    }

    return NextResponse.json({ success: true, sessions });
  } catch (error) {
    htLogger.error("🚀 ~ GET ~ Error listing chat sessions:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
      },
      { status: 500 }
    );
  }
}

export const GET = withAuth(GETHandler);
