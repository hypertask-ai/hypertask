import { randomUUID } from "node:crypto";

import { getRedis } from "@/lib/redis";

const STREAM_LEASE_TTL_SECONDS = 330;
const COMPLETION_LEASE_TTL_SECONDS = 30;
const STREAM_RATE_WINDOW_SECONDS = 60;
const STREAM_RATE_LIMIT = 12;
const CANCELLATION_RATE_LIMIT = 30;

export const AI_CHAT_TURN_DEADLINE_REASON =
  "AI chat turn exceeded its time budget";
export const AI_CHAT_TURN_DEADLINE_USER_MESSAGE =
  "This reply took too long to generate and was stopped. Try again.";
export const AI_CHAT_TURN_DEADLINE_RESERVE_SECONDS = 15;

export function createTurnDeadline(
  abort: (reason: string) => void,
  budgetSeconds: number,
) {
  const timer = setTimeout(
    () => abort(AI_CHAT_TURN_DEADLINE_REASON),
    Math.max(budgetSeconds, 0) * 1000,
  );
  return {
    clear() {
      clearTimeout(timer);
    },
  };
}

export type StreamRedis = Awaited<ReturnType<typeof getRedis>>;

export type AiChatStreamLease = {
  redis: StreamRedis;
  key: string;
  keys: string[];
  token: string;
};

export type AiChatStreamClaim =
  | AiChatStreamLease
  | "busy"
  | "limited"
  | "unavailable";

type AiChatCancellationIdentity = {
  sessionId: string;
  streamId: string;
};

const rateScript = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return count
`;

const acquireIdentifiedStreamScript = `
local setCount = tonumber(ARGV[4])
for i = 1, tonumber(ARGV[3]) do
  if redis.call("exists", KEYS[i]) == 1 then return 0 end
end
for i = setCount + 1, #KEYS do
  if redis.call("exists", KEYS[i]) == 1 then return 0 end
end
for i = 1, setCount do
  redis.call("set", KEYS[i], ARGV[1], "EX", ARGV[2])
