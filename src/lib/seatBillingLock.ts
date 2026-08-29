import { createHash, randomUUID } from "node:crypto";

import { getRedis } from "@/lib/redis";

const LOCK_TTL_MS = 120_000;
const LOCK_RENEW_INTERVAL_MS = 15_000;
const LOCK_ACQUIRE_TIMEOUT_MS = 15_000;
const LOCK_RETRY_INTERVAL_MS = 100;
const LOCK_OPERATION_SAFETY_MS = 30_000;

const RENEW_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0
`;

const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

type RedisClient = Awaited<ReturnType<typeof getRedis>>;

export class SeatBillingLockLostError extends Error {
  constructor() {
    super("Seat-billing lock ownership was lost");
    this.name = "SeatBillingLockLostError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const lockKey = (teamId: string) =>
  `stripe:seat-billing:lock:${createHash("sha256").update(teamId).digest("hex")}`;

/** Serialize one team's Stripe read/compute/write cycle under a renewable lease. */
export async function withTeamSeatBillingLock<T>(
  teamId: string,
  run: (assertHeld: () => void) => Promise<T>,
  redisClient?: RedisClient,
): Promise<T> {
  const redis = redisClient ?? (await getRedis());
  const key = lockKey(teamId);
  const token = randomUUID();
  const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;
  let acquired = false;

  while (!acquired && Date.now() < deadline) {
    acquired = (await redis.set(key, token, "PX", LOCK_TTL_MS, "NX")) === "OK";
    if (!acquired) await sleep(LOCK_RETRY_INTERVAL_MS);
  }
  if (!acquired) {
    throw new Error("Another seat-billing update is still in progress");
  }

  let ownershipLost = false;
  let leaseValidUntil = Date.now() + LOCK_TTL_MS;
  let renewalInFlight: Promise<void> | null = null;
  const renew = () => {
    if (renewalInFlight) return;
    renewalInFlight = (async () => {
      try {
        const renewed = await redis.eval(
          RENEW_SCRIPT,
          1,
          key,
          token,
          String(LOCK_TTL_MS),
        );
        if (Number(renewed) !== 1) ownershipLost = true;
        else leaseValidUntil = Date.now() + LOCK_TTL_MS;
      } catch {
        ownershipLost = true;
      }
    })().finally(() => {
      renewalInFlight = null;
    });
  };
  const timer = setInterval(renew, LOCK_RENEW_INTERVAL_MS);
  timer.unref?.();

  const assertHeld = () => {
    if (
      ownershipLost ||
      Date.now() + LOCK_OPERATION_SAFETY_MS >= leaseValidUntil
    ) {
      throw new SeatBillingLockLostError();
    }
  };

  try {
    assertHeld();
    return await run(assertHeld);
  } finally {
    clearInterval(timer);
    if (renewalInFlight) await renewalInFlight;
    try {
      await redis.eval(RELEASE_SCRIPT, 1, key, token);
    } catch {
      // The token-owned lease expires by itself; never delete an unknown owner's lock.
    }
  }
}
