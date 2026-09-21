import { createHash, randomUUID } from "node:crypto";

import { getRedis } from "@/lib/redis";

const BOARD_MEMORY_RATE_LIMIT = 10;
const BOARD_MEMORY_RATE_WINDOW_SECONDS = 60;
const BOARD_MEMORY_SIGNAL_DEDUPE_SECONDS = 5 * 60;
// The route is capped at 60 seconds. This small buffer lets a live request
// finish, while a terminated request becomes retryable almost immediately.
const BOARD_MEMORY_SIGNAL_IN_FLIGHT_SECONDS = 65;
const BOARD_MEMORY_SIGNAL_IN_FLIGHT_RETRY_SECONDS = 5;
// The only callers run in a route capped at 60 seconds. A five-minute lease
// cannot expire while that request or one of its storage calls is still live.
const BOARD_MEMORY_LOCK_SECONDS = 5 * 60;
const BOARD_MEMORY_LOCK_RETRY_COUNT = 20;
const BOARD_MEMORY_LOCK_RETRY_DELAY_MS = 100;

const RELEASE_BOARD_MEMORY_LOCK_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0`;
const VERIFY_BOARD_MEMORY_LOCK_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return 1
end
return 0`;
const COMPLETE_BOARD_MEMORY_SIGNAL_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  redis.call('set', KEYS[1], 'complete', 'EX', ARGV[2])
  return 1
end
return 0`;
const RELEASE_BOARD_MEMORY_SIGNAL_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0`;

type BoardMemoryRedis = Awaited<ReturnType<typeof getRedis>>;
type BoardMemoryLockLease = {
  assertCurrent: () => Promise<void>;
};

function boardMemorySignalKey(args: {
  projectId: number;
  signal: unknown;
  userId: number;
}) {
  const signalHash = createHash("sha256")
    .update(JSON.stringify(args.signal))
    .digest("hex");
  return `ai:board-memory:signal:${args.projectId}:${args.userId}:${signalHash}`;
}

function boardMemoryRevisionKey(projectId: number) {
  return `ai:board-memory:revision:${projectId}`;
}

export class BoardMemoryRateLimitError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Board memory learning rate limit exceeded");
    this.name = "BoardMemoryRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class BoardMemoryBusyError extends Error {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds = 1) {
    super("Board memory is busy");
    this.name = "BoardMemoryBusyError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type BoardMemorySignalClaim =
  { status: "claimed"; token: string } | { status: "duplicate" };

