import { readJsonBody } from "@/lib/mcp/readJsonBody";
import { checkRestRateLimit } from "@/lib/api/rateLimit";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { accessibleAgentWhere } from "@/lib/agents/visibility";
import { getAgentTeamIds } from "@/utils/controllers/agents/boardMembers";
import {
  ensureChatParticipant,
  loadUserAgentChatSession,
  userTeamIds,
} from "@/lib/agents/chatAccess";
import { isFeatureEnabled, SHARED_AGENT_CHAT_FLAG, HTPR_6924_REST_COMPAT_FLAG } from "@/lib/flags";
import { HTPR_7052_AI_CHAT_NAMES_FLAG } from "@/lib/flags/keys";
import { titleForEmptySession } from "@/lib/ai/chatSessionNaming";
import { userCanAccessTaskContent } from "@/utils/controllers/tasks/assertTaskAccess";

export const runtime = "nodejs";

const createSessionSchema = z.object({
  taskId: z.coerce.number().int().positive().optional(),
  agentId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const userId = (await getSessionUser(request.headers))?.userId;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let restCompat = false;
    try {
      restCompat = await isFeatureEnabled(HTPR_6924_REST_COMPAT_FLAG, userId);
    } catch {
      // Flag lookup failure preserves the legacy route.
    }
    if (restCompat) {
      const limited = await checkRestRateLimit(userId, "write");
      if (limited) return limited;
    }

    let body: Awaited<ReturnType<typeof request.json>>;
    if (restCompat) {
      // Capture once: preserve accepted non-objects and the original parse error/fallback.
      let jsonError: unknown;
      const result = await readJsonBody<typeof body>({
        json: async () => {
          try {
            body = await request.json().catch(() => ({}));
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
      body = await request.json().catch(() => ({}));
    }
    const parsed = createSessionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid task ID" },
        { status: 400 }
      );
    }

    if (parsed.data.agentId) {
      const agent = await prisma.agent.findFirst({
        where: {
          id: parsed.data.agentId,
          revokedAt: null,
          ...accessibleAgentWhere(userId),
        },
        select: { id: true, displayName: true, userId: true },
      });
      if (!agent) {
        return NextResponse.json(
          { error: "Agent not found" },
          { status: 404 }
        );
      }

      // One ongoing conversation per agent, shared by everyone that agent is
      // shared with, rather than a private copy each. The row is keyed on the
      // agent's OWNER, not on whoever is opening it, so every authorized caller
      // resolves to the same thread -- and to the same one the native heartbeat
      // already writes to (src/app/api/cron/native-agent-heartbeat/route.ts),
      // which keyed on the owner while this route keyed on the caller. The
      // existing `(userId, agentId)` unique still backs the upsert, so two
      // concurrent "open this agent's chat" requests converge on one row
      // instead of forking two.
      const [agentTeamIds, sharedConversationEnabled] = await Promise.all([
        getAgentTeamIds([agent.id]),
        isFeatureEnabled(SHARED_AGENT_CHAT_FLAG, agent.userId),
      ]);
      const teamId = agentTeamIds.get(agent.id) ?? null;
      // The same question the shared rule asks below, asked before anything is
      // written: a conversation with no team of its own belongs to whoever
      // opened it, and one with a team belongs to that team's members. Seeing
      // the agent across a shared board is not the same as being in its team.
      // Refused here, or this writes a session row and then 404s the caller who
      // asked for it.
      const teamIds =
        sharedConversationEnabled && agent.userId !== userId
          ? await userTeamIds(userId)
          : [];
      const mayOpen =
        agent.userId === userId ||
        (sharedConversationEnabled &&
          teamId !== null &&
          teamIds.includes(teamId));
      if (!mayOpen) {
        return NextResponse.json({ error: "Agent not found" }, { status: 404 });
      }
      const session = await prisma.chatSession.upsert({
        where: { userId_agentId: { userId: agent.userId, agentId: agent.id } },
        update: {},
        create: {
          userId: agent.userId,
          agentId: agent.id,
          teamId,
          title: agent.displayName,
        },
        select: { id: true, teamId: true },
      });
      // Written once, the first time the agent has a team to record. Never
      // rewritten: the stored team is the conversation's scope, and letting it
      // follow the agent would hand an old team's transcript to a new one.
      if (session.teamId === null && teamId !== null) {
        await prisma.chatSession.updateMany({
          where: { id: session.id, teamId: null },
          data: { teamId },
        });
      }

      // Re-read through the one shared rule rather than trusting the upsert:
      // an agent that has since moved teams keeps a thread this caller must
      // not open, and that judgement lives in exactly one place.
      const access = await loadUserAgentChatSession({
        sessionId: session.id,
        userId,
        select: {},
      });
      if (!access.ok) {
        return NextResponse.json({ error: "Agent not found" }, { status: 404 });
      }
      await ensureChatParticipant(session.id, userId);
      return NextResponse.json(
        { success: true, session: { id: session.id } },
        { status: 200 }
      );
    }

    // HTPR-7052: a chat opened on a ticket (Ctrl+J) starts named after it.
    let title: string | undefined;
    if (parsed.data.taskId) {
      try {
        if (
          (await isFeatureEnabled(HTPR_7052_AI_CHAT_NAMES_FLAG, userId)) &&
          (await userCanAccessTaskContent(userId, parsed.data.taskId))
        ) {
          title = await titleForEmptySession(prisma, { taskId: parsed.data.taskId });
        }
      } catch {
        // Naming is best effort; the chat keeps the default title.
      }
    }

    const session = await prisma.chatSession.create({
      data: {
        userId: userId,
        taskId: parsed.data.taskId,
        ...(title ? { title } : {}),
      },
      include: {
        messages: {
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    });

    return NextResponse.json({ success: true, session }, { status: 200 });
  } catch (error: any) {
    console.error("🚀 ~ POST ~ Error creating chat session", error);

    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to create chat session",
      },
      { status: 500 }
    );
  }
}
