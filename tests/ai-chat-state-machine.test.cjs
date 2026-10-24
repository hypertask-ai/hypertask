const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const { applyAiChatInteraction, projectAiChatInteraction } = load(
  "src/hooks/MultiPages/AIChat/aiChatInteraction.ts",
  {},
);

function ports() {
  const seen = [];
  return {
    seen,
    sendInFlightRef: { current: false },
    streamingSessionRef: { current: null },
    streamingAssistantMessageRef: { current: null },
    streamingRequestRef: { current: null },
    setCurrentStreamingSession(sessionId) { seen.push(sessionId); },
  };
}

const idle = { phase: "idle", recording: false };

test("a reply cannot start until a send is in flight, and a second send does not replace it", () => {
  const io = ports();
  const blocked = applyAiChatInteraction(idle, {
    type: "BEGIN_STREAM",
    sessionId: "chat",
    assistantMessageId: "reply",
    requestId: "request",
  }, io);
  assert.equal(projectAiChatInteraction(blocked).isTyping, false);
  assert.equal(projectAiChatInteraction(blocked).currentStreamingSession, null);
  assert.equal(io.streamingSessionRef.current, null);
  assert.equal(io.sendInFlightRef.current, false);
  assert.deepEqual(io.seen, []);

  let state = applyAiChatInteraction(idle, { type: "BEGIN_SEND" }, io);
  assert.equal(io.sendInFlightRef.current, true);
  assert.equal(projectAiChatInteraction(state).isTyping, false);
  state = applyAiChatInteraction(state, { type: "MARK_TYPING" }, io);
  state = applyAiChatInteraction(state, {
    type: "BEGIN_STREAM",
    sessionId: "chat",
    assistantMessageId: "reply",
    requestId: "request",
  }, io);
  const again = applyAiChatInteraction(state, { type: "BEGIN_SEND" }, io);
  assert.equal(projectAiChatInteraction(again).currentStreamingSession, "chat");
  assert.equal(io.streamingSessionRef.current, "chat");
  assert.equal(io.streamingAssistantMessageRef.current, "reply");
  assert.equal(io.streamingRequestRef.current, "request");
  assert.equal(io.sendInFlightRef.current, true);
  assert.deepEqual(io.seen, ["chat"]);
});

test("dictation stays available while a reply streams, and the queue waits until the send finishes", () => {
  const io = ports();
  let state = applyAiChatInteraction(idle, { type: "BEGIN_SEND" }, io);
  state = applyAiChatInteraction(state, { type: "MARK_TYPING" }, io);
  state = applyAiChatInteraction(state, {
    type: "BEGIN_STREAM",
    sessionId: "chat",
    assistantMessageId: "reply",
    requestId: "request",
  }, io);
  state = applyAiChatInteraction(state, { type: "START_RECORDING" }, io);
  assert.equal(projectAiChatInteraction(state).isRecording, true);
  assert.equal(projectAiChatInteraction(state).isTyping, true);
  assert.equal(projectAiChatInteraction(state).currentStreamingSession, "chat");

  state = applyAiChatInteraction(state, { type: "END_TYPING" }, io);
  assert.equal(projectAiChatInteraction(state).isTyping, false);
  assert.equal(projectAiChatInteraction(state).currentStreamingSession, null);
  assert.equal(io.streamingSessionRef.current, null);
  assert.equal(io.sendInFlightRef.current, true, "a queued follow-up must wait until the send releases");
  assert.equal(projectAiChatInteraction(state).isRecording, true);

  state = applyAiChatInteraction(state, { type: "END_SEND" }, io);
  assert.equal(io.sendInFlightRef.current, false);
  assert.equal(projectAiChatInteraction(state).isRecording, true);
  assert.equal(projectAiChatInteraction(state).isTyping, false);
});

test("stopping a reply clears it and still holds the send until that send ends", () => {
  const io = ports();
  let state = applyAiChatInteraction(idle, { type: "BEGIN_SEND" }, io);
  state = applyAiChatInteraction(state, {
    type: "BEGIN_STREAM",
    sessionId: "chat",
    assistantMessageId: "reply",
    requestId: "request",
  }, io);
  state = applyAiChatInteraction(state, { type: "CANCEL_STREAM" }, io);
  assert.equal(projectAiChatInteraction(state).isTyping, false);
  assert.equal(projectAiChatInteraction(state).currentStreamingSession, null);
  assert.equal(io.sendInFlightRef.current, true);
  assert.deepEqual(io.seen, ["chat", null]);
  applyAiChatInteraction(state, { type: "CANCEL_STREAM" }, io);
  assert.equal(io.sendInFlightRef.current, true);
  state = applyAiChatInteraction(state, { type: "END_SEND" }, io);
  assert.equal(io.sendInFlightRef.current, false);
});

test("a retried request id replaces only the active reply's request", () => {
  const io = ports();
  let state = applyAiChatInteraction(idle, { type: "BEGIN_SEND" }, io);
  state = applyAiChatInteraction(state, {
    type: "BEGIN_STREAM",
    sessionId: "chat",
    assistantMessageId: "reply",
    requestId: "request-1",
  }, io);
  applyAiChatInteraction(idle, { type: "UPDATE_REQUEST", requestId: "request-2" }, io);
  assert.equal(io.streamingRequestRef.current, "request-1");
  state = applyAiChatInteraction(state, { type: "UPDATE_REQUEST", requestId: "request-2" }, io);
  assert.equal(io.streamingRequestRef.current, "request-2");
  assert.equal(io.streamingSessionRef.current, "chat");
  assert.equal(projectAiChatInteraction(state).currentStreamingSession, "chat");
});
