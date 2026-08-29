import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_WEBHOOK_DELIVERY_CONTRACT,
  AGENT_WEBHOOK_EVENT_DEFINITIONS,
  AGENT_WEBHOOK_EVENTS,
  parseAgentWebhookEvents,
} from "./events";

test("agent webhook discovery describes events, signing, and retries", () => {
  assert.deepEqual(Object.keys(AGENT_WEBHOOK_EVENT_DEFINITIONS), [
    "comment.mention",
    "task.assigned",
    "task.unassigned",
    "comment.created",
    "task.updated",
    "task.created",
    "webhook.test",
  ]);
  assert.equal(AGENT_WEBHOOK_EVENT_DEFINITIONS["webhook.test"].subscribable, false);
  assert.equal(
    AGENT_WEBHOOK_DELIVERY_CONTRACT.signing.algorithm,
    "HMAC-SHA256",
  );
  assert.deepEqual(AGENT_WEBHOOK_DELIVERY_CONTRACT.retriesSeconds, [
    0, 30, 300, 1800,
  ]);
});

test("agent webhook defaults to every addressed event", () => {
  assert.deepEqual(parseAgentWebhookEvents(undefined), {
    ok: true,
    events: [...AGENT_WEBHOOK_EVENTS],
  });
});

test("agent webhook event selection is deduplicated", () => {
  assert.deepEqual(
    parseAgentWebhookEvents(["comment.mention", "comment.mention", "task.assigned"]),
    { ok: true, events: ["comment.mention", "task.assigned"] },
  );
});

test("agent webhook rejects empty and unknown event selections", () => {
  assert.equal(parseAgentWebhookEvents([]).ok, false);
  assert.equal(parseAgentWebhookEvents(["comment.created"]).ok, true);
  assert.equal(parseAgentWebhookEvents(["unknown.event"]).ok, false);
  assert.equal(parseAgentWebhookEvents("comment.mention").ok, false);
});

test("agent webhook accepts lifecycle event selections", () => {
  assert.equal(parseAgentWebhookEvents(["comment.created"]).ok, true);
  assert.equal(parseAgentWebhookEvents(["task.updated", "task.created"]).ok, true);
});
