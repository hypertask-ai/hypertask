const test = require('node:test');
const assert = require('node:assert/strict');

function aiChatStateReducer(state, action) {
  switch (action.type) {
    case 'START_RECORDING':
      if (state.kind === 'idle') return { kind: 'recording' };
      return state;
    case 'STOP_RECORDING':
      if (state.kind === 'recording') return { kind: 'idle' };
      return state;
    case 'START_SENDING':
      if (state.kind === 'idle') return { kind: 'sending' };
      return state;
    case 'START_STREAMING':
      if (state.kind === 'sending' || state.kind === 'idle') {
        return {
          kind: 'streaming',
          sessionId: action.sessionId,
          assistantMessageId: action.assistantMessageId,
          requestId: action.requestId,
        };
      }
      return state;
    case 'CANCEL_STREAM':
    case 'COMPLETE_STREAM':
      if (state.kind === 'streaming') return { kind: 'idle' };
      return state;
    default:
      return state;
  }
}

test('State machine enforces valid transitions', () => {
  let state = { kind: 'idle' };
  
  state = aiChatStateReducer(state, { type: 'START_RECORDING' });
  assert.equal(state.kind, 'recording');
  
  state = aiChatStateReducer(state, { type: 'STOP_RECORDING' });
  assert.equal(state.kind, 'idle');
  
  state = aiChatStateReducer(state, { type: 'START_SENDING' });
  assert.equal(state.kind, 'sending');
  
  state = aiChatStateReducer(state, {
    type: 'START_STREAMING',
    sessionId: 'test-session',
    assistantMessageId: 'test-message',
    requestId: 'test-request',
  });
  assert.equal(state.kind, 'streaming');
  assert.equal(state.sessionId, 'test-session');
  assert.equal(state.assistantMessageId, 'test-message');
  assert.equal(state.requestId, 'test-request');
  
  state = aiChatStateReducer(state, { type: 'COMPLETE_STREAM' });
  assert.equal(state.kind, 'idle');
});

test('State machine rejects invalid transitions', () => {
  let state = { kind: 'idle' };
  
  state = aiChatStateReducer(state, { type: 'START_RECORDING' });
  assert.equal(state.kind, 'recording');
  
  const beforeInvalid = state;
  state = aiChatStateReducer(state, { type: 'START_SENDING' });
  assert.equal(state.kind, 'recording', 'Cannot start sending while recording');
  assert.strictEqual(state, beforeInvalid, 'State should be unchanged');
});

test('State machine handles cancel stream', () => {
  let state = { kind: 'idle' };
  
  state = aiChatStateReducer(state, { type: 'START_SENDING' });
  state = aiChatStateReducer(state, {
    type: 'START_STREAMING',
    sessionId: 'test-session',
    assistantMessageId: 'test-message',
    requestId: 'test-request',
  });
  assert.equal(state.kind, 'streaming');
  
  state = aiChatStateReducer(state, { type: 'CANCEL_STREAM' });
  assert.equal(state.kind, 'idle');
});

test('Streaming from idle is allowed', () => {
  let state = { kind: 'idle' };
  
  state = aiChatStateReducer(state, {
    type: 'START_STREAMING',
    sessionId: 'test-session',
    assistantMessageId: 'test-message',
    requestId: 'test-request',
  });
  assert.equal(state.kind, 'streaming');
});

test('Cannot record while streaming', () => {
  let state = { kind: 'idle' };
  
  state = aiChatStateReducer(state, {
    type: 'START_STREAMING',
    sessionId: 'test-session',
    assistantMessageId: 'test-message',
    requestId: 'test-request',
  });
  assert.equal(state.kind, 'streaming');
  
  const beforeInvalid = state;
  state = aiChatStateReducer(state, { type: 'START_RECORDING' });
  assert.equal(state.kind, 'streaming', 'Cannot record while streaming');
  assert.strictEqual(state, beforeInvalid, 'State should be unchanged');
});
