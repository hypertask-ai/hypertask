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
    id: sessionId,
    agentId: { not: null },
    OR: [
      { userId },
      { teamId: { in: [...teamIds] } },
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
): Promise<number[]> {
  const identity = await findChatSession(
    { id: sessionId, agentId: { not: null } },
    { agent: { select: { userId: true } } },
  );
  if (!identity?.agentId || !identity.agent) {
    return [];
  }
  const sharedConversationEnabled = await isFeatureEnabled(
    SHARED_AGENT_CHAT_FLAG,
    identity.agent.userId,
  );
  if (!sharedConversationEnabled) {
    return [identity.agent.userId];
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
  return authorized.filter((userId): userId is number => userId !== null);
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

export async function loadUserAgentChatSession<
  TSelect extends Prisma.ChatSessionSelect,
>({
  sessionId,
  userId,
  select,
}: {
  sessionId: string;
  userId: number;
  select: TSelect;
}): Promise<ChatAccessResult<ChatSessionOf<TSelect>>> {
  const identity = await findChatSession(
    { id: sessionId, agentId: { not: null } },
    { agent: { select: { userId: true } } },
  );
  if (!identity?.agentId || !identity.agent) return notFound;
  const sharedConversationEnabled = await isFeatureEnabled(
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
}: {
  sessionId: string;
  agentId: string;
  select: TSelect;
}): Promise<ChatAccessResult<ChatSessionOf<TSelect>>> {
  const session = await findChatSession({ id: sessionId }, select);
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
