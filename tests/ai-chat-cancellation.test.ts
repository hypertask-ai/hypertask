import assert from "node:assert/strict";
import test from "node:test";

import {
  acquireAiChatStreamLease,
  acquireAiChatToolFence,
  acquireAiChatCompletionFence,
  assertAiChatToolCanStart,
  finishAiChatCompletionFence,
  keepAiChatCompletionFenceAlive,
  releaseAiChatCompletionFence,
  requestAiChatCancellation,
  watchAiChatCancellation,
  type StreamRedis,
} from "../src/app/api/ai/chat/stream/streamLease";

function fakeRedis() {
  const values = new Map<string, string>();
  values.set("ai-chat:stream-active:user:6", "lease-a");
  values.set(
    "ai-chat:stream-identity:user:6:session:session-a:stream:stream-a",
    "lease-a",
  );
  return {
    values,
    redis: {
      async set(key: string, value: string) {
        values.set(key, value);
        return "OK";
      },
      async get(key: string) {
        return values.get(key) ?? null;
      },
      async del(key: string) {
        return values.delete(key) ? 1 : 0;
      },
      async eval(script: string, keyCount: number, ...args: Array<string | number>) {
        const keys = args.slice(0, keyCount).map(String);
        const argv = args.slice(keyCount).map(String);
        if (script.includes('redis.call("INCR", KEYS[1])')) {
          const next = Number(values.get(keys[0]) ?? "0") + 1;
          values.set(keys[0], String(next));
          return next;
        }
        if (script.includes('redis.call("exists", KEYS[1])')) {
          if (values.has(keys[0])) return 0;
          values.set(keys[0], argv[0]);
          values.set(keys[1], argv[0]);
          return 1;
        }
        if (script.includes("local completion = redis.call")) {
          const active = values.get(keys[3]);
          if (!active) return 4;
          const registered = values.get(keys[4]);
          if (!registered || registered !== active) return 4;
          const completion = values.get(keys[1]);
          if (completion === "complete") return 0;
          if (completion) return 3;
          values.set(keys[0], "1");
          if (Number(values.get(keys[2]) ?? "0") > 0) return 2;
          return 1;
        }
        if (script.includes("local stored = redis.call(\"set\", KEYS[2]")) {
          if (values.get(keys[0]) === "1" || values.has(keys[1])) return 0;
          values.set(keys[1], argv[1]);
          return 1;
        }
        if (script.includes("redis.call(\"set\", KEYS[1], \"complete\"")) {
          if (values.get(keys[0]) !== argv[0]) return 0;
          values.set(keys[0], "complete");
          return 1;
        }
        if (script.includes("return redis.call(\"del\", KEYS[1])")) {
          if (values.get(keys[0]) !== argv[0]) return 0;
          return values.delete(keys[0]) ? 1 : 0;
        }
        if (script.includes("return redis.call(\"expire\", KEYS[1]")) {
          return values.get(keys[0]) === argv[0] ? 1 : 0;
        }
        if (script.includes("redis.call(\"incr\", KEYS[2])")) {
          if (values.get(keys[0]) === "1") return 0;
          const next = Number(values.get(keys[1]) ?? "0") + 1;
          values.set(keys[1], String(next));
          return next;
        }
        if (script.includes("redis.call(\"decr\", KEYS[1])")) {
          const next = Number(values.get(keys[0]) ?? "0") - 1;
          if (next <= 0) values.delete(keys[0]);
          else values.set(keys[0], String(next));
          return next;
        }
        throw new Error("Unexpected test script");
      },
    } as unknown as StreamRedis,
  };
}

test("Stop is scoped to the exact user, chat, and stream attempt", async () => {
  const fake = fakeRedis();
  await requestAiChatCancellation(6, "session-a", "assistant-a", "stream-a", async () => fake.redis);
  assert.equal(fake.values.get("ai-chat:cancel:user:6:session:session-a:stream:stream-a"), "1");
  assert.equal(fake.values.get("ai-chat:cancel:user:6:session:session-a:stream:stream-b"), undefined);
});

test("stream acquisition atomically registers the exact cancellable identity", async () => {
  const fake = fakeRedis();
  fake.values.clear();
  const lease = await acquireAiChatStreamLease(
    6,
    { sessionId: "session-a", streamId: "stream-a" },
    async () => fake.redis,
  );
  assert.notEqual(typeof lease, "string");
  if (typeof lease === "string") return;
  assert.equal(
    fake.values.get("ai-chat:stream-identity:user:6:session:session-a:stream:stream-a"),
    lease.token,
  );
  assert.equal(fake.values.get("ai-chat:stream-active:user:6"), lease.token);
});

test("an active stream observes Stop and the watcher can be closed", async () => {
  const fake = fakeRedis();
  let cancellations = 0;
  const close = watchAiChatCancellation(fake.redis, 6, "session-a", "stream-a", () => {
    cancellations += 1;
  }, 5);

  await requestAiChatCancellation(6, "session-a", "assistant-a", "stream-a", async () => fake.redis);
  await new Promise((resolve) => setTimeout(resolve, 20));
  close();
  assert.ok(cancellations >= 1);

  const atClose = cancellations;
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(cancellations, atClose);
});

test("no later tool can begin after Stop is observed", () => {
  const active = new AbortController();
  assert.doesNotThrow(() => assertAiChatToolCanStart(false, active.signal));
  assert.throws(
    () => assertAiChatToolCanStart(true, active.signal),
    /cancelled before tool execution/,
  );
  active.abort();
  assert.throws(() => assertAiChatToolCanStart(false, active.signal));
});

