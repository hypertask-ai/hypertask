import { createChatInteraction } from "./interaction";
import type { QueuedAiChatMessage } from "./sessionMessageQueue";

type SessionStream = Pick<ReturnType<typeof createChatInteraction>, "isTyping" | "sendInFlightRef" | "setIsTyping" | "setCurrentStreamingSession"> & {
  agentStatus: string | undefined;
  settleSendRef: { current: (() => void) | null };
  streamingSessionRef: { current: string | null };
  streamingAssistantMessageRef: { current: string | null };
  streamingRequestRef: { current: string | null };
  draining: boolean;
  retryAt: number;
  send?: (content: string, options: {
    queuedMessage: QueuedAiChatMessage;
    sessionId: string;
    onQueueBusy: (delay: number) => void;
  }) => Promise<boolean>;
  setAgentStatus(value: string | undefined): void;
};

function createSessionStream(onChange: () => void) {
  const interaction = createChatInteraction(onChange);
  const state: SessionStream = {
    get isTyping() { return interaction.isTyping; },
    agentStatus: undefined,
    sendInFlightRef: interaction.sendInFlightRef,
    settleSendRef: { current: null },
    streamingSessionRef: { current: null },
    streamingAssistantMessageRef: { current: null },
    streamingRequestRef: { current: null },
    draining: false,
    retryAt: 0,
    send: undefined,
    setIsTyping: interaction.setIsTyping,
    setAgentStatus(value: string | undefined) {
      state.agentStatus = value;
      onChange();
    },
    setCurrentStreamingSession(value: string | null) {
      interaction.setCurrentStreamingSession(value);
      state.streamingSessionRef.current = interaction.currentStreamingSession;
    },
  };
  return state;
}

export function createSessionStreams(onChange: () => void) {
  const sessions = new Map<string, ReturnType<typeof createSessionStream>>();
  return {
    get(sessionId: string) {
      let stream = sessions.get(sessionId);
      if (!stream) {
        stream = createSessionStream(onChange);
        sessions.set(sessionId, stream);
      }
      return stream;
    },
    sessionIds: () => [...sessions.keys()],
    remove: (sessionId: string) => sessions.delete(sessionId),
  };
}

export type SessionStreams = ReturnType<typeof createSessionStreams>;
