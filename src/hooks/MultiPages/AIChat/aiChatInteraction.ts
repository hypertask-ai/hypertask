export type AiChatInteractionState =
  | { phase: "idle"; recording: boolean }
  | { phase: "preparing"; recording: boolean }
  | { phase: "typing"; recording: boolean }
  | { phase: "settling"; recording: boolean }
  | {
      phase: "streaming";
      recording: boolean;
      sessionId: string;
      assistantMessageId: string;
      requestId: string;
    };

export type AiChatInteractionEvent =
  | { type: "BEGIN_SEND" }
  | { type: "MARK_TYPING" }
  | { type: "BEGIN_STREAM"; sessionId: string; assistantMessageId: string; requestId: string }
  | { type: "UPDATE_REQUEST"; requestId: string }
  | { type: "END_TYPING" }
  | { type: "CANCEL_STREAM" }
  | { type: "END_SEND" }
  | { type: "START_RECORDING" }
  | { type: "STOP_RECORDING" };

export type AiChatInteractionPorts = {
  sendInFlightRef: { current: boolean };
  streamingSessionRef: { current: string | null };
  streamingAssistantMessageRef: { current: string | null };
  streamingRequestRef: { current: string | null };
  setCurrentStreamingSession: (sessionId: string | null) => void;
};

export function projectAiChatInteraction(state: AiChatInteractionState) {
  return {
    isTyping: state.phase === "typing" || state.phase === "streaming",
    isRecording: state.recording,
    currentStreamingSession: state.phase === "streaming" ? state.sessionId : null,
    sendInFlight: state.phase !== "idle",
  };
}

export function reduceAiChatInteraction(state: AiChatInteractionState, event: AiChatInteractionEvent): AiChatInteractionState {
  switch (event.type) {
    case "START_RECORDING":
      return state.recording ? state : { ...state, recording: true };
    case "STOP_RECORDING":
      return state.recording ? { ...state, recording: false } : state;
    case "BEGIN_SEND":
      return state.phase === "idle" ? { phase: "preparing", recording: state.recording } : state;
    case "MARK_TYPING":
      return state.phase === "preparing" ? { phase: "typing", recording: state.recording } : state;
    case "BEGIN_STREAM":
      if (state.phase !== "preparing" && state.phase !== "typing") return state;
      return {
        phase: "streaming",
        recording: state.recording,
        sessionId: event.sessionId,
        assistantMessageId: event.assistantMessageId,
        requestId: event.requestId,
      };
    case "UPDATE_REQUEST":
      if (state.phase !== "streaming" || state.requestId === event.requestId) return state;
      return { ...state, requestId: event.requestId };
    case "END_TYPING":
    case "CANCEL_STREAM":
      if (state.phase !== "streaming" && state.phase !== "typing") return state;
      return { phase: "settling", recording: state.recording };
    case "END_SEND":
      return state.phase === "idle" ? state : { phase: "idle", recording: state.recording };
    default:
      return state;
  }
}

export function readAiChatInteraction(ports: AiChatInteractionPorts): AiChatInteractionState {
  const sessionId = ports.streamingSessionRef.current;
  const assistantMessageId = ports.streamingAssistantMessageRef.current;
  const requestId = ports.streamingRequestRef.current;
  if (sessionId && assistantMessageId && requestId) {
    return { phase: "streaming", recording: false, sessionId, assistantMessageId, requestId };
  }
  if (ports.sendInFlightRef.current) return { phase: "preparing", recording: false };
  return { phase: "idle", recording: false };
}

export function applyAiChatInteraction(
  state: AiChatInteractionState,
  event: AiChatInteractionEvent,
  ports: AiChatInteractionPorts,
): AiChatInteractionState {
  const next = reduceAiChatInteraction(state, event);
  if (next === state) return state;
  const {
    sendInFlightRef,
    streamingSessionRef,
    streamingAssistantMessageRef,
    streamingRequestRef,
    setCurrentStreamingSession,
  } = ports;
  switch (event.type) {
    case "BEGIN_SEND":
      sendInFlightRef.current = true;
      break;
    case "BEGIN_STREAM": {
      const session = { id: event.sessionId };
      streamingSessionRef.current = session.id;
      streamingAssistantMessageRef.current = event.assistantMessageId;
      streamingRequestRef.current = event.requestId;
      setCurrentStreamingSession(session.id);
      break;
    }
    case "UPDATE_REQUEST":
      streamingRequestRef.current = event.requestId;
      break;
    case "END_TYPING":
    case "CANCEL_STREAM":
      streamingSessionRef.current = null;
      streamingAssistantMessageRef.current = null;
      streamingRequestRef.current = null;
      setCurrentStreamingSession(null);
      break;
    case "END_SEND":
      sendInFlightRef.current = false;
      streamingSessionRef.current = null;
      streamingAssistantMessageRef.current = null;
      streamingRequestRef.current = null;
      setCurrentStreamingSession(null);
      break;
    default:
      break;
  }
  return next;
}
