import type { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { accessibleAgentWhere } from "@/lib/agents/visibility";

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
 * The authorization rule for a person opening an agent thread: the thread is
 * theirs, it is an agent thread, the agent is still enabled, and the agent is
 * still one this person can see. `accessibleAgentWhere` is the cross-team
 * boundary in this codebase: it resolves to the agent's owner or to a board
 * this person is a member of, so a foreign team and a removed board member
 * both fall out of the query rather than needing a second check.
 */
export function userAgentChatSessionWhere(
  sessionId: string,
  userId: number,
): Prisma.ChatSessionWhereInput {
  return {
    id: sessionId,
    userId,
    agentId: { not: null },
    agent: {
      revokedAt: null,
      ...accessibleAgentWhere(userId),
    },
  };
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
  const session = await findChatSession(
    userAgentChatSessionWhere(sessionId, userId),
    select,
  );
  if (!session?.agentId) return notFound;
  return {
    ok: true,
    session: session as ChatSessionOf<TSelect>,
    agentId: session.agentId,
  };
}

/**
 * Agent thread an agent runtime may read and write. The token's agent id is
 * the only identity that counts here, and a thread belonging to another agent
 * is refused as a mismatch rather than hidden, so a misconfigured runtime gets
 * a diagnosable answer instead of a phantom empty session.
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
