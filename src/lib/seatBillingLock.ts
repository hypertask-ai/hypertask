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
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

const CLEAR_SCRIPT = `
local stored = redis.call('get', KEYS[1])
if not stored then return 1 end
if cjson.decode(stored)['idempotencyKey'] == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0
`;

type RedisClient = Awaited<ReturnType<typeof getRedis>>;

export type SeatBillingProration =
  | "none"
  | "always_invoice"
  | "create_prorations";

export type PendingSeatBillingWrite = {
  idempotencyKey: string;
  itemId: string;
  quantity: number;
  prorationBehavior: SeatBillingProration;
};

export type SeatBillingLedgerScope = "locked" | "unlocked";

export type SeatBillingWriteLedger = {
  load: (teamId: string) => Promise<PendingSeatBillingWrite | null>;
  begin: (teamId: string, write: PendingSeatBillingWrite) => Promise<boolean>;
  clear: (teamId: string, idempotencyKey: string) => Promise<void>;
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
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const lockKey = (teamId: string) => `stripe:seat-billing:lock:${digest(teamId)}`;
const pendingKey = (teamId: string) =>
  `stripe:seat-billing:pending:${digest(teamId)}`;

function isSeatBillingProration(value: unknown): value is SeatBillingProration {
  return (
    value === "none" ||
    value === "always_invoice" ||
    value === "create_prorations"
  );
}

function isPendingSeatBillingWrite(
  value: unknown,
): value is PendingSeatBillingWrite {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.idempotencyKey === "string" &&
    typeof candidate.itemId === "string" &&
    typeof candidate.quantity === "number" &&
    isSeatBillingProration(candidate.prorationBehavior)
  );
}

function parsePendingSeatBillingWrite(
  raw: string | null,
): PendingSeatBillingWrite | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return isPendingSeatBillingWrite(parsed) ? parsed : null;
}

export const seatBillingWrites: SeatBillingWriteLedger = {
  load: async (teamId) => {
    const redis = await getRedis();
    return parsePendingSeatBillingWrite(await redis.get(pendingKey(teamId)));
  },
  begin: async (teamId, write) => {
    const redis = await getRedis();
    const claimed = await redis.set(
      pendingKey(teamId),
      JSON.stringify(write),
      "PX",
      PENDING_WRITE_TTL_MS,
      "NX",
    );
    return claimed === "OK";
  },
  clear: async (teamId, idempotencyKey) => {
    const redis = await getRedis();
    const cleared = await redis.eval(
      CLEAR_SCRIPT,
      1,
      pendingKey(teamId),
      idempotencyKey,
    );
    if (Number(cleared) !== 1) {
      throw new SeatBillingWriteUnsettledError();
    }
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
    clear: async (teamId, idempotencyKey) => {
      const stored = writes.get(teamId);
      if (stored && stored.idempotencyKey !== idempotencyKey) {
        throw new SeatBillingWriteUnsettledError();
      }
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
