import assert from "node:assert/strict";
import test from "node:test";

import {
  createTurnDeadline,
  AI_CHAT_TURN_DEADLINE_REASON,
  AI_CHAT_TURN_DEADLINE_USER_MESSAGE,
} from "../src/app/api/ai/chat/stream/streamLease";
import {
  extractSseErrorMessage,
} from "../src/lib/aiChat/streamRefusal";

test("the turn deadline aborts with its reason and reports itself", async () => {
  let abortedWith: string | null = null;
  const deadline = createTurnDeadline((reason) => {
    abortedWith = reason;
  }, 0.01);

  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(abortedWith, AI_CHAT_TURN_DEADLINE_REASON);
  assert.equal(deadline.hit, true);
});

test("a cleared deadline never fires", async () => {
  let aborted = false;
  const deadline = createTurnDeadline(() => {
    aborted = true;
  }, 0.01);
  deadline.clear();

  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(aborted, false);
  assert.equal(deadline.hit, false);
});

test("the deadline survives a negative budget instead of throwing", async () => {
  let abortedWith: string | null = null;
  const deadline = createTurnDeadline((reason) => {
    abortedWith = reason;
  }, -10);

  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.equal(abortedWith, AI_CHAT_TURN_DEADLINE_REASON);
  assert.equal(deadline.hit, true);
});

test("the user message is plain, retryable wording", () => {
  assert.ok(AI_CHAT_TURN_DEADLINE_USER_MESSAGE.includes("Try again"));
});

test("the refusal parser reads the server's error frame", () => {
  const body =
    "event: error\n" +
    'data: {"content":"Another AI reply is already in progress."}\n\n' +
    'event: done\ndata: {"status":"error"}\n\n';
  assert.equal(
    extractSseErrorMessage(body),
    "Another AI reply is already in progress.",
  );
});

test("the refusal parser returns null for bodies without an error message", () => {
  assert.equal(extractSseErrorMessage(""), null);
  assert.equal(
    extractSseErrorMessage('event: done\ndata: {"status":"error"}\n\n'),
    null,
  );
  assert.equal(extractSseErrorMessage("event: error\ndata: not-json\n\n"), null);
  assert.equal(extractSseErrorMessage("event: error\ndata: {}\n\n"), null);
  assert.equal(
    extractSseErrorMessage("event: error\ndata: {\"content\":\"   \"}\n\n"),
    null,
  );
});
