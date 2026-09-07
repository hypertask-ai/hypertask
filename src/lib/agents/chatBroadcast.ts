import { AGENT_CHAT_EVENT, broadcast, userChannel } from "@/lib/realtime/server";
import { chatParticipantUserIds } from "@/lib/agents/chatAccess";

/**
 * Tell everyone taking part in a thread that it changed.
 *
 * The thread is shared, so the person whose name is on the session row is not
 * the only one watching it. Broadcasting to that one channel is what made a
 * teammate's pane sit dead while the agent replied in front of them.
 *
 * The participant list is resolved before this resolves, not inside the
 * fire-and-forget chain: a serverless runtime can freeze once its response is
 * flushed, and work that had not started yet simply never happens. Callers
 * await this before returning.
 *
 * `alsoUserIds` covers the person acting right now, who may not have a
 * participant row yet.
 */
export async function broadcastChatSession(
  sessionId: string,
  alsoUserIds: readonly number[] = [],
): Promise<void> {
  // A failed lookup costs a live refresh, never the write that just committed:
  // telling the caller their message failed when it did not is the worse
  // outcome. try/catch rather than `.catch`, so a lookup that throws before it
  // returns a promise is handled the same way as one that rejects.
  let participantIds: number[] = [];
  try {
    participantIds = await chatParticipantUserIds(sessionId);
  } catch (error) {
    console.warn("[agent-chat] participant fan-out lookup failed", sessionId, error);
  }
  // Awaited, not fired and forgotten: the freeze this function exists to
  // survive would drop a send that had been started but not finished. One
  // failed channel must not take the others down with it, so each carries its
  // own catch and this never rejects -- the message is already committed, and
  // a 500 would tell the caller a saved message failed.
  await Promise.all(
    [...new Set([...alsoUserIds, ...participantIds])].map((userId) =>
      broadcast(userChannel(userId), AGENT_CHAT_EVENT, { sessionId }).catch(
        (error) => console.warn("[agent-chat] fan-out failed", sessionId, error),
      ),
    ),
  );
}
