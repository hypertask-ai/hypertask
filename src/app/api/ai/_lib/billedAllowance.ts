import { gatewayReport } from "@/lib/ai/gatewayReport";
import { randomUUID } from "node:crypto";
import type { AllowanceDriftContext } from "./sharedAllowance";
import { getRedis } from "@/lib/redis";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7692_BILLED_COST_FLAG } from "@/lib/flags/definitions/htpr-7692-billed-cost";
import { INCLUDED_WITH_HYPERTASK_GATEWAY_TAG, SYSTEM_AI_FEATURES } from "@/lib/aiUsageClassification";

export const GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v1";
export const MICRO_USD_PER_USD = 1_000_000;
export const RESERVATION_TTL_MS = 10 * 60 * 1000;
export const GATEWAY_REPORT_DELAY_WINDOW_MS = 15 * 60 * 1000;
export const BILLED_SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000;

export const finiteNonNegative = (value: unknown): number | null => {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : null;
};

export function usdToMicroUsd(value: number): number {
  return Math.max(0, Math.ceil(value * MICRO_USD_PER_USD));
}

export type GatewaySpendBreakdown = {
  legacySystemMicroUsd: number;
  systemMicroUsd: number;
  totalMicroUsd: number;
  visibleMicroUsd: number;
};

export async function gatewaySpendBreakdownMicroUsd(
  gatewayApiKey: string,
  teamId: string,
  startDate: string,
  endDate: string,
  signal?: AbortSignal,
): Promise<GatewaySpendBreakdown> {
  const params = new URLSearchParams({
    start_date: startDate,
    end_date: endDate,
    group_by: "tag",
    tags: `team:${teamId}`,
  });
  const response = await gatewayReport(gatewayApiKey, params, signal);
  if (!response.ok) {
    throw Object.assign(new Error("AI Gateway allowance report failed"), { status: response.status });
  }
  const payload = (await response.json()) as { results?: unknown };
  if (!Array.isArray(payload.results)) {
    throw new Error("AI Gateway allowance report is invalid");
  }
  let teamUsd = 0;
  let markedSystemUsd = 0;
  let legacySystemUsd = 0;
  let foundTeamTag = false;

  for (const value of payload.results) {
    if (!value || typeof value !== "object") {
      throw new Error("AI Gateway allowance report row is invalid");
    }
    const row = value as { tag?: unknown; total_cost?: unknown };
    if (typeof row.tag !== "string") {
      throw new Error("AI Gateway allowance report tag is invalid");
    }
    const cost = finiteNonNegative(row.total_cost);
    if (cost === null) throw new Error("AI Gateway allowance cost is invalid");
    const tag = row.tag.trim();
    if (tag === `team:${teamId}`) {
      foundTeamTag = true;
      teamUsd += cost;
    }
    if (tag === INCLUDED_WITH_HYPERTASK_GATEWAY_TAG) {
      markedSystemUsd += cost;
    }
    if ((SYSTEM_AI_FEATURES as readonly string[]).includes(tag)) {
      legacySystemUsd += cost;
    }
  }

  if (payload.results.length > 0 && !foundTeamTag) {
    throw new Error("AI Gateway allowance report omitted the owning team tag");
  }

  const systemUsd = Math.min(
    teamUsd,
    Math.max(markedSystemUsd, legacySystemUsd),
  );
  return {
    legacySystemMicroUsd: usdToMicroUsd(
      Math.min(teamUsd, Math.max(legacySystemUsd - markedSystemUsd, 0)),
    ),
    systemMicroUsd: usdToMicroUsd(systemUsd),
    totalMicroUsd: usdToMicroUsd(teamUsd),
    visibleMicroUsd: usdToMicroUsd(Math.max(teamUsd - systemUsd, 0)),
  };
}

export const BILLED_ALLOWANCE_SCOPE_INDEX = "ai-allowance-billed:v1:scopes";

export type BilledFunding = { apiKey: string; provenance: string };
export type EffectiveAccountingSource = {
  mode: "billed" | "v1";
  key: string;
  funding?: string;
  visible?: number;
  system?: number;
  total?: number;
};

