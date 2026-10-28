import { HTPR_8048_AGENT_SESSIONS_FLAG } from "@/lib/flags/definitions/htpr-8048-agent-sessions";
import { readAgentRuntimeSnapshot, filterRuntimeSnapshotToBoards, classifyRuntimeHealth } from "@/lib/agents/runtimeState";
import { HTPR_7688_PAST_CHATS_FIRST_FLAG } from "@/lib/flags/definitions/htpr-7688-past-chats-first";
import { AGENT_STATUS_MAX_AGE_MS } from "@/lib/agentStatus/chip";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getSessionUser } from "@/lib/auth/getSessionUser";
import { loadSidebarChatBoard, loadUserAgentChatSession, userTeamIds } from "@/lib/agents/chatAccess";
import { openAgentChat } from "@/lib/agents/chatService";
import { accessibleAgentWhere } from "@/lib/agents/visibility";
import { agentChatDeliveryMode, hasFreshAgentChatHeartbeat } from "@/lib/agents/chatAvailability";
import { getAgentTeamIds } from "@/utils/controllers/agents/boardMembers";
import { isFeatureEnabled, SHARED_AGENT_CHAT_FLAG } from "@/lib/flags";
import { checkRestRateLimit } from "@/lib/api/rateLimit";
import { browserMutationIsSameOrigin } from "@/lib/agentRuns/service";

export const runtime = "nodejs";
const respond = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "private, no-store" },
});

export async function GET(request: NextRequest) {
  const viewer = await getSessionUser(request.headers);
  if (!viewer || viewer.agentId) return respond({ error: "Unauthorized" }, 401);
  const projectId = Number(request.nextUrl.searchParams.get("projectId"));
  if (!(await loadSidebarChatBoard(viewer.userId, projectId, viewer.agentId))) {
    return respond({ error: "Board not found" }, 404);
  }
  const agentSessions = await isFeatureEnabled(HTPR_8048_AGENT_SESSIONS_FLAG, viewer.userId);
  const agentId = request.nextUrl.searchParams.get("agentId");
  const before = request.nextUrl.searchParams.get("before");
  if ((agentId || before) && (!agentSessions || !agentId)) return respond({ error: "Agent sessions unavailable" }, 404);
  const agents = await prisma.agent.findMany({
    where: {
      revokedAt: null, archivedAt: null,
      ...(agentId ? { id: agentId } : {}),
      ...accessibleAgentWhere(viewer.userId),
      members: { some: { projectId, status: "Accepted" } },
      AND: [{ OR: [{ crossTeamHomeTeamId: null }, { userId: viewer.userId }] }],
    },
    orderBy: [{ displayName: "asc" }, { id: "asc" }],
    select: {
      id: true, userId: true, displayName: true, photoURL: true,
      runtimeType: true, heartbeatAt: true, runtimeGeneration: true,
      agentWebhookSubscription: { select: { active: true, events: true } },
    },
  });
  const [teamIds, agentTeamIds] = await Promise.all([
    userTeamIds(viewer.userId), getAgentTeamIds(agents.map((agent) => agent.id)),
  ]);
  const pastChatsFirst = await isFeatureEnabled(HTPR_7688_PAST_CHATS_FIRST_FLAG, viewer.userId);
  const roster = await Promise.all(agents.map(async (agent) => {
    if (agent.runtimeType === "NATIVE" && agent.userId !== viewer.userId) return null;
    const session = await prisma.chatSession.findUnique({
      where: { userId_agentId: { userId: agent.userId, agentId: agent.id, agentSessionKey: "default" } },
      select: { id: true },
    });
    if (session) {
      const access = await loadUserAgentChatSession({
        sessionId: session.id, userId: viewer.userId, sidebarProjectId: projectId,
        actingAgentId: viewer.agentId, select: {},
      });
      if (!access.ok) return null;
    } else if (agent.userId !== viewer.userId &&
      (!(await isFeatureEnabled(SHARED_AGENT_CHAT_FLAG, agent.userId)) ||
        !teamIds.includes(agentTeamIds.get(agent.id) ?? ""))) return null;
    if (before) {
      const access = await loadUserAgentChatSession({ sessionId: before, userId: viewer.userId,
        sidebarProjectId: projectId, actingAgentId: viewer.agentId, select: {} });
      if (!access.ok || access.agentId !== agent.id) return null;
    }
    const sessions = agentSessions ? await prisma.chatSession.findMany({
      where: { userId: agent.userId, agentId: agent.id,
        OR: [{ userId: viewer.userId }, { teamId: { in: teamIds } }] },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: 51,
      ...(before ? { cursor: { id: before }, skip: 1 } : {}),
      select: { id: true, title: true, updatedAt: true, createdAt: true },
    }) : [];
    let status: string | null = null;
    if (!pastChatsFirst) {
      const snapshot = filterRuntimeSnapshotToBoards(await readAgentRuntimeSnapshot(agent.id, agent.runtimeGeneration), new Set([projectId]));
      status = snapshot ? classifyRuntimeHealth(snapshot)
        : hasFreshAgentChatHeartbeat(agent.heartbeatAt) ? "connected" : "offline";
    }
    return {
      id: agent.id, displayName: agent.displayName, photoURL: agent.photoURL,
      runtimeType: agent.runtimeType, sessionId: session?.id ?? null,
      ...(agentSessions ? { sessions: sessions.slice(0, 50), hasMoreSessions: sessions.length > 50 } : {}),
      status,
      deliveryMode: agentChatDeliveryMode({ heartbeatAt: agent.heartbeatAt, subscription: agent.agentWebhookSubscription }),
    };
  }));
  const authorizedAgents = roster.filter((agent) => agent !== null);
  if (pastChatsFirst && authorizedAgents.length) {
    const runs = await prisma.agentRun.findMany({
      where: {
        agentId: { in: authorizedAgents.map((agent) => agent.id) },
        status: "ACTIVE",
        lastActivityAt: { gte: new Date(Date.now() - AGENT_STATUS_MAX_AGE_MS) },
      },
      select: { agentId: true },
      distinct: ["agentId"],
    });
    const working = new Set(runs.map((run) => run.agentId));
    for (const agent of authorizedAgents) agent.status = working.has(agent.id) ? "working" : null;
  }
  return respond({ success: true, agents: authorizedAgents });
}

export async function POST(request: NextRequest) {
  const viewer = await getSessionUser(request.headers);
  if (!viewer || viewer.agentId) return respond({ error: "Unauthorized" }, 401);
  if (viewer.source !== "cli-bearer" && !browserMutationIsSameOrigin(request)) return respond({ error: "Cross-origin request rejected" }, 403);
  const limited = await checkRestRateLimit(viewer.userId, "write");
  if (limited) return limited;
  const body = await request.json().catch(() => null);
  if (!Number.isSafeInteger(body?.projectId) || body.projectId <= 0 || typeof body?.agentId !== "string") {
    return respond({ error: "projectId and agentId are required" }, 400);
  }
  if ((body.sessionId !== undefined && (typeof body.sessionId !== "string" || !body.sessionId)) ||
    (body.newSession !== undefined && typeof body.newSession !== "boolean") ||
    (body.newSession && body.sessionId)) return respond({ error: "Choose a new or existing session" }, 400);
  const access = await openAgentChat({
    userId: viewer.userId, agentId: body.agentId,
    sidebarProjectId: body.projectId, actingAgentId: viewer.agentId,
    sessionId: body.sessionId, newSession: body.newSession,
  });
  if (!access.ok) return respond({ error: access.error }, access.status);
  return respond({ success: true, session: access.session });
}
