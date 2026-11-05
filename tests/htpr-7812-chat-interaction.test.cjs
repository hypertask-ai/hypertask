const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const ts = require("typescript");
const { load } = require("./task-route-loader.cjs");
const { createChatInteraction } = load("src/lib/aiChat/interaction.ts");
const { createSessionStreams } = load("src/lib/aiChat/sessionStreams.ts");

function visible(chat) {
  return [chat.isTyping, chat.isRecording, chat.currentStreamingSession, chat.sendInFlightRef.current];
}

test("send preparation, reply completion and queue release retain their visible timing", () => {
  const chat = createChatInteraction(() => {});
  assert.deepEqual(visible(chat), [false, false, null, false]);
  chat.sendInFlightRef.current = true;
  assert.deepEqual(visible(chat), [false, false, null, true]);
  chat.setIsTyping(true);
  assert.deepEqual(visible(chat), [true, false, null, true]);
  chat.setCurrentStreamingSession("A");
  assert.deepEqual(visible(chat), [true, false, "A", true]);
  chat.setIsTyping(false);
  assert.deepEqual(visible(chat), [false, false, "A", true]);
  chat.setCurrentStreamingSession(null);
  assert.deepEqual(visible(chat), [false, false, null, true]);
  chat.sendInFlightRef.current = false;
  assert.deepEqual(visible(chat), [false, false, null, false]);
});

test("duplicate starts and invalid stream events cannot replace a person's active reply", () => {
  let changes = 0;
  const chat = createChatInteraction(() => changes++);
  chat.setCurrentStreamingSession("orphan");
  chat.setIsTyping(false);
  chat.sendInFlightRef.current = false;
  assert.equal(changes, 0);
  assert.deepEqual(visible(chat), [false, false, null, false]);
  chat.sendInFlightRef.current = true;
  chat.setIsTyping(true);
  chat.setCurrentStreamingSession("A");
  const before = changes;
  chat.sendInFlightRef.current = true;
  chat.setIsTyping(true);
  chat.setCurrentStreamingSession("B");
  assert.equal(changes, before);
  assert.deepEqual(visible(chat), [true, false, "A", true]);
});

test("dictation stays independent of reply preparation, completion and Stop", () => {
  const chat = createChatInteraction(() => {});
  chat.setIsRecording(true);
  chat.sendInFlightRef.current = true;
  chat.setIsTyping((previous) => !previous);
  chat.setCurrentStreamingSession("A");
  assert.deepEqual(visible(chat), [true, true, "A", true]);
  chat.setCurrentStreamingSession(null);
  chat.setIsTyping(false);
  chat.sendInFlightRef.current = false;
  assert.deepEqual(visible(chat), [false, true, null, false]);
  chat.setIsRecording((previous) => !previous);
  assert.deepEqual(visible(chat), [false, false, null, false]);
});

test("failed preparation unlocks another send without losing dictation", () => {
  const chat = createChatInteraction(() => {});
  chat.setIsRecording(true);
  chat.sendInFlightRef.current = true;
  chat.sendInFlightRef.current = false;
  assert.deepEqual(visible(chat), [false, true, null, false]);
  chat.sendInFlightRef.current = true;
  chat.setIsTyping(true);
  assert.deepEqual(visible(chat), [true, true, null, true]);
});

test("stopping one parallel chat leaves the other reply and send lock intact", () => {
  const streams = createSessionStreams(() => {});
  const a = streams.get("A");
  const b = streams.get("B");
  for (const [chat, id] of [[a, "A"], [b, "B"]]) {
    chat.sendInFlightRef.current = true;
    chat.setIsTyping(true);
    chat.setCurrentStreamingSession(id);
  }
  a.setCurrentStreamingSession(null);
  a.setIsTyping(false);
  a.sendInFlightRef.current = false;
  assert.equal(a.isTyping, false);
  assert.equal(a.sendInFlightRef.current, false);
  assert.equal(b.isTyping, true);
  assert.equal(b.sendInFlightRef.current, true);
  assert.equal(b.streamingSessionRef.current, "B");
  assert.equal(streams.get("A"), a);
});

test("TypeScript refuses a streaming reply without a chat identity", () => {
  const fixture = path.resolve("interaction-type-fixture.ts");
  function diagnostics(value) {
    const options = { noEmit: true, strict: true, skipLibCheck: true, types: [], target: ts.ScriptTarget.ES2022, moduleResolution: ts.ModuleResolutionKind.Node10 };
    const host = ts.createCompilerHost(options);
    const getSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (file, version, ...rest) => file === fixture
      ? ts.createSourceFile(file, `import type { ChatInteractionState } from './src/lib/aiChat/interaction'; const state: ChatInteractionState = ${value};`, version)
      : getSourceFile(file, version, ...rest);
    const program = ts.createProgram([fixture], options, host);
    return ts.getPreEmitDiagnostics(program).filter((entry) => entry.file?.fileName === fixture);
  }
  assert.deepEqual(diagnostics('{ phase: "streaming", sessionId: "A", recording: false }'), []);
  const invalid = diagnostics('{ phase: "streaming", recording: false }');
  assert.equal(invalid.length, 1);
  assert.match(ts.flattenDiagnosticMessageText(invalid[0].messageText, "\n"), /sessionId/);
});