export type BilledCall = { teamId: string; userId: number; reservationId: string };
export type HoldReleaseReason = "finish" | "stop" | "error" | "eof" | "expiry" | "disconnect-end";

export async function billedCostEnabled(userId: number | null): Promise<boolean> {
  try {
    return await isFeatureEnabled(HTPR_7692_BILLED_COST_FLAG, userId ?? 0);
  } catch {
    return false;
  }
}

export function billedAllowancePeriod(kind: "month" | "day", period: string, now = Date.now()) {
  const [year, month, day] = period.split("-").map(Number);
  const end = kind === "month" ? Date.UTC(year, month, 1) : Date.UTC(year, month - 1, day + 1);
  return {
    startDate: kind === "month" ? `${period}-01` : period,
    endDate: new Date(Math.min(now, end - 1)).toISOString().slice(0, 10),
    endsAt: end,
    expiresAt: end + 8 * 86_400_000,
    ttlSeconds: Math.max(1, Math.ceil((end + 8 * 86_400_000 - now) / 1000)),
  };
}

export async function resolveBilledFunding(args: {
  teamId?: string;
  gatewayApiKey?: string;
  fundingSource?: AllowanceDriftContext["fundingSource"];
}): Promise<BilledFunding | null> {
  if (!args.teamId || args.fundingSource === "demo") {
    const apiKey = process.env.DEMO_AI_GATEWAY_API_KEY?.trim();
    return apiKey ? { apiKey, provenance: "demo" } : null;
  }
  try {
    const { getTeamGatewayFunding } = await import("@/app/api/ai/_lib/byokKeys");
    const funding = await getTeamGatewayFunding({ trustedTeamId: args.teamId }, { includeProvenance: true });
    if (!funding || funding.source === "customer" ||
      (args.gatewayApiKey !== undefined && args.gatewayApiKey !== funding.apiKey) ||
      (args.fundingSource !== undefined && args.fundingSource !== funding.source)) return null;
    if (funding.source === "managed" && (!funding.managedKeyId || !funding.managedKeyUpdatedAt)) return null;
    return { apiKey: funding.apiKey, provenance: funding.source === "managed"
      ? JSON.stringify([funding.source, funding.managedKeyId, funding.managedKeyUpdatedAt]) : funding.source };
  } catch {
    return null;
  }
}

async function alertBilledFallback(key: string, reason: string, ttlSeconds: number) {
  try {
    const redis = await getRedis();
    const category = reason === "funding-changed" ? reason : "unavailable";
    if (!await redis.set(`${key}:alert:${category}`, "1", "EX", ttlSeconds, "NX")) return;
    const { reportError } = await import("@/lib/errors/reportError");
    await reportError({ source: "server", minimumOccurrences: 1,
      fingerprintKey: `${key}:${reason}`, message: `AI billed allowance uses estimate accounting; scope ${key}; reason ${reason}`,
      extra: { route: "/api/ai", stage: "billed-fallback" } });
  } catch {}
}

const REFRESH_BILLED_SCRIPT = `
if redis.call("GET", KEYS[2]) ~= ARGV[1] then return 0 end
if (redis.call("HGET", KEYS[1], "revision") or "0") ~= ARGV[2] then return 0 end
local funding = redis.call("HGET", KEYS[1], "funding")
if redis.call("HGET", KEYS[1], "unusable") == "1" then return -1 end
if funding and funding ~= ARGV[3] then
  redis.call("HSET", KEYS[1], "unusable", "1")
  return -1
end
redis.call("HSET", KEYS[1], "visible", ARGV[4], "system", ARGV[5], "total", ARGV[6], "fetchedAt", ARGV[7], "revision", tonumber(ARGV[2]) + 1, "funding", ARGV[3])
redis.call("EXPIRE", KEYS[1], ARGV[8])
return 1
`;

