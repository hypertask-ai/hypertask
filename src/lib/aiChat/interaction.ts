import type { SetStateAction } from "react";

type ReplyState =
  | { phase: "idle" }
  | { phase: "preparing" }
  | { phase: "typing" }
  | { phase: "streaming"; sessionId: string }
  | { phase: "settling"; sessionId: string | null };

export type ChatInteractionState = ReplyState & { recording: boolean };

export type ChatInteractionEvent =
  | { type: "begin-send" }
  | { type: "end-send" }
  | { type: "begin-typing" }
  | { type: "end-typing" }
  | { type: "begin-stream"; sessionId: string }
  | { type: "clear-stream" }
  | { type: "recording"; value: boolean };

export function transitionChatInteraction(state: ChatInteractionState, event: ChatInteractionEvent): ChatInteractionState {
  const { recording } = state;
  switch (event.type) {
    case "begin-send":
      return state.phase === "idle" ? { phase: "preparing", recording } : state;
    case "end-send":
      return state.phase === "idle" ? state : { phase: "idle", recording };
    case "begin-typing":
      return state.phase === "idle" || state.phase === "preparing" ? { phase: "typing", recording } : state;
    case "end-typing":
      if (state.phase === "typing") return { phase: "settling", sessionId: null, recording };
      if (state.phase === "streaming") return { phase: "settling", sessionId: state.sessionId, recording };
      return state;
    case "begin-stream":
      return state.phase === "preparing" || state.phase === "typing"
        ? { phase: "streaming", sessionId: event.sessionId, recording }
        : state;
    case "clear-stream":
      if (state.phase === "streaming") return { phase: "typing", recording };
      if (state.phase === "settling" && state.sessionId !== null) return { ...state, sessionId: null };
      return state;
    case "recording":
      return state.recording === event.value ? state : { ...state, recording: event.value };
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

export function createChatInteraction(onChange: () => void) {
  let state: ChatInteractionState = { phase: "idle", recording: false };
  function dispatch(event: ChatInteractionEvent) {
    const next = transitionChatInteraction(state, event);
    if (next === state) return;
    state = next;
    onChange();
  }
  return {
    get isTyping() { return state.phase === "typing" || state.phase === "streaming"; },
    get isRecording() { return state.recording; },
    get currentStreamingSession() {
      return state.phase === "streaming" || state.phase === "settling" ? state.sessionId : null;
    },
    sendInFlightRef: {
      get current() { return state.phase !== "idle"; },
      set current(value: boolean) { dispatch({ type: value ? "begin-send" : "end-send" }); },
    },
    setIsTyping(value: SetStateAction<boolean>) {
      const previous = state.phase === "typing" || state.phase === "streaming";
      const next = typeof value === "function" ? value(previous) : value;
      dispatch({ type: next ? "begin-typing" : "end-typing" });
    },
    setIsRecording(value: SetStateAction<boolean>) {
      dispatch({ type: "recording", value: typeof value === "function" ? value(state.recording) : value });
    },
    setCurrentStreamingSession(sessionId: string | null) {
      dispatch(sessionId === null ? { type: "clear-stream" } : { type: "begin-stream", sessionId });
    },
  };
}
