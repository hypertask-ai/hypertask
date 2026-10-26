import type { SetStateAction } from "react";
import type { QueuedAiChatMessage } from "./sessionMessageQueue";

type SessionStream = {
  isTyping: boolean;
  agentStatus: string | undefined;
  sendInFlightRef: { current: boolean };
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
  setIsTyping(value: SetStateAction<boolean>): void;
  setAgentStatus(value: string | undefined): void;
  setCurrentStreamingSession(value: string | null): void;
};

function createSessionStream(onChange: () => void) {
  const state: SessionStream = {
    isTyping: false,
    agentStatus: undefined,
    sendInFlightRef: { current: false },
    settleSendRef: { current: null },
    streamingSessionRef: { current: null },
    streamingAssistantMessageRef: { current: null },
    streamingRequestRef: { current: null },
    draining: false,
    retryAt: 0,
    send: undefined,
    setIsTyping(value: SetStateAction<boolean>) {
      state.isTyping = typeof value === "function" ? value(state.isTyping) : value;
      onChange();
    },
    setAgentStatus(value: string | undefined) {
      state.agentStatus = value;
      onChange();
    },
    setCurrentStreamingSession(value: string | null) {
      state.streamingSessionRef.current = value;
      onChange();
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
