import type { BoardKnowledgePrincipal } from "@/lib/rag/retrieveBoardKnowledge";
import { chatAudienceWhere, chatContentScopeWhere } from "./chatContentScope";
import { getProjectWhere } from "@/utils/controllers/projects/getAllIncludes";
import { HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG } from "@/lib/flags/definitions/htpr-7518-agent-sidebar-chats";
import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { accessibleAgentWhere } from "@/lib/agents/visibility";
import { isFeatureEnabled, SHARED_AGENT_CHAT_FLAG } from "@/lib/flags";


export const AGENT_CHAT_SESSION_NOT_FOUND = "Session not found";
export const AGENT_CHAT_WRONG_AGENT = "This session belongs to a different agent";

export type ChatAccessDenied = {
  ok: false;
  status: number;
  error: string;
};

type ChatAccessGranted<TSession> = {
  ok: true;
  session: TSession;
  agentId: string;
  sharedConversationEnabled?: boolean;
};

export type ChatAccessResult<TSession> =
  | ChatAccessGranted<TSession>
  | ChatAccessDenied;

const notFound: ChatAccessDenied = {
  ok: false,
  status: 404,
  error: AGENT_CHAT_SESSION_NOT_FOUND,
};

export function userAgentChatSessionWhere(
  sessionId: string,
  userId: number,
  teamIds: readonly string[],
): Prisma.ChatSessionWhereInput {
  return {
    ...chatAudienceWhere({ userId }),
    id: sessionId,
    agentId: { not: null },
    OR: [
      { userId },
      { teamId: { in: [...teamIds] } },
      { agent: { crossTeamHomeTeamId: { not: null }, userId } },
    ],
    agent: {
      ...accessibleAgentWhere(userId),
      revokedAt: null,
    },
  };
}

export async function userTeamIds(userId: number): Promise<string[]> {
  const rows = await prisma.member_Team.findMany({
    where: { userId },
    select: { teamId: true },
  });
  return rows.map((row) => row.teamId);
}

export async function ensureChatParticipant(sessionId: string, userId: number) {
  return prisma.chatSessionParticipant.upsert({
    where: { sessionId_userId: { sessionId, userId } },
    update: {},
    create: { sessionId, userId, lastReadAt: new Date() },
    select: { draft: true, lastReadAt: true, joinedAt: true },
  });
}

export async function chatParticipantUserIds(
  sessionId: string,
  alsoUserIds: readonly number[] = [],
): Promise<number[]> {
  const identity = await findChatSession(
    { id: sessionId, agentId: { not: null } },
    { agent: { select: { userId: true, crossTeamHomeTeamId: true } } },
  );
  if (!identity?.agentId || !identity.agent) {
    return [];
  }
  if (identity.agent.crossTeamHomeTeamId != null) return [identity.agent.userId];
  const sharedConversationEnabled = await isFeatureEnabled(
    SHARED_AGENT_CHAT_FLAG,
    identity.agent.userId,
  );
  if (!sharedConversationEnabled) {
    return [...new Set([identity.agent.userId, ...alsoUserIds])];
  }
  const rows = await prisma.chatSessionParticipant.findMany({
    where: { sessionId },
    select: { userId: true },
  });
  const authorized = await Promise.all(
    rows.map(async ({ userId }) => {
      try {
        const session = await findChatSession(
          userAgentChatSessionWhere(
            sessionId,
            userId,
            await userTeamIds(userId),
          ),
          {},
        );
        return session?.agentId ? userId : null;
      } catch {
        return null;
      }
    }),
  );
  return [...new Set([...alsoUserIds, ...authorized.filter((userId): userId is number => userId !== null)])];
}

type ChatSessionOf<TSelect extends Prisma.ChatSessionSelect> =
  Prisma.ChatSessionGetPayload<{ select: TSelect }> & {
    id: string;
    agentId: string;
  };

async function findChatSession<TSelect extends Prisma.ChatSessionSelect>(
  where: Prisma.ChatSessionWhereInput,
  select: TSelect,
) {
  const session = await prisma.chatSession.findFirst({
    where,
    select: { ...select, id: true, agentId: true },
  });
  return session as unknown as
    | (Omit<ChatSessionOf<TSelect>, "agentId"> & { agentId: string | null })
    | null;
}

export const SIDEBAR_CHAT_PROJECT_HEADER = "x-hypertask-sidebar-project";

export function sidebarChatProjectId(headers: Headers): number | undefined {
  const value = headers.get(SIDEBAR_CHAT_PROJECT_HEADER);
  if (value === null) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : 0;
}

