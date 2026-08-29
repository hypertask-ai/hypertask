import { createHash, randomUUID } from "node:crypto";

import { getRedis } from "@/lib/redis";

const LOCK_TTL_MS = 60_000;
const LOCK_RENEW_INTERVAL_MS = 15_000;
const LOCK_ACQUIRE_TIMEOUT_MS = 10_000;
const LOCK_RETRY_INTERVAL_MS = 100;
const LOCK_OPERATION_SAFETY_MS = 10_000;
const RESERVATION_TTL_SECONDS = 60 * 60 * 48;

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

const WRITE_RESERVATION_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  redis.call('set', KEYS[2], ARGV[2], 'EX', ARGV[3])
  return 1
end
return 0
`;

const CLEAR_RESERVATION_SCRIPT = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[2])
end
return -1
`;

export type CheckoutMode = "Trial" | "Normal";

export type CheckoutAttemptDesired = {
  cancelUrl: string;
  checkoutMode: CheckoutMode;
  customerId: string;
  googleAccountId: string;
  priceId: string;
  quantity: number;
  returnUrl: string;
  teamId: string;
};

export type CheckoutAttemptState = "prepared" | "in_flight" | "settled";

export type CheckoutAttempt = {
  attemptId: string;
  createdAt: string;
  desired: CheckoutAttemptDesired;
  idempotencyKey: string;
  sessionId?: string;
  sessionUrl?: string | null;
  state: CheckoutAttemptState;
  version: 1;
};

export type CheckoutReservationContext = {
  assertHeld: () => void;
  clear: () => Promise<void>;
  read: () => Promise<CheckoutAttempt | null>;
  write: (attempt: CheckoutAttempt) => Promise<void>;
};

export class CheckoutReservationLockLostError extends Error {
  constructor() {
    super("Checkout reservation lock ownership was lost");
    this.name = "CheckoutReservationLockLostError";
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const teamKeyDigest = (teamId: string) =>
  createHash("sha256").update(teamId).digest("hex");
const lockKey = (teamId: string) =>
  `stripe:checkout:lock:${teamKeyDigest(teamId)}`;
const reservationKey = (teamId: string) =>
  `stripe:checkout:reservation:${teamKeyDigest(teamId)}`;

function parseAttempt(raw: string | null): CheckoutAttempt | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CheckoutAttempt>;
    if (
      parsed.version !== 1 ||
      typeof parsed.attemptId !== "string" ||
      typeof parsed.idempotencyKey !== "string" ||
      !parsed.desired ||
      typeof parsed.desired !== "object"
    ) {
      return null;
    }
    if (
      parsed.state !== "prepared" &&
      parsed.state !== "in_flight" &&
      parsed.state !== "settled"
    ) {
      // Reservations written before explicit states are conservatively
      // treated as in-flight unless they already persisted a Stripe session.
      parsed.state = parsed.sessionId ? "settled" : "in_flight";
    }
    return parsed as CheckoutAttempt;
  } catch {
    return null;
  }
}

export function createCheckoutAttempt(
  desired: CheckoutAttemptDesired,
): CheckoutAttempt {
  const attemptId = randomUUID();
  return {
    version: 1,
    attemptId,
    createdAt: new Date().toISOString(),
    desired,
    idempotencyKey: `team-checkout:${desired.teamId}:${attemptId}`,
    state: "prepared",
  };
}

export async function withTeamCheckoutReservation<T>(
  teamId: string,
  run: (context: CheckoutReservationContext) => Promise<T>,
): Promise<T> {
  const redis = await getRedis();
  const teamLockKey = lockKey(teamId);
  const teamReservationKey = reservationKey(teamId);
  const token = randomUUID();
  const deadline = Date.now() + LOCK_ACQUIRE_TIMEOUT_MS;
  let acquired = false;

  while (!acquired && Date.now() < deadline) {
    acquired =
      (await redis.set(teamLockKey, token, "PX", LOCK_TTL_MS, "NX")) === "OK";
    if (!acquired) await sleep(LOCK_RETRY_INTERVAL_MS);
  }
  if (!acquired) {
    throw new Error("Another billing checkout is already in progress");
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
          teamLockKey,
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
      throw new CheckoutReservationLockLostError();
    }
  };

  const context: CheckoutReservationContext = {
    assertHeld,
    read: async () => {
      assertHeld();
      return parseAttempt(await redis.get(teamReservationKey));
    },
    write: async (attempt) => {
      assertHeld();
      const written = await redis.eval(
        WRITE_RESERVATION_SCRIPT,
        2,
        teamLockKey,
        teamReservationKey,
        token,
        JSON.stringify(attempt),
        String(RESERVATION_TTL_SECONDS),
      );
      if (Number(written) !== 1) {
        ownershipLost = true;
        throw new CheckoutReservationLockLostError();
      }
    },
    clear: async () => {
      assertHeld();
      const cleared = await redis.eval(
        CLEAR_RESERVATION_SCRIPT,
        2,
        teamLockKey,
        teamReservationKey,
        token,
      );
      if (Number(cleared) < 0) {
        ownershipLost = true;
        throw new CheckoutReservationLockLostError();
      }
    },
  };

  try {
    return await run(context);
  } finally {
    clearInterval(timer);
    if (renewalInFlight) await renewalInFlight;
    try {
      await redis.eval(RELEASE_SCRIPT, 1, teamLockKey, token);
    } catch {
      // The token-bound lease expires on its own.
    }
  }
}
