import { createHash, randomUUID } from "node:crypto";

import { getRedis } from "@/lib/redis";

const LOCK_TTL_MS = 120_000;
const LOCK_RENEW_INTERVAL_MS = 15_000;
const LOCK_ACQUIRE_TIMEOUT_MS = 15_000;
const LOCK_RETRY_INTERVAL_MS = 100;
const LOCK_OPERATION_SAFETY_MS = 30_000;
const PENDING_WRITE_TTL_MS = 86_400_000;

const RENEW_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('pexpire', KEYS[1], ARGV[2])
end
return 0
`;

const RELEASE_SCRIPT = `
local stored = redis.call('get', KEYS[1])
if not stored then return 1 end
if stored == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

type RedisClient = Awaited<ReturnType<typeof getRedis>>;

export type SeatBillingProration = "none" | "always_invoice" | "create_prorations";

export type PendingSeatBillingWrite = {
  idempotencyKey: string;
  itemId: string;
  subscriptionId?: string;
  quantity: number;
  prorationBehavior: SeatBillingProration;
};

export type SeatBillingLedgerScope = "locked" | "unlocked";

export type SeatBillingWriteLedger = {
  load: (teamId: string) => Promise<PendingSeatBillingWrite | null>;
  begin: (teamId: string, write: PendingSeatBillingWrite) => Promise<boolean>;
  clear: (teamId: string, write: PendingSeatBillingWrite) => Promise<void>;
};

export class SeatBillingLockLostError extends Error {
  constructor() {
    super("Seat-billing lock ownership was lost");
    this.name = "SeatBillingLockLostError";
  }
}

export class SeatBillingWriteUnsettledError extends Error {
  constructor() {
    super("A previous seat-billing write to Stripe is still in flight");
    this.name = "SeatBillingWriteUnsettledError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const prorations = new Set(["none", "always_invoice", "create_prorations"]);
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const lockKey = (teamId: string) => `stripe:seat-billing:lock:${digest(teamId)}`;
const pendingKey = (teamId: string) =>
  `stripe:seat-billing:pending:${digest(teamId)}`;

function parsePendingSeatBillingWrite(raw: string | null): PendingSeatBillingWrite | null {
  try {
    const value = JSON.parse(raw ?? "") as PendingSeatBillingWrite;
    const known =
      typeof value?.idempotencyKey === "string" &&
      typeof value.itemId === "string" &&
      typeof value.quantity === "number" &&
      prorations.has(value.prorationBehavior);
    return known ? value : null;
  } catch {
    return null;
  }
}

export const seatBillingWrites: SeatBillingWriteLedger = {
  load: async (teamId) => {
    const redis = await getRedis();
    return parsePendingSeatBillingWrite(await redis.get(pendingKey(teamId)));
  },
  begin: async (teamId, write) =>
    (await (await getRedis()).set(pendingKey(teamId), JSON.stringify(write), "PX", PENDING_WRITE_TTL_MS, "NX")) === "OK",
  clear: async (teamId, write) => {
    const cleared = await (await getRedis()).eval(RELEASE_SCRIPT, 1, pendingKey(teamId), JSON.stringify(write));
    if (Number(cleared) !== 1) throw new SeatBillingWriteUnsettledError();
  },
};

export function createMemorySeatBillingWrites(): SeatBillingWriteLedger {
  const writes = new Map<string, PendingSeatBillingWrite>();
  return {
    load: async (teamId) => writes.get(teamId) ?? null,
    begin: async (teamId, write) => {
      if (writes.has(teamId)) return false;
      writes.set(teamId, write);
      return true;
    },
    clear: async (teamId, write) => {
      const stored = writes.get(teamId);
      if (stored && stored.idempotencyKey !== write.idempotencyKey) throw new SeatBillingWriteUnsettledError();
      writes.delete(teamId);
    },
  };
}

export async function withTeamSeatBillingLock<T>(
  teamId: string,
  run: (assertHeld: () => void, ledgerScope: "locked") => Promise<T>,
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
    return await run(assertHeld, "locked");
  } finally {
    clearInterval(timer);
    if (renewalInFlight) await renewalInFlight;
    try {
      await redis.eval(RELEASE_SCRIPT, 1, key, token);
    } catch {
    }
  }
}
