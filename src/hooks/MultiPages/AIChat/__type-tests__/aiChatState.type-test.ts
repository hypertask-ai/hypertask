/**
 * Type-level tests for AI Chat State Machine
 * These demonstrate that the TypeScript compiler rejects illegal state combinations
 */

type AiChatInteractionState =
  | { kind: 'idle' }
  | { kind: 'recording' }
  | { kind: 'sending' }
  | { kind: 'streaming'; sessionId: string; assistantMessageId: string; requestId: string };

// Legal states compile
const legalIdle: AiChatInteractionState = { kind: 'idle' };
const legalRecording: AiChatInteractionState = { kind: 'recording' };
const legalSending: AiChatInteractionState = { kind: 'sending' };
const legalStreaming: AiChatInteractionState = {
  kind: 'streaming',
  sessionId: 'test',
  assistantMessageId: 'test',
  requestId: 'test',
};

// @ts-expect-error - streaming state requires sessionId, assistantMessageId, and requestId
const illegalStreaming1: AiChatInteractionState = { kind: 'streaming' };

// @ts-expect-error - streaming state requires all three fields
const illegalStreaming2: AiChatInteractionState = { kind: 'streaming', sessionId: 'test' };

// @ts-expect-error - idle state cannot have sessionId
const illegalIdle: AiChatInteractionState = { kind: 'idle', sessionId: 'test' };

// @ts-expect-error - recording state cannot have sessionId
const illegalRecording: AiChatInteractionState = { kind: 'recording', sessionId: 'test' };

// @ts-expect-error - sending state cannot have sessionId
const illegalSending: AiChatInteractionState = { kind: 'sending', sessionId: 'test' };

// Demonstrate that the old scattered booleans allowed illegal combinations
type OldState = {
  isTyping: boolean;
  isRecording: boolean;
  sendInFlight: boolean;
};

const oldIllegalState: OldState = {
  isTyping: true,
  isRecording: true,
  sendInFlight: true,
};

// Type narrowing works correctly
function demonstrateTypeNarrowing(state: AiChatInteractionState) {
  if (state.kind === 'streaming') {
    const sessionId: string = state.sessionId;
    const messageId: string = state.assistantMessageId;
    const requestId: string = state.requestId;
    return { sessionId, messageId, requestId };
  }
  
  if (state.kind === 'idle') {
    // @ts-expect-error - idle state does not have sessionId
    const sessionId: string = state.sessionId;
  }
  
  if (state.kind === 'recording') {
    // @ts-expect-error - recording state does not have sessionId
    const sessionId: string = state.sessionId;
  }
  
  if (state.kind === 'sending') {
    // @ts-expect-error - sending state does not have sessionId
    const sessionId: string = state.sessionId;
  }
}

export {};
