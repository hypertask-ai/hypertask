import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Redis } from "ioredis";

const EVENT_TTL_SECONDS = 7 * 24 * 60 * 60;
const PROCESSING_TTL_SECONDS = 5 * 60;
const WINDOW_MILLISECONDS = 5 * 60 * 1000;
const WINDOW_TTL_SECONDS = 10 * 60;
const MAX_EVENT_AGE_MILLISECONDS = 10 * 60 * 1000;
const MAX_FUTURE_SKEW_MILLISECONDS = 2 * 60 * 1000;
const SERVER_ERROR_SPIKE_THRESHOLD = 20;

type JsonRecord = Record<string, unknown>;
type PostHogErrorSignatureFields = {
  source: string;
  environment: string;
  release: string;
  fingerprint: string;
  eventId: string;
  timestamp: string;
  name: string;
  message: string;
};

export type PostHogExceptionAlert = {
  eventId: string;
  timestamp: string;
  environment: "production" | "preview";
  release: string;
  fingerprint: string;
  name: string;
  message: string;
};

export type AlertClaim = {
  accepted: boolean;
  count: number;
  firstFingerprint: boolean;
  ownershipToken: string;
  retryable: boolean;
  spike: boolean;
};

function alertKeys(alert: PostHogExceptionAlert) {
  const prefix = `posthog:error-alert:${alert.environment}:${alert.release}`;
  return {
    event: `${prefix}:event:${alert.eventId}`,
    window: `${prefix}:window`,
    fingerprint: `${prefix}:fingerprint:${alert.fingerprint}`,
    spike: `${prefix}:spike`,
  };
}

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function boundedString(value: unknown, max: number) {
  return typeof value === "string" && value.length > 0
    ? value.slice(0, max)
    : undefined;
}

export function postHogErrorEventSignature(
  fields: PostHogErrorSignatureFields,
  eventSecret: string,
) {
  return createHmac("sha256", eventSecret)
    .update(
      `${fields.source}\n${fields.environment}\n${fields.release}\n${fields.fingerprint}\n${fields.eventId}\n${fields.timestamp}\n${fields.name}\n${fields.message}`,
    )
    .digest();
}

export function parsePostHogExceptionAlert(
  payload: unknown,
  eventSecret: string,
  now = Date.now(),
): PostHogExceptionAlert | undefined {
  const envelope = record(payload);
  const event = record(envelope?.event);
  const properties = record(event?.properties);
  if (event?.event !== "$exception" || properties?.ht_source !== "server") {
    return undefined;
  }

  const environment = properties.ht_environment;
  if (environment !== "production" && environment !== "preview") {
    return undefined;
  }

  const eventId = boundedString(properties.ht_event_nonce, 64);
  const timestamp = boundedString(properties.ht_occurred_at, 64);
  const release = boundedString(properties.ht_release, 40);
  const fingerprint = boundedString(properties.ht_fingerprint, 64);
  const signature = boundedString(properties.ht_event_signature, 64);
  const exception = Array.isArray(properties.$exception_list)
    ? record(properties.$exception_list[0])
    : undefined;
  const name = boundedString(exception?.type, 120) || "Error";
  const message = boundedString(exception?.value, 1000) || "Unknown server error";
  if (
    !eventId ||
    !/^[0-9a-f-]{32,64}$/i.test(eventId) ||
    !timestamp ||
    !release ||
    !/^[0-9a-f]{40}$/i.test(release) ||
    !fingerprint ||
    !/^[0-9a-f]{64}$/i.test(fingerprint) ||
    !signature ||
    !/^[0-9a-f]{64}$/i.test(signature)
  ) {
    return undefined;
  }

  const expectedSignature = postHogErrorEventSignature(
    {
      source: properties.ht_source,
      environment,
      release,
      fingerprint,
      eventId,
      timestamp,
      name,
      message,
    },
    eventSecret,
  );
  const suppliedSignature = Buffer.from(signature, "hex");
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    return undefined;
  }

  const occurredAt = Date.parse(timestamp);
  if (
    !Number.isFinite(occurredAt) ||
    occurredAt < now - MAX_EVENT_AGE_MILLISECONDS ||
    occurredAt > now + MAX_FUTURE_SKEW_MILLISECONDS
  ) {
    return undefined;
  }

  return {
    eventId,
    timestamp: new Date(occurredAt).toISOString(),
    environment,
    release: release.toLowerCase(),
    fingerprint: fingerprint.toLowerCase(),
    name,
    message,
  };
}