export async function effectiveAccountingSource(args: {
  teamId: string;
  kind: "month" | "day";
  period: string;
  funding: BilledFunding | null;
  refresh?: boolean;
}): Promise<EffectiveAccountingSource> {
  const key = `ai-allowance-billed:v1:${args.kind}:${args.period}:${args.teamId}`;
  const fallback: EffectiveAccountingSource = { mode: "v1", key };
  const period = billedAllowancePeriod(args.kind, args.period);
  try {
    const redis = await getRedis();
    let saved = await redis.hgetall(key);
    const usable = () => args.funding && saved.funding === args.funding.provenance && saved.unusable !== "1" && Date.now() - Number(saved.fetchedAt) <= BILLED_SNAPSHOT_MAX_AGE_MS &&
      [saved.visible, saved.system, saved.total, saved.fetchedAt, saved.revision].every((value) =>
        value !== undefined && Number.isSafeInteger(Number(value)) && Number(value) >= 0);
    if (!args.funding || saved.unusable === "1") {
      await alertBilledFallback(key, saved.unusable === "1" ? "funding-changed" : "funding-unavailable", period.ttlSeconds);
      return fallback;
    }
    if (args.refresh !== false && period.expiresAt > Date.now() &&
      (!usable() || Date.now() - Number(saved.fetchedAt) >= 60_000)) {
      const token = randomUUID();
      const lease = `${key}:lease`;
      if (await redis.set(lease, token, "EX", 5, "NX")) {
        let outcome = "failed";
        try {
          saved = await redis.hgetall(key);
          if (saved.unusable === "1" || (saved.funding && saved.funding !== args.funding.provenance)) {
            await redis.eval(REFRESH_BILLED_SCRIPT, 2, key, lease, token, saved.revision ?? "0",
              args.funding.provenance, "0", "0", "0", String(Date.now()), String(period.ttlSeconds));
            outcome = "funding-changed";
          } else {
            const signal = AbortSignal.timeout(3_000);
            const spend = args.teamId === "demo"
              ? await demoGatewaySpendMicroUsd(args.funding.apiKey, period, signal)
              : await gatewaySpendBreakdownMicroUsd(args.funding.apiKey, args.teamId, period.startDate, period.endDate, signal);
            const values = typeof spend === "number" ? { visibleMicroUsd: spend, systemMicroUsd: 0, totalMicroUsd: spend } : spend;
            if (![values.visibleMicroUsd, values.systemMicroUsd, values.totalMicroUsd].every((value) => Number.isSafeInteger(value) && value >= 0)) {
              throw new Error("Invalid billed allowance totals");
            }
            const changed = await redis.eval(REFRESH_BILLED_SCRIPT, 2, key, lease, token, saved.revision ?? "0", args.funding.provenance,
              String(values.visibleMicroUsd), String(values.systemMicroUsd), String(values.totalMicroUsd), String(Date.now()), String(billedAllowancePeriod(args.kind, args.period).ttlSeconds));
            outcome = Number(changed) === 1 ? "refreshed" : Number(changed) === -1 ? "funding-changed" : "superseded";
          }
        } catch {
          if (!usable()) await alertBilledFallback(key, "report-failed", period.ttlSeconds);
        } finally {
          await redis.eval(`
if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end
return 0
`, 1, lease, token);
          saved = await redis.hgetall(key);
          console.info(JSON.stringify({ event: "ai-allowance-billed-refresh", teamId: args.teamId, scope: key, mode: usable() ? "billed" : "v1", billed: Number(saved.total ?? 0), outcome }));
        }
      } else {
        saved = await redis.hgetall(key);
      }
    }
    if (!usable()) {
      await alertBilledFallback(key, saved.funding && saved.funding !== args.funding.provenance ? "funding-changed" : "snapshot-unavailable", period.ttlSeconds);
      return fallback;
    }
    return { mode: "billed", key, funding: args.funding.provenance,
      visible: Number(saved.visible), system: Number(saved.system), total: Number(saved.total) };
  } catch {
    await alertBilledFallback(key, "redis-unavailable", period.ttlSeconds);
    return fallback;
  }
}

export function logBilledRelease(call: BilledCall, reason: HoldReleaseReason) {
  console.info(JSON.stringify({ event: "ai-allowance-billed-release", ...call, reason }));
}