end
return 1
`;

export async function acquireAiChatStreamLease(
  userId: number,
  cancellationIdentity?: AiChatCancellationIdentity,
  redisFactory: () => Promise<StreamRedis> = getRedis,
  agentId?: string,
  isolateAgentLease = false,
  isolateSessionLease = false,
): Promise<AiChatStreamClaim> {
  try {
    const redis = await redisFactory();
    const rateKey = `ai-chat:stream-rate:user:${userId}`;
    const count = Number(
      await redis.eval(
        rateScript,
        1,
        rateKey,
        STREAM_RATE_WINDOW_SECONDS,
      ),
    );
    if (!Number.isFinite(count) || count > STREAM_RATE_LIMIT) return "limited";

    const sessionId = isolateSessionLease ? cancellationIdentity?.sessionId : undefined;
    const key = activeStreamKey(userId, agentId, sessionId);
    const keys = [key];
    if (!sessionId && agentId && !isolateAgentLease) keys.push(activeStreamKey(userId));
    if (!sessionId && cancellationIdentity) {
      keys.push(activeStreamKey(userId, undefined, cancellationIdentity.sessionId));
    }
    const activeKeyCount = keys.length;
    if (cancellationIdentity) {
      keys.push(cancellableStreamKey(
        userId,
        cancellationIdentity.sessionId,
        cancellationIdentity.streamId,
      ));
    }
    const guardKeys = sessionId || (agentId && isolateAgentLease) ? [activeStreamKey(userId)] : [];
    if (sessionId && agentId) guardKeys.push(activeStreamKey(userId, agentId));
    const token = randomUUID();
    if (keys.length + guardKeys.length > 1) {
      const acquired = Number(
        await redis.eval(
          acquireIdentifiedStreamScript,
          keys.length + guardKeys.length,
          ...keys,
          ...guardKeys,
          token,
          STREAM_LEASE_TTL_SECONDS,
          activeKeyCount,
          keys.length,
        ),
      );
      if (acquired !== 1) return "busy";
    } else {
      const acquired = await redis.set(
        key,
        token,
        "EX",
        STREAM_LEASE_TTL_SECONDS,
        "NX",
      );
      if (acquired !== "OK") return "busy";
    }
    return { redis, key, keys, token };
  } catch (error) {
    console.error("[ai/chat/stream] concurrency guard unavailable", error);
    return "unavailable";
  }
}

export async function releaseAiChatStreamLease(lease: AiChatStreamLease) {
  try {
    for (const key of lease.keys) {
      await lease.redis.eval(
        `if redis.call("get", KEYS[1]) == ARGV[1] then
           return redis.call("del", KEYS[1])
         end
         return 0`,
        1,
        key,
        lease.token,
      );
    }
  } catch (error) {
    console.error(
      `[ai/chat/stream] lease ${lease.key} will expire automatically`,
      error,
    );
  }
}

const cancellationKey = (userId: number, sessionId: string, streamId: string) =>
  `ai-chat:cancel:user:${userId}:session:${sessionId}:stream:${streamId}`;

const activeStreamKey = (userId: number, agentId?: string, sessionId?: string) =>
  `ai-chat:stream-active:user:${userId}${sessionId ? `:session:${sessionId}` : agentId ? `:agent:${agentId}` : ""}`;

const cancellableStreamKey = (userId: number, sessionId: string, streamId: string) =>
  `ai-chat:stream-identity:user:${userId}:session:${sessionId}:stream:${streamId}`;

const toolFenceKey = (userId: number, sessionId: string, streamId: string) =>
  `ai-chat:tool-active:user:${userId}:session:${sessionId}:stream:${streamId}`;

const completionKey = (userId: number, sessionId: string, assistantMessageId: string) =>
  `ai-chat:complete:user:${userId}:session:${sessionId}:turn:${assistantMessageId}`;

const cancelTurnScript = `
local active = redis.call("get", KEYS[4])
local registered = redis.call("get", KEYS[5])
local agentActive = redis.call("get", KEYS[6])
local sessionActive = redis.call("get", KEYS[7])
if not registered or (registered ~= active and registered ~= agentActive and registered ~= sessionActive) then return 4 end
local completion = redis.call("get", KEYS[2])
if completion == "complete" then return 0 end
if completion then return 3 end
redis.call("set", KEYS[1], "1", "EX", ARGV[1])
if tonumber(redis.call("get", KEYS[3]) or "0") > 0 then return 2 end
return 1
`;

const acquireCompletionScript = `
if redis.call("get", KEYS[1]) == "1" then return 0 end
local stored = redis.call("set", KEYS[2], ARGV[2], "EX", ARGV[1], "NX")
if stored then return 1 end
return 0
`;

const finishCompletionScript = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  redis.call("set", KEYS[1], "complete", "EX", ARGV[2])
  return 1
end
return 0
`;

const releaseCompletionScript = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
end
return 0
`;

const renewCompletionScript = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("expire", KEYS[1], ARGV[2])
end
return 0
`;

const acquireToolFenceScript = `
if redis.call("get", KEYS[1]) == "1" then return 0 end
local count = redis.call("incr", KEYS[2])
redis.call("expire", KEYS[2], ARGV[1])
return count
`;