// KEYS are the event dedupe key, rolling-window sorted set, first-fingerprint
// claim, and one-spike-per-release claim. ARGV are receive time, claim TTL,
// event nonce, window length, window TTL, and threshold. One Lua call keeps the
// count and both alert claims atomic when several server errors arrive together.
const CLAIM_SCRIPT = `
if not redis.call('SET', KEYS[1], ARGV[7], 'NX', 'EX', ARGV[2]) then
  local ttl = redis.call('TTL', KEYS[1])
  local processing = ttl >= 0 and ttl <= tonumber(ARGV[2]) and 1 or 0
  return {0, 0, 0, 0, processing}
end
redis.call('ZADD', KEYS[2], ARGV[1], ARGV[3])
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[1] - ARGV[4])
redis.call('EXPIRE', KEYS[2], ARGV[5])
local count = redis.call('ZCARD', KEYS[2])
local first = redis.call('SET', KEYS[3], ARGV[7], 'NX', 'EX', ARGV[2]) and 1 or 0
local spike = 0
if count > tonumber(ARGV[6]) then
  spike = redis.call('SET', KEYS[4], ARGV[7], 'NX', 'EX', ARGV[2]) and 1 or 0
end
return {1, count, first, spike, 0}
`;

export async function claimPostHogAlert(
  redis: Redis,
  alert: PostHogExceptionAlert,
  now = Date.now(),
  ownershipToken: string = randomUUID(),
): Promise<AlertClaim> {
  const keys = alertKeys(alert);
  const result = await redis.eval(
    CLAIM_SCRIPT,
    4,
    keys.event,
    keys.window,
    keys.fingerprint,
    keys.spike,
    now,
    PROCESSING_TTL_SECONDS,
    alert.eventId,
    WINDOW_MILLISECONDS,
    WINDOW_TTL_SECONDS,
    SERVER_ERROR_SPIKE_THRESHOLD,
    ownershipToken,
  );
  if (!Array.isArray(result) || result.length !== 5) {
    throw new Error("Redis returned an invalid PostHog alert claim");
  }
  const [accepted, count, firstFingerprint, spike, retryable] =
    result.map(Number);
  return {
    accepted: accepted === 1,
    count,
    firstFingerprint: firstFingerprint === 1,
    ownershipToken,
    retryable: retryable === 1,
    spike: spike === 1,
  };
}

const COMMIT_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('EXPIRE', KEYS[1], ARGV[2])
if ARGV[3] == '1' and redis.call('GET', KEYS[2]) == ARGV[1] then
  redis.call('EXPIRE', KEYS[2], ARGV[2])
end
if ARGV[4] == '1' and redis.call('GET', KEYS[3]) == ARGV[1] then
  redis.call('EXPIRE', KEYS[3], ARGV[2])
end
return 1
`;

export async function commitPostHogAlertClaim(
  redis: Redis,
  alert: PostHogExceptionAlert,
  claim: AlertClaim,
) {
  const keys = alertKeys(alert);
  await redis.eval(
    COMMIT_SCRIPT,
    3,
    keys.event,
    keys.fingerprint,
    keys.spike,
    claim.ownershipToken,
    EVENT_TTL_SECONDS,
    claim.firstFingerprint ? 1 : 0,
    claim.spike ? 1 : 0,
  );
}

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1])
redis.call('ZREM', KEYS[2], ARGV[2])
if ARGV[3] == '1' and redis.call('GET', KEYS[3]) == ARGV[1] then
  redis.call('DEL', KEYS[3])
end
if ARGV[4] == '1' and redis.call('GET', KEYS[4]) == ARGV[1] then
  redis.call('DEL', KEYS[4])
end
return 1
`;

export async function releasePostHogAlertClaim(
  redis: Redis,
  alert: PostHogExceptionAlert,
  claim: AlertClaim,
) {
  const keys = alertKeys(alert);
  await redis.eval(
    RELEASE_SCRIPT,
    4,
    keys.event,
    keys.window,
    keys.fingerprint,
    keys.spike,
    claim.ownershipToken,
    alert.eventId,
    claim.firstFingerprint ? 1 : 0,
    claim.spike ? 1 : 0,
  );
}
