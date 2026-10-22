import { withAgentScopeRequest } from "@/lib/auth/agentScope";
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
import { HTPR_7052_CHAT_NAMES_FLAG } from "@/lib/flags/keys";
import { initialChatTitle } from "@/lib/ai/chatNames";
import { taskAccessWhere } from "@/utils/controllers/tasks/assertTaskAccess";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";

export const runtime = "nodejs";

const createSessionSchema = z.object({
  taskId: z.coerce.number().int().positive().optional(),
  agentId: z.string().uuid().optional(),
  projectId: z.coerce.number().int().positive().optional(),
});

export async function POST(request: NextRequest) {
  return withAgentScopeRequest(request, () => createSession(request));
}

async function createSession(request: NextRequest) {
  try {
    const sessionUser = await getSessionUser(request.headers);
    const userId = sessionUser?.userId;
    const actingAgentId = sessionUser?.agentId;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let restCompat = false;
    try {
      restCompat = await isFeatureEnabled(HTPR_6924_REST_COMPAT_FLAG, userId);
    } catch {
    }
    if (restCompat) {
      const limited = await checkRestRateLimit(userId, "write");
      if (limited) return limited;
    }

    let body: Awaited<ReturnType<typeof request.json>>;
    if (restCompat) {
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

      const [agentTeamIds, sharedConversationEnabled] = await Promise.all([
        getAgentTeamIds([agent.id]),
        isFeatureEnabled(SHARED_AGENT_CHAT_FLAG, agent.userId),
      ]);
      const teamId = agentTeamIds.get(agent.id) ?? null;
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
      if (session.teamId === null && teamId !== null) {
        await prisma.chatSession.updateMany({
          where: { id: session.id, teamId: null },
          data: { teamId },
        });
      }

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

    let initialTitle: string | null = null;
    try {
      const chatNames = await isFeatureEnabled(HTPR_7052_CHAT_NAMES_FLAG, userId);
      if (chatNames) {
        const [task, project] = await Promise.all([
          parsed.data.taskId
            ? prisma.task.findFirst({
                where: {
                  AND: [
                    taskAccessWhere(userId, parsed.data.taskId, { agentId: actingAgentId }),
                    { project: getProjectWhere(userId) },
                  ],
                },
                select: { title: true },
              })
            : null,
          parsed.data.projectId
            ? prisma.project.findFirst({ where: { id: parsed.data.projectId, ...getProjectWhere(userId), AND: [getProjectWhere(userId, actingAgentId)] }, select: { name: true, title: true } })
            : null,
        ]);
        initialTitle = initialChatTitle(true, { taskTitle: task?.title, boardName: project?.title || project?.name });
      }
    } catch (error) {
      console.error("[ai-chat/create-session] chat name lookup failed", error);
    }

    const session = await prisma.chatSession.create({
      data: {
        userId: userId,
        taskId: parsed.data.taskId,
        ...(initialTitle ? { title: initialTitle } : {}),
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