export async function claimBoardMemorySignal(
  args: {
    projectId: number;
    signal: unknown;
    userId: number;
  },
  getRedisClient: () => Promise<BoardMemoryRedis> = getRedis,
): Promise<BoardMemorySignalClaim> {
  const redis = await getRedisClient();
  const dedupeKey = boardMemorySignalKey(args);
  const token = `pending:${randomUUID()}`;
  const dedupeClaim = await redis.set(
    dedupeKey,
    token,
    "EX",
    BOARD_MEMORY_SIGNAL_IN_FLIGHT_SECONDS,
    "NX",
  );
  if (dedupeClaim !== "OK") {
    const existingClaim = await redis.get(dedupeKey);
    if (existingClaim === "complete") return { status: "duplicate" };
    throw new BoardMemoryBusyError(BOARD_MEMORY_SIGNAL_IN_FLIGHT_RETRY_SECONDS);
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowStart =
    Math.floor(nowSeconds / BOARD_MEMORY_RATE_WINDOW_SECONDS) *
    BOARD_MEMORY_RATE_WINDOW_SECONDS;
  const rateKey = `ai:board-memory:rate:${args.projectId}:${args.userId}:${windowStart}`;
  try {
    const results = await redis
      .multi()
      .incr(rateKey)
      .expire(rateKey, BOARD_MEMORY_RATE_WINDOW_SECONDS)
      .exec();
    if (results?.[0]?.[0]) throw results[0][0];
    if (results?.[1]?.[0]) throw results[1][0];
    const count = Number(results?.[0]?.[1]);
    const expiryApplied = Number(results?.[1]?.[1]);
    if (expiryApplied !== 1) {
      throw new Error("Board memory rate-limit expiry failed");
    }
    if (!Number.isFinite(count) || count > BOARD_MEMORY_RATE_LIMIT) {
      const retryAfterSeconds = Math.max(
        1,
        windowStart + BOARD_MEMORY_RATE_WINDOW_SECONDS - nowSeconds,
      );
      throw new BoardMemoryRateLimitError(retryAfterSeconds);
    }
  } catch (error) {
    await releaseBoardMemorySignalClaim(args, token, getRedisClient);
    throw error;
  }

  return { status: "claimed", token };
}

export async function completeBoardMemorySignalClaim(
  args: {
    projectId: number;
    signal: unknown;
    userId: number;
  },
  token: string,
  getRedisClient: () => Promise<BoardMemoryRedis> = getRedis,
) {
  try {
    const redis = await getRedisClient();
    await redis.eval(
      COMPLETE_BOARD_MEMORY_SIGNAL_SCRIPT,
      1,
      boardMemorySignalKey(args),
      token,
      BOARD_MEMORY_SIGNAL_DEDUPE_SECONDS,
    );
  } catch (error) {
    console.error("Board memory signal completion failed", error);
  }
}

export async function releaseBoardMemorySignalClaim(
  args: {
    projectId: number;
    signal: unknown;
    userId: number;
  },
  token: string,
  getRedisClient: () => Promise<BoardMemoryRedis> = getRedis,
) {
  try {
    const redis = await getRedisClient();
    await redis.eval(
      RELEASE_BOARD_MEMORY_SIGNAL_SCRIPT,
      1,
      boardMemorySignalKey(args),
      token,
    );
  } catch (error) {
    console.error("Board memory signal claim release failed", error);
  }
}

export async function getBoardMemoryRevision(
  projectId: number,
  getRedisClient: () => Promise<BoardMemoryRedis> = getRedis,
) {
  const redis = await getRedisClient();
  const revision = Number(
    (await redis.get(boardMemoryRevisionKey(projectId))) ?? 0,
  );
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("Invalid board memory revision");
  }
  return revision;
}

export async function bumpBoardMemoryRevision(
  projectId: number,
  getRedisClient: () => Promise<BoardMemoryRedis> = getRedis,
) {
  const redis = await getRedisClient();
  const revision = await redis.incr(boardMemoryRevisionKey(projectId));
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("Invalid board memory revision");
  }
  return revision;
}

export async function withBoardMemoryLock<T>(
  projectId: number,
  handler: (lease: BoardMemoryLockLease) => Promise<T>,
  getRedisClient: () => Promise<BoardMemoryRedis> = getRedis,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<T> {
  const redis = await getRedisClient();
  const key = `ai:board-memory:lock:${projectId}`;
  const token = randomUUID();
  let claimed = false;
  for (let attempt = 0; attempt < BOARD_MEMORY_LOCK_RETRY_COUNT; attempt += 1) {
    const result = await redis.set(
      key,
      token,
      "EX",
      BOARD_MEMORY_LOCK_SECONDS,
      "NX",
    );
    if (result === "OK") {
      claimed = true;
      break;
    }
    if (attempt + 1 < BOARD_MEMORY_LOCK_RETRY_COUNT) {
      await wait(BOARD_MEMORY_LOCK_RETRY_DELAY_MS);
    }
  }
  if (!claimed) throw new BoardMemoryBusyError();

  const lease: BoardMemoryLockLease = {
    assertCurrent: async () => {
      try {
        const current = await redis.eval(
          VERIFY_BOARD_MEMORY_LOCK_SCRIPT,
          1,
          key,
          token,
        );
        if (current !== 1) throw new BoardMemoryBusyError();
      } catch (error) {
        if (error instanceof BoardMemoryBusyError) throw error;
        throw new BoardMemoryBusyError();
      }
    },
  };

  try {
    return await handler(lease);
  } finally {
    try {
      await redis.eval(RELEASE_BOARD_MEMORY_LOCK_SCRIPT, 1, key, token);
    } catch (error) {
      console.error("Board memory lock release failed", error);
    }
  }
}