export async function requestAiChatCancellation(
  userId: number,
  sessionId: string,
  assistantMessageId: string,
  streamId: string,
  redisFactory: () => Promise<StreamRedis> = getRedis,
  agentId?: string,
) {
  const redis = await redisFactory();
  const cancellationCount = Number(
    await redis.eval(
      rateScript,
      1,
      `ai-chat:cancel-rate:user:${userId}`,
      STREAM_RATE_WINDOW_SECONDS,
    ),
  );
  if (!Number.isFinite(cancellationCount) || cancellationCount > CANCELLATION_RATE_LIMIT) {
    return "limited" as const;
  }
  const activeToolKey = toolFenceKey(userId, sessionId, streamId);
  const completedKey = completionKey(userId, sessionId, assistantMessageId);
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const outcome = Number(
      await redis.eval(
        cancelTurnScript,
        7,
        cancellationKey(userId, sessionId, streamId),
        completedKey,
        activeToolKey,
        activeStreamKey(userId),
        cancellableStreamKey(userId, sessionId, streamId),
        activeStreamKey(userId, agentId),
        activeStreamKey(userId, undefined, sessionId),
        STREAM_LEASE_TTL_SECONDS,
      ),
    );
    if (outcome === 0) return "completed" as const;
    if (outcome === 1) return "cancelling" as const;
    if (outcome === 4) return "unknown" as const;
    if (outcome === 2) {
      const activeTools = Number((await redis.get(activeToolKey)) ?? "0");
      if (!Number.isFinite(activeTools)) {
        throw new Error("Invalid in-flight AI tool state");
      }
      if (activeTools <= 0) return "cancelling" as const;
    } else if (outcome === 3) {
      const completion = await redis.get(completedKey);
      if (completion === "complete") return "completed" as const;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for the active AI operation");
}

export function isAiChatCancellationRequested(
  redis: StreamRedis,
  userId: number,
  sessionId: string,
  streamId: string,
) {
  return redis
    .get(cancellationKey(userId, sessionId, streamId))
    .then((value) => value === "1");
}

export function watchAiChatCancellation(
  redis: StreamRedis,
  userId: number,
  sessionId: string,
  streamId: string,
  onCancel: () => void,
  intervalMs = 250,
) {
  let closed = false;
  let checking = false;
  const check = async () => {
    if (closed || checking) return;
    checking = true;
    try {
      const stopped = await redis.get(
        cancellationKey(userId, sessionId, streamId),
      );
      if (stopped === "1") onCancel();
    } catch (error) {
      console.error("[ai/chat/stream] cancellation check failed", error);
    } finally {
      checking = false;
    }
  };
  void check();
  const timer = setInterval(check, intervalMs);
  return () => {
    closed = true;
    clearInterval(timer);
  };
}

export function assertAiChatToolCanStart(cancelled: boolean, signal: AbortSignal) {
  if (cancelled || signal.aborted) {
    throw new Error("AI reply cancelled before tool execution");
  }
}

export async function acquireAiChatToolFence(
  redis: StreamRedis,
  userId: number,
  sessionId: string,
  streamId: string,
) {
  const activeKey = toolFenceKey(userId, sessionId, streamId);
  const acquired = Number(
    await redis.eval(
      acquireToolFenceScript,
      2,
      cancellationKey(userId, sessionId, streamId),
      activeKey,
      STREAM_LEASE_TTL_SECONDS,
    ),
  );
  if (!Number.isFinite(acquired) || acquired < 1) {
    throw new Error("AI reply cancelled before tool execution");
  }

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await redis.eval(
      `local count = redis.call("decr", KEYS[1])
       if count <= 0 then redis.call("del", KEYS[1]) end
       return count`,
      1,
      activeKey,
    );
  };
}

export async function acquireAiChatCompletionFence(
  redis: StreamRedis,
  userId: number,
  sessionId: string,
  streamId: string,
  assistantMessageId: string,
) {
  const token = randomUUID();
  const acquired = Number(
    await redis.eval(
      acquireCompletionScript,
      2,
      cancellationKey(userId, sessionId, streamId),
      completionKey(userId, sessionId, assistantMessageId),
      COMPLETION_LEASE_TTL_SECONDS,
      token,
    ),
  ) === 1;
  return acquired ? token : null;
}

export async function finishAiChatCompletionFence(
  redis: StreamRedis,
  userId: number,
  sessionId: string,
  assistantMessageId: string,
  token: string,
) {
  return Number(
    await redis.eval(
      finishCompletionScript,
      1,
      completionKey(userId, sessionId, assistantMessageId),
      token,
      STREAM_LEASE_TTL_SECONDS,
    ),
  ) === 1;
}

export async function releaseAiChatCompletionFence(
  redis: StreamRedis,
  userId: number,
  sessionId: string,
  assistantMessageId: string,
  token: string,
) {
  await redis.eval(
    releaseCompletionScript,
    1,
    completionKey(userId, sessionId, assistantMessageId),
    token,
  );
}

export function keepAiChatCompletionFenceAlive(
  redis: StreamRedis,
  userId: number,
  sessionId: string,
  assistantMessageId: string,
  token: string,
  intervalMs = 5_000,
) {
  let closed = false;
  let pending: Promise<void> | null = null;
  const renew = () => {
    if (closed || pending) return;
    pending = redis.eval(
      renewCompletionScript,
      1,
      completionKey(userId, sessionId, assistantMessageId),
      token,
      COMPLETION_LEASE_TTL_SECONDS,
    ).then((renewed) => {
      if (Number(renewed) !== 1) {
        console.error("[ai/chat/stream] completion fence lease was lost");
      }
    }).catch((error) => {
      console.error("[ai/chat/stream] completion fence renewal failed", error);
    }).finally(() => {
      pending = null;
    });
  };
  const timer = setInterval(renew, intervalMs);
  return async () => {
    closed = true;
    clearInterval(timer);
    await pending;
  };
}
