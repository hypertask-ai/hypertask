import { createHash, randomUUID } from 'node:crypto';
import { getRedis } from '@/lib/redis';

const LOCK_TTL_MS = 120_000;
const LOCK_RENEW_INTERVAL_MS = 30_000;
const LOCK_ACQUIRE_TIMEOUT_MS = 5_000;
const LOCK_RETRY_INTERVAL_MS = 100;
const LOCK_OPERATION_SAFETY_MS = 15_000;

export class AttachmentTargetLockLostError extends Error {
  constructor() {
    super('Attachment target lock ownership was lost');
    this.name = 'AttachmentTargetLockLostError';
  }
}

export type AttachmentTargetLock = <T>(
  lockKey: string,
  callback: (assertHeld: () => void) => Promise<T>
) => Promise<T>;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

function redisLockKey(lockKey: string): string {
  const digest = createHash('sha256').update(lockKey).digest('hex');
  return `mcp:attachment-target-lock:${digest}`;
}

/**
 * Serialize one attachment target with a renewable, token-owned Redis lease.
 * The ownership assertion fences persistence and cleanup if renewal is lost.
 */
export const withAttachmentTargetLock: AttachmentTargetLock = async (
  lockKey,
  callback
) => {
  const redis = await getRedis();
  const key = redisLockKey(lockKey);
  const token = randomUUID();
  const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;
  let acquired = false;

  while (!acquired && Date.now() < deadline) {
    acquired =
      (await redis.set(key, token, 'PX', LOCK_TTL_MS, 'NX')) === 'OK';
    if (!acquired) await sleep(LOCK_RETRY_INTERVAL_MS);
  }
  if (!acquired) {
    throw new Error('Another attachment upload is already in progress for this target');
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
          String(LOCK_TTL_MS)
        );
        if (Number(renewed) !== 1) {
          ownershipLost = true;
        } else {
          leaseValidUntil = Date.now() + LOCK_TTL_MS;
        }
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
    if (ownershipLost || Date.now() + LOCK_OPERATION_SAFETY_MS >= leaseValidUntil) {
      throw new AttachmentTargetLockLostError();
    }
  };

  try {
    return await callback(assertHeld);
  } finally {
    clearInterval(timer);
    if (renewalInFlight) await renewalInFlight;
    try {
      await redis.eval(RELEASE_SCRIPT, 1, key, token);
    } catch {
      // The lease expires on its own. Never delete a lock without matching its token.
    }
  }
};
