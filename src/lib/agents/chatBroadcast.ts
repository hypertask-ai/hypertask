import { AGENT_CHAT_EVENT, broadcast, userChannel } from "@/lib/realtime/server";
import { chatParticipantUserIds } from "@/lib/agents/chatAccess";

export async function broadcastChatSession(
  sessionId: string,
  alsoUserIds: readonly number[] = [],
): Promise<void> {
  let participantIds: number[] = [];
  try {
    participantIds = await chatParticipantUserIds(sessionId);
  } catch (error) {
    console.warn("[agent-chat] participant fan-out lookup failed", sessionId, error);
  }
  await Promise.all(
    [...new Set([...alsoUserIds, ...participantIds])].map((userId) =>
      broadcast(userChannel(userId), AGENT_CHAT_EVENT, { sessionId }).catch(
        (error) => console.warn("[agent-chat] fan-out failed", sessionId, error),
      ),
    ),
  );
}
