export const ERROR_TICKET_THRESHOLD_WINDOW_SECONDS = 24 * 60 * 60;

type RedisEvalClient = {
  eval(
    script: string,
    numberOfKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>;
};

const CLAIM_THRESHOLD_TICKET = `
local windowMilliseconds = tonumber(ARGV[2]) * 1000
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], windowMilliseconds)
end

local expiresAtMilliseconds = redis.call('PEXPIRETIME', KEYS[1])
if expiresAtMilliseconds == -1 then
  redis.call('PEXPIRE', KEYS[1], windowMilliseconds)
  expiresAtMilliseconds = redis.call('PEXPIRETIME', KEYS[1])
elseif expiresAtMilliseconds == -2 then
  return { count, 0 }
end

if count < tonumber(ARGV[1]) then
  return { count, 0 }
end

local claimed = redis.call(
  'SET',
  KEYS[2],
  '1',
  'NX',
  'PXAT',
  expiresAtMilliseconds
)
if claimed then
  return { count, 1 }
end
return { count, 0 }
`;

export async function claimThresholdErrorTicket(
  redis: RedisEvalClient,
  fingerprint: string,
  minimumOccurrences: number,
  windowSeconds = ERROR_TICKET_THRESHOLD_WINDOW_SECONDS
) {
  const occurrenceKey = `errors:occurrences:${fingerprint}`;
  const claimKey = `errors:threshold-claim:${fingerprint}`;
  const raw = await redis.eval(
    CLAIM_THRESHOLD_TICKET,
    2,
    occurrenceKey,
    claimKey,
    minimumOccurrences,
    windowSeconds
  );

  if (!Array.isArray(raw) || raw.length < 2) {
    throw new Error("Redis returned an invalid error-threshold result");
  }

  const occurrenceCount = Number(raw[0]);
  const claimed = Number(raw[1]) === 1;
  if (!Number.isInteger(occurrenceCount) || occurrenceCount < 1) {
    throw new Error("Redis returned an invalid error occurrence count");
  }

  return { occurrenceCount, claimed };
}
