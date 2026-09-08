import { randomUUID } from "node:crypto";

import { getRedis } from "@/lib/redis";

const LOCK_TTL_MS = 300_000;
const LOCK_ACQUIRE_TIMEOUT_MS = 30_000;
const LOCK_RETRY_INTERVAL_MS = 200;
const LOCK_RENEW_INTERVAL_MS = 60_000;
const RUN_TIMEOUT_MS = 90_000;
const RELEASE_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;
const RENEW_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0
`;

export type CoreSmokeRedisClient = {
  set(
    key: string,
    token: string,
    expiryMode: "PX",
    ttlMilliseconds: number,
    condition: "NX",
  ): Promise<"OK" | null>;
  eval(
    script: string,
    keyCount: number,
    key: string,
    token: string,
    ttlMilliseconds?: number,
  ): Promise<unknown>;
};

export class CoreSmokeLockUnavailableError extends Error {}
export class CoreSmokeRunDeadlineError extends CoreSmokeLockUnavailableError {}
class CoreSmokeLockLostError extends CoreSmokeLockUnavailableError {}

export async function withCoreSmokeLock<T>(
  fixtureKey: string,
  run: (signal: AbortSignal) => Promise<T>,
  options: {
    redis?: CoreSmokeRedisClient;
    now?: () => number;
    sleep?: (milliseconds: number) => Promise<void>;
    acquireTimeoutMs?: number;
    renewIntervalMs?: number;
    runTimeoutMs?: number;
  } = {},
): Promise<T> {
  let redis: CoreSmokeRedisClient;
  try {
    redis = options.redis ?? ((await getRedis()) as CoreSmokeRedisClient);
  } catch {
    throw new CoreSmokeLockUnavailableError(
      "The core-action check could not acquire its fixture lock",
    );
  }
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ??
    ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const deadline =
    now() + (options.acquireTimeoutMs ?? LOCK_ACQUIRE_TIMEOUT_MS);
  const key = `production-smoke:core-actions:${fixtureKey}`;
  const token = randomUUID();
  let acquired = false;

  while (!acquired) {
    try {
      acquired =
        (await redis.set(key, token, "PX", LOCK_TTL_MS, "NX")) === "OK";
    } catch {
      throw new CoreSmokeLockUnavailableError(
        "The core-action check could not acquire its fixture lock",
      );
    }
    const remaining = deadline - now();
    if (!acquired && remaining <= 0) break;
    if (!acquired) await sleep(Math.min(LOCK_RETRY_INTERVAL_MS, remaining));
  }
  if (!acquired) {
    throw new CoreSmokeLockUnavailableError(
      "Another core-action check still owns the fixture",
    );
  }

  const controller = new AbortController();
  let lockLoss: CoreSmokeLockLostError | null = null;
  let timedOut = false;
  const runDeadline = setTimeout(() => {
    timedOut = true;
    controller.abort(
      new CoreSmokeRunDeadlineError(
        "The core-action check exceeded its fixture-safe deadline",
      ),
    );
  }, options.runTimeoutMs ?? RUN_TIMEOUT_MS);
  let stopped = false;
  let renewalTimer: ReturnType<typeof setTimeout> | undefined;
  let renewal: Promise<void> | undefined;

  const loseLock = () => {
    if (lockLoss) return;
    lockLoss = new CoreSmokeLockLostError(
      "The core-action check lost its fixture lock",
    );
    controller.abort(lockLoss);
  };
  const scheduleRenewal = () => {
    renewalTimer = setTimeout(() => {
      renewal = renewLease();
    }, options.renewIntervalMs ?? LOCK_RENEW_INTERVAL_MS);
  };
  const renewLease = async () => {
    try {
      const renewed = await redis.eval(
        RENEW_SCRIPT,
        1,
        key,
        token,
        LOCK_TTL_MS,
      );
      if (Number(renewed) !== 1) loseLock();
    } catch {
      loseLock();
    }
    if (!stopped && !lockLoss) scheduleRenewal();
  };
  scheduleRenewal();

  // ponytail: cleanup stops after its first failed request, so the 90-second
  // probe deadline leaves over three minutes of the lease for restoration.
  let result: T | undefined;
  let runFailed = false;
  let runError: unknown;
  try {
    result = await run(controller.signal);
  } catch (error) {
    runFailed = true;
    runError = error;
  } finally {
    stopped = true;
    if (renewalTimer) clearTimeout(renewalTimer);
    if (renewal) await renewal;
    clearTimeout(runDeadline);
    if (!lockLoss) {
      try {
        const released = await redis.eval(RELEASE_SCRIPT, 1, key, token);
        if (Number(released) !== 1) loseLock();
      } catch {
        loseLock();
      }
    }
  }

  if (lockLoss) throw lockLoss;
  if (timedOut) {
    throw new CoreSmokeRunDeadlineError(
      "The core-action check exceeded its fixture-safe deadline",
    );
  }
  if (runFailed) throw runError;
  return result as T;
}