export async function loadSidebarChatBoard(
  userId: number,
  projectId: number,
  actingAgentId?: string | null,
) {
  if (actingAgentId || !Number.isSafeInteger(projectId) || projectId <= 0 ||
      !(await isFeatureEnabled(HTPR_7518_AGENT_SIDEBAR_CHATS_FLAG, userId))) return null;
  return prisma.project.findFirst({
    where: {
      ...getProjectWhere(userId, actingAgentId),
      id: projectId,
      status: "Normal",
      AND: [{ OR: [
        { ownerId: userId },
        { members: { some: { userId, agentId: null, status: "Accepted" } } },
      ] }],
    },
    select: { id: true },
  });
}

export async function loadSidebarChatAgent(
  userId: number,
  projectId: number,
  agentId: string,
  actingAgentId?: string | null,
) {
  if (!(await loadSidebarChatBoard(userId, projectId, actingAgentId))) return null;
  return prisma.agent.findFirst({
    where: {
      id: agentId,
      revokedAt: null,
      archivedAt: null,
      ...accessibleAgentWhere(userId),
      members: { some: { projectId, status: "Accepted" } },
      AND: [{ OR: [{ crossTeamHomeTeamId: null }, { userId }] }],
    },
    select: { id: true, userId: true, displayName: true },
  });
}

export async function loadUserAgentChatSession<
  TSelect extends Prisma.ChatSessionSelect,
>({
  sessionId,
  userId,
  select,
  sidebarProjectId,
  actingAgentId,
}: {
  sessionId: string;
  userId: number;
  sidebarProjectId?: number;
  actingAgentId?: string | null;
  select: TSelect;
}): Promise<ChatAccessResult<ChatSessionOf<TSelect>>> {
  const identity = await findChatSession(
    { id: sessionId, agentId: { not: null } },
    { agent: { select: { userId: true, crossTeamHomeTeamId: true } } },
  );
  if (!identity?.agentId || !identity.agent) return notFound;
  if (identity.agent.crossTeamHomeTeamId != null &&
      (identity.agent.userId !== userId || actingAgentId && actingAgentId !== identity.agentId)) return notFound;
  if (sidebarProjectId !== undefined && !(await loadSidebarChatAgent(
    userId, sidebarProjectId, identity.agentId, actingAgentId,
  ))) return notFound;
  const sharedConversationEnabled = identity.agent.crossTeamHomeTeamId == null && await isFeatureEnabled(
    SHARED_AGENT_CHAT_FLAG,
    identity.agent.userId,
  );
  const session = await findChatSession(
    userAgentChatSessionWhere(
      sessionId,
      userId,
      sharedConversationEnabled ? await userTeamIds(userId) : [],
    ),
    select,
  );
  if (!session?.agentId) return notFound;
  return {
    ok: true,
    session: session as ChatSessionOf<TSelect>,
    agentId: session.agentId,
    sharedConversationEnabled,
  };
}

export async function loadAgentTokenChatSession<
  TSelect extends Prisma.ChatSessionSelect,
>({
  sessionId,
  agentId,
  select,
  principal,
}: {
  sessionId: string;
  agentId: string;
  principal?: BoardKnowledgePrincipal;
  select: TSelect;
}): Promise<ChatAccessResult<ChatSessionOf<TSelect>>> {
  const session = await findChatSession({ id: sessionId, ...(principal ? await chatContentScopeWhere(principal) : {}) }, select);
  if (!session?.agentId) return notFound;
  if (session.agentId !== agentId) {
    return { ok: false, status: 403, error: AGENT_CHAT_WRONG_AGENT };
  }
  return {
    ok: true,
    session: session as ChatSessionOf<TSelect>,
    agentId: session.agentId,
  };
}

export async function loadSidebarChatRequest(
  request: { headers: Headers },
  sessionId: string,
  principal?: BoardKnowledgePrincipal,
) {
  const projectId = sidebarChatProjectId(request.headers);
  if (projectId === undefined) {
    const privateSession = await findChatSession(
      { id: sessionId, agent: { crossTeamHomeTeamId: { not: null } } },
      {},
    );
    if (!privateSession) return { ok: true as const };
    const { getSessionUser } = await import("@/lib/auth/getSessionUser");
    const viewer = await getSessionUser(request.headers);
    if (viewer && principal && viewer.userId !== principal.userId) return notFound;
    const actor = viewer ?? principal;
    if (!actor) return notFound;
    const allowed = await findChatSession({
      id: sessionId,
      ...await chatContentScopeWhere({ userId: actor.userId, agentId: actor.agentId, teamScope: actor.teamScope }),
    }, {});
    return allowed ? { ok: true as const } : notFound;
  }
  const { getSessionUser } = await import("@/lib/auth/getSessionUser");
  const viewer = await getSessionUser(request.headers);
  if (!viewer || viewer.agentId) return notFound;
  return loadUserAgentChatSession({ sessionId, userId: viewer.userId,
    actingAgentId: viewer.agentId, sidebarProjectId: projectId, select: {} });
}
