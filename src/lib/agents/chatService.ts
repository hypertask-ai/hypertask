import prisma from "@/lib/prisma";
import { randomUUID } from "node:crypto";
import { HTPR_8048_AGENT_SESSIONS_FLAG } from "@/lib/flags/definitions/htpr-8048-agent-sessions";
import { accessibleAgentWhere } from "@/lib/agents/visibility";
import { getAgentTeamIds } from "@/utils/controllers/agents/boardMembers";
import { isFeatureEnabled, SHARED_AGENT_CHAT_FLAG } from "@/lib/flags";
import { ensureChatParticipant, loadSidebarChatAgent, loadUserAgentChatSession, userTeamIds } from "./chatAccess";

export async function openAgentChat({ userId, agentId, sidebarProjectId, actingAgentId, sessionId, newSession = false }: {
  userId: number;
  agentId: string;
  sidebarProjectId?: number;
  actingAgentId?: string | null;
  sessionId?: string;
  newSession?: boolean;
}) {
  const denied = { ok: false as const, status: 404, error: "Agent not found" };
  if ((sessionId || newSession) && (sidebarProjectId === undefined ||
    !(await isFeatureEnabled(HTPR_8048_AGENT_SESSIONS_FLAG, userId)))) return denied;
  if (sidebarProjectId !== undefined && !(await loadSidebarChatAgent(userId, sidebarProjectId, agentId, actingAgentId))) return denied;
  const agent = await prisma.agent.findFirst({
    where: {
      id: agentId,
      revokedAt: null,
      ...accessibleAgentWhere(userId),
      AND: [{ OR: [{ crossTeamHomeTeamId: null }, { userId }] }],
    },
    select: { id: true, displayName: true, userId: true, crossTeamHomeTeamId: true },
  });
  if (!agent || agent.crossTeamHomeTeamId != null &&
      (agent.userId !== userId || actingAgentId && actingAgentId !== agent.id)) {
    return denied;
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
    (agent.crossTeamHomeTeamId == null && sharedConversationEnabled &&
      teamId !== null &&
      teamIds.includes(teamId));
  if (!mayOpen) {
    return denied;
  }
  if (sessionId) {
    const access = await loadUserAgentChatSession({ sessionId, userId, sidebarProjectId, actingAgentId, select: {} });
    if (!access.ok || access.agentId !== agentId) return denied;
    await ensureChatParticipant(sessionId, userId);
    return { ok: true as const, session: { id: sessionId } };
  }
  if (sidebarProjectId !== undefined) {
    const existing = await prisma.chatSession.findUnique({
      where: { userId_agentId: { userId: agent.userId, agentId: agent.id, agentSessionKey: "default" } },
      select: { id: true },
    });
    if (existing) {
      const access = await loadUserAgentChatSession({ sessionId: existing.id, userId, sidebarProjectId, actingAgentId, select: {} });
      if (!access.ok) return denied;
    }
  }
  const agentSessionKey = newSession ? randomUUID() : "default";
  const session = await prisma.chatSession.upsert({
    where: { userId_agentId: { userId: agent.userId, agentId: agent.id, agentSessionKey } },
    update: {},
    create: {
      userId: agent.userId,
      agentId: agent.id,
      agentSessionKey,
      teamId,
      title: agent.displayName,
    },
    select: { id: true, teamId: true },
  });
  if (sidebarProjectId === undefined && session.teamId === null && teamId !== null) {
    await prisma.chatSession.updateMany({
      where: { id: session.id, teamId: null },
      data: { teamId },
    });
  }

  const access = await loadUserAgentChatSession({
    sessionId: session.id,
    userId,
    sidebarProjectId,
    actingAgentId,
    select: {},
  });
  if (!access.ok) {
    return denied;
  }
  await ensureChatParticipant(session.id, userId);
  return { ok: true as const, session: { id: session.id } };
}