test("the Redis fence atomically orders Stop before tool start", async () => {
  const fake = fakeRedis();
  const release = await acquireAiChatToolFence(
    fake.redis, 6, "session-a", "stream-a",
  );
  assert.equal(fake.values.get("ai-chat:tool-active:user:6:session:session-a:stream:stream-a"), "1");
  await release();

  await requestAiChatCancellation(6, "session-a", "assistant-a", "stream-a", async () => fake.redis);
  await assert.rejects(
    acquireAiChatToolFence(fake.redis, 6, "session-a", "stream-a"),
    /cancelled before tool execution/,
  );
});

test("Stop and final persistence have one atomic winner", async () => {
  const stopped = fakeRedis();
  assert.equal(
    await requestAiChatCancellation(6, "session-a", "assistant-a", "stream-a", async () => stopped.redis),
    "cancelling",
  );
  assert.equal(
    await acquireAiChatCompletionFence(stopped.redis, 6, "session-a", "stream-a", "assistant-a"),
    null,
  );

  const completed = fakeRedis();
  const completionToken = await acquireAiChatCompletionFence(
    completed.redis, 6, "session-a", "stream-a", "assistant-a",
  );
  assert.ok(completionToken);
  assert.equal(
    await finishAiChatCompletionFence(
      completed.redis, 6, "session-a", "assistant-a", completionToken,
    ),
    true,
  );
  assert.equal(
    await requestAiChatCancellation(6, "session-a", "assistant-a", "stream-a", async () => completed.redis),
    "completed",
  );
});

test("a cancelled attempt does not cancel a retry with the same assistant UUID", async () => {
  const fake = fakeRedis();
  await requestAiChatCancellation(
    6, "session-a", "assistant-a", "stream-a", async () => fake.redis,
  );

  const retryFence = await acquireAiChatToolFence(
    fake.redis, 6, "session-a", "stream-b",
  );
  await retryFence();
  assert.ok(
    await acquireAiChatCompletionFence(
      fake.redis, 6, "session-a", "stream-b", "assistant-a",
    ),
  );
});

test("a failed persistence releases its claim for an idempotent retry", async () => {
  const fake = fakeRedis();
  const token = await acquireAiChatCompletionFence(
    fake.redis, 6, "session-a", "stream-a", "assistant-a",
  );
  assert.ok(token);
  await releaseAiChatCompletionFence(
    fake.redis, 6, "session-a", "assistant-a", token,
  );
  assert.ok(
    await acquireAiChatCompletionFence(
      fake.redis, 6, "session-a", "stream-b", "assistant-a",
    ),
  );
});

test("Stop waits for persistence to finalize before reporting completed", async () => {
  const fake = fakeRedis();
  const token = await acquireAiChatCompletionFence(
    fake.redis, 6, "session-a", "stream-a", "assistant-a",
  );
  assert.ok(token);
  let result: string | undefined;
  const stop = requestAiChatCancellation(
    6, "session-a", "assistant-a", "stream-a", async () => fake.redis,
  ).then((value) => {
    result = value;
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(result, undefined);
  await finishAiChatCompletionFence(
    fake.redis, 6, "session-a", "assistant-a", token,
  );
  await stop;
  assert.equal(result, "completed");
});

test("the completion lease renews until persistence reaches a durable outcome", async () => {
  const fake = fakeRedis();
  const token = await acquireAiChatCompletionFence(
    fake.redis, 6, "session-a", "stream-a", "assistant-a",
  );
  assert.ok(token);
  const stopRenewal = keepAiChatCompletionFenceAlive(
    fake.redis, 6, "session-a", "assistant-a", token, 2,
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  await stopRenewal();
  assert.equal(
    await finishAiChatCompletionFence(
      fake.redis, 6, "session-a", "assistant-a", token,
    ),
    true,
  );
});

test("Stop waits for a tool that won the fence before acknowledging", async () => {
  const fake = fakeRedis();
  const release = await acquireAiChatToolFence(
    fake.redis, 6, "session-a", "stream-a",
  );
  let acknowledged: string | undefined;
  const stop = requestAiChatCancellation(
    6, "session-a", "assistant-a", "stream-a", async () => fake.redis,
  ).then((result) => {
    acknowledged = result;
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(acknowledged, undefined);
  await assert.rejects(
    acquireAiChatToolFence(fake.redis, 6, "session-a", "stream-a"),
    /cancelled before tool execution/,
  );
  await release();
  await stop;
  assert.equal(acknowledged, "cancelling");
});

test("unknown and excessive Stop identities cannot allocate cancellation keys", async () => {
  const fake = fakeRedis();
  assert.equal(
    await requestAiChatCancellation(
      6, "session-a", "assistant-a", "unknown-a", async () => fake.redis,
    ),
    "unknown",
  );
  assert.equal(
    fake.values.get("ai-chat:cancel:user:6:session:session-a:stream:unknown-a"),
    undefined,
  );

  for (let index = 1; index < 30; index += 1) {
    await requestAiChatCancellation(
      6, "session-a", "assistant-a", `unknown-${index}`, async () => fake.redis,
    );
  }
  assert.equal(
    await requestAiChatCancellation(
      6, "session-a", "assistant-a", "unknown-over-limit", async () => fake.redis,
    ),
    "limited",
  );
});

test("a registered stream must still own the active user lease", async () => {
  const fake = fakeRedis();
  fake.values.set("ai-chat:stream-active:user:6", "lease-b");
  assert.equal(
    await requestAiChatCancellation(
      6, "session-a", "assistant-a", "stream-a", async () => fake.redis,
    ),
    "unknown",
  );
});