export const EXPIRE_RESERVATION_SCRIPT = `
local expiredBilled = {}
local function reservationHeldAmount(member, reservationsKey)
  local amount = tonumber(string.match(member, "|(%d+)$") or "0")
  local encoded = string.match(member, "^[^|]+|(.+)|%d+$")
  if encoded then
    for _, original in ipairs(cjson.decode(encoded)) do
      if original[2] == reservationsKey then return tonumber(original[4]) or amount end
    end
  end
  return amount
end
local function expireReservation(member, committedKey, reservationsKey, ttlSeconds, now)
  local encoded = string.match(member, "^[^|]+|(.+)|%d+$")
  local originalScopes = encoded and cjson.decode(encoded) or {{committedKey, reservationsKey, ttlSeconds}}
  local amount = tonumber(string.match(member, "|(%d+)$") or "0")
  local released = false
  for _, original in ipairs(originalScopes) do
    if redis.call("ZREM", original[2], member) == 1 then
      released = true
      redis.call("INCRBY", original[1], tonumber(original[4]) or amount)
      redis.call("EXPIRE", original[1], original[3])
      local lanePrefix = string.match(original[1], "^(ai%-allowance:%d%d%d%d%-%d%d:.+):committed$")
      if lanePrefix then
        local journalKey = lanePrefix .. ":recent-settled"
        redis.call("ZADD", journalKey, now, member)
        redis.call("ZREMRANGEBYSCORE", journalKey, "-inf", now - ${GATEWAY_REPORT_DELAY_WINDOW_MS})
        redis.call("EXPIRE", journalKey, original[3])
        redis.call("SET", journalKey .. "-since", now, "EX", original[3], "NX")
      end
    end
  end
  if released and originalScopes[1][5] then table.insert(expiredBilled, originalScopes[1][5]) end
end
`;

const RESERVE_BILLED_SCOPES_SCRIPT = `
${EXPIRE_RESERVATION_SCRIPT}
local scopes = cjson.decode(ARGV[1])
local clock = redis.call("TIME")
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local amount = tonumber(ARGV[3])
local details = {}
local refused = 0
for _, scope in ipairs(scopes) do
  if now >= scope.endsAt then return "period-rolled" end
  local billed = scope.source.mode == "billed" and redis.call("HGET", scope.source.key, "funding") == scope.source.funding and redis.call("HGET", scope.source.key, "unusable") ~= "1" and now - tonumber(redis.call("HGET", scope.source.key, "fetchedAt") or "0") <= ${BILLED_SNAPSHOT_MAX_AGE_MS} and redis.call("HGET", scope.source.key, scope.field)
  if (not billed or scope.reason ~= "month") and redis.call("EXISTS", scope.seedKey) == 0 then return "shadow-uninitialized" end
end
for index, scope in ipairs(scopes) do
  local total = 0
  local held = 0
  for _, pair in ipairs(scope.pairs) do
    for _, member in ipairs(redis.call("ZRANGEBYSCORE", KEYS[pair[2]], "-inf", now)) do
      expireReservation(member, KEYS[pair[1]], KEYS[pair[2]], scope.ttlSeconds, now)
    end
    total = total + tonumber(redis.call("GET", KEYS[pair[1]]) or "0")
    for _, member in ipairs(redis.call("ZRANGE", KEYS[pair[2]], 0, -1)) do
      held = held + reservationHeldAmount(member, KEYS[pair[2]])
    end
  end
  if scope.pending then total = total + tonumber(redis.call("GET", KEYS[scope.pending]) or "0") end
  local mode = "v1"
  if scope.source.mode == "billed" and redis.call("HGET", scope.source.key, "funding") == scope.source.funding and redis.call("HGET", scope.source.key, "unusable") ~= "1" and now - tonumber(redis.call("HGET", scope.source.key, "fetchedAt") or "0") <= ${BILLED_SNAPSHOT_MAX_AGE_MS} then
    local billed = redis.call("HGET", scope.source.key, scope.field)
    if billed then total = tonumber(billed); mode = "billed" end
  end
  table.insert(details, {scope = scope.source.key, mode = mode, billed = total, holds = held, requested = amount, cap = scope.cap})
  if total + held + amount > scope.cap and refused == 0 then refused = -index end
end
if refused == 0 then
  for _, scope in ipairs(scopes) do
    local pair = scope.pairs[scope.writeIndex]
    redis.call("ZADD", KEYS[pair[2]], ARGV[4], ARGV[5])
    redis.call("EXPIRE", KEYS[pair[1]], scope.ttlSeconds)
    redis.call("EXPIRE", KEYS[pair[2]], scope.ttlSeconds)
  end
end
for _, scope in ipairs(scopes) do
  redis.call("SET", scope.source.key .. ":actor", ARGV[8], "EX", scope.billedTtlSeconds)
  if scope.reason == "demo" then redis.call("ZADD", ARGV[6], now, ARGV[9]) end
end
redis.call("ZADD", ARGV[6], now, ARGV[7])
return {refused == 0 and 1 or refused, cjson.encode(details), #expiredBilled == 0 and "[]" or cjson.encode(expiredBilled)}
`;

