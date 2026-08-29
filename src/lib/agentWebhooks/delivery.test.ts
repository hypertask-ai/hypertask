import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_WEBHOOK_MAX_ATTEMPTS,
  agentWebhookRetryDelaySeconds,
} from "./delivery";

test("agent webhook retries use bounded exponential backoff", () => {
  assert.equal(agentWebhookRetryDelaySeconds(1), 30);
  assert.equal(agentWebhookRetryDelaySeconds(2), 5 * 60);
  assert.equal(agentWebhookRetryDelaySeconds(3), 30 * 60);
  assert.equal(agentWebhookRetryDelaySeconds(AGENT_WEBHOOK_MAX_ATTEMPTS), null);
});
