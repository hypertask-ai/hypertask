import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { accessibleAgentWhere } from "@/lib/agents/visibility";
import { isFeatureEnabled, SHARED_AGENT_CHAT_FLAG } from "@/lib/flags";

// One place that decides who may read or write an Agent Chat thread. Every
// chat route used to carry its own copy of this `findFirst`, so a rule added
// to one (agent revoked, agent no longer shared with this person) silently
// skipped the others. There are two callers of the rule, not two rules: a
// signed-in person, and an agent runtime holding that agent's own token.

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

/**
 * The authorization rule for a person opening an agent thread: it is an agent
 * thread, the agent is still enabled, the agent is still one this person can
 * see, and the conversation's own team is one they belong to.
 *
 * `accessibleAgentWhere` is the cross-team boundary in this codebase: it
 * resolves to the agent's owner or to a board this person is a member of, so a
 * foreign team and a removed board member both fall out of the query. The
 * thread is no longer scoped to one person: everyone the agent is shared with
 * reads the same conversation, which is what makes it shared.
 *
 * `teamIds` is the caller's own team membership, and it is what stops a thread
 * following an agent that later moved teams. A conversation with no team of its
 * own never got past its creator, so it stays theirs.
 */
export function userAgentChatSessionWhere(
  sessionId: string,
  userId: number,
  teamIds: readonly string[],
): Prisma.ChatSessionWhereInput {
  return {
    id: sessionId,
    agentId: { not: null },
    OR: [
      // The row's own person, whatever the thread's team is. Sessions are keyed
      // on the agent's owner, so this is the owner reading their own agent's
      // thread, and an owner who was never added to the board's team would
      // otherwise be locked out of a conversation that used to be theirs alone.
      // It grants nothing new: before this change it was the ONLY branch.
      { userId },
      { teamId: { in: [...teamIds] } },
    ],
    agent: {
      // Spread first: a revoked agent must stay unreachable even if
      // accessibleAgentWhere ever grows a revokedAt key of its own.
      ...accessibleAgentWhere(userId),
      revokedAt: null,
    },
  };
}

/**
 * Teams this person belongs to. No status filter, matching every other team
 * membership check in this codebase (see moveToDifferentBoard): a stricter one
 * here would lock a board member out of a thread they can already see.
 */
export async function userTeamIds(userId: number): Promise<string[]> {
  const rows = await prisma.member_Team.findMany({
    where: { userId },
    select: { teamId: true },
  });
  return rows.map((row) => row.teamId);
}

/**
 * Record that this person has taken part, and hand back their private state.
 * Reading a thread is taking part: it is what gives them an unread marker and a
 * draft slot. `joinedAt` doubles as the unread baseline, so joining a long
 * conversation does not arrive with hundreds of unread messages.
 */
export async function ensureChatParticipant(sessionId: string, userId: number) {
  return prisma.chatSessionParticipant.upsert({
    where: { sessionId_userId: { sessionId, userId } },
    update: {},
    create: { sessionId, userId, lastReadAt: new Date() },
    select: { draft: true, lastReadAt: true, joinedAt: true },
  });
}

/** Every currently authorized recipient for a live chat refresh. */
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
  // Flag-off private chats still need the owner's live reply and unread
  // refreshes. Teammates stay out; only the agent owner is notified.
  if (!sharedConversationEnabled) {
    return [identity.agent.userId];
  }
  const rows = await prisma.chatSessionParticipant.findMany({
    where: { sessionId },
    select: { userId: true },
  });
  // Fail closed per recipient. One stale participant or failed access lookup
  // must not suppress updates for everyone else who still belongs here.
  // ponytail: if a thread grows beyond a small team, replace these per-person
  // checks with one batch authorization query before widening Agent Chat.
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

/**
 * Selected columns plus the two this module always needs. Prisma's generated
 * payload type cannot be composed generically here without collapsing to
 * `never`, so the extra pair is intersected and the query result is cast once,
 * in the two functions below and nowhere else.
 */
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

/** Agent thread a signed-in person may read and write, or the reason not. */
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
  // Evaluate rollout against the conversation owner, not the viewer. One
  // shared resource must never have different rules for two participants.
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

/**
 * Agent thread an agent runtime may read and write. The token's agent id is
 * the only identity that counts here, and a thread belonging to another agent
 * is refused as a mismatch rather than hidden, so a misconfigured runtime gets
 * a diagnosable answer instead of a phantom empty session.
 *
 * There is no agent predicate on this query on purpose: a revoked agent never
 * reaches it, because `validateMcpAuth` fails its token with `agent_revoked`
 * first. Board visibility is not checked either, and must not be: the agent is
 * one side of the conversation, not a person looking in from a shared board.
 * Anything about the agent's own standing belongs in token validation.
 */
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