export async function reserveBilledScopes(args: {
  keys: string[];
  encoded: unknown[];
  amount: number;
  id: string;
  call: BilledCall;
  month: string;
  day: string;
}) {
  const redis = await getRedis();
  const result = await redis.eval(RESERVE_BILLED_SCOPES_SCRIPT, args.keys.length, ...args.keys,
    JSON.stringify(args.encoded), String(Date.now()), String(args.amount), String(Date.now() + RESERVATION_TTL_MS), args.id,
    BILLED_ALLOWANCE_SCOPE_INDEX, `${args.call.teamId}|${args.month}|${args.day}`, String(args.call.userId), `demo|${args.month}|${args.day}`);
  if (result === "period-rolled" || result === "shadow-uninitialized") return { retry: result, decision: [0], details: [] };
  if (!Array.isArray(result)) throw new Error("Invalid billed allowance reservation response");
  const accepted = Number(result[0]);
  const details = JSON.parse(String(result[1])) as Array<{ scope: string; mode: string; billed: number; holds: number; requested: number; cap: number }>;
  for (const call of JSON.parse(String(result[2])) as BilledCall[]) logBilledRelease(call, "expiry");
  const refused = details[-accepted - 1];
  return { retry: null, decision: accepted === 1 ? [1] : [accepted, refused.billed, refused.holds], details };
}

export async function demoGatewaySpendMicroUsd(gatewayApiKey: string, month: { startDate: string; endDate: string }, signal?: AbortSignal) {
  const params = new URLSearchParams({ start_date: month.startDate, end_date: month.endDate, group_by: "day" });
  const response = await gatewayReport(gatewayApiKey, params, signal);
  if (!response.ok) throw Object.assign(new Error("AI Gateway demo allowance report failed"), { status: response.status });
  const payload = await response.json() as { results?: Array<{ total_cost?: unknown }> };
  if (!Array.isArray(payload.results)) throw new Error("AI Gateway demo allowance report is invalid");
  let total = 0;
  for (const row of payload.results) {
    const cost = finiteNonNegative(row?.total_cost);
    if (cost === null) throw new Error("AI Gateway demo allowance cost is invalid");
    total += cost;
  }
  return usdToMicroUsd(total);
}

const SEED_SCOPE_SCRIPT = `
if not redis.call("SET", KEYS[2], "1", "EX", ARGV[2], "NX") then return 0 end
if ARGV[3] == "1" then
  redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2], "NX")
else
  redis.call("INCRBY", KEYS[1], ARGV[1])
  redis.call("EXPIRE", KEYS[1], ARGV[2])
end
return 1
`;

export async function seedAllowanceScope(
  prefix: string,
  ttlSeconds: number,
  loadSpend: () => Promise<number>,
  billed = false,
) {
  const redis = await getRedis();
  if (await redis.exists(`${prefix}:seeded`)) return;
  const spend = await loadSpend();
  await redis.eval(SEED_SCOPE_SCRIPT, 2, `${prefix}:committed`, `${prefix}:seeded`, String(spend), String(ttlSeconds), billed ? "1" : "0");
}

