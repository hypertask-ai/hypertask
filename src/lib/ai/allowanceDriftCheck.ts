import { randomUUID } from "node:crypto";
import {
  allowanceDriftTtl,
  gatewaySpendBreakdownMicroUsd,
  gatewayHourlySpend,
  SYSTEM_AI_ALLOWANCE_MULTIPLIER,
  type AllowanceDriftContext,
  type AllowanceRefusal,
  type AllowanceRefusalBucket,
} from "@/app/api/ai/_lib/sharedAllowance";
import { getTeamGatewayFunding } from "@/app/api/ai/_lib/byokKeys";
import { aiAllowancePeriod } from "@/lib/aiAllowancePolicy";
import { redactSecrets } from "@/lib/errors/errorFingerprint";
import { redactErrorText } from "@/lib/telemetry/errorSanitization";
import { reportError } from "@/lib/errors/reportError";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7692_ALLOWANCE_DRIFT_CHECK_FLAG } from "@/lib/flags/definitions/htpr-7692-allowance-drift-check";
import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";

const QUIET_MS = 30 * 60 * 1000;
const REFUSAL_RECOVERY_MS = 2 * 60 * 60 * 1000;
const BUDGET_MS = 240 * 1000;
const MAX_TEAMS = 200;
const CONCURRENCY = 4;
const SNAPSHOT_SCRIPT = `
local visible = redis.call("GET", KEYS[1])
local system = redis.call("GET", KEYS[2])
if not visible and not system then return nil end
return {visible or "0", system or "0", redis.call("GET", KEYS[3]) or "0"}
`;

type Incident = { id: string; notified: boolean };
type Observation = {
  snapshot: string;
  changedAt: number;
  sequence: number;
  drift?: Incident;
  refusal?: Incident;
  refusalSeen: string[];
  refusalLastAt?: number;
};

export type AllowanceDriftCounts = {
  checked: number;
  inconclusive: number;
  unknown: number;
  drift: number;
  refusalAlerts: number;
};

const dollars = (microUsd: number) => `$${(microUsd / 1_000_000).toFixed(6)}`;
const safeTitle = (title: string) => redactErrorText(redactSecrets(title), 256).replace(/[^\p{L}\p{N} ._()[\]-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 64) || "Untitled";
const validAmount = (value: number) => Number.isSafeInteger(value) && value >= 0;

export async function checkActiveTeamAllowanceDrift(): Promise<AllowanceDriftCounts> {
  const counts: AllowanceDriftCounts = { checked: 0, inconclusive: 0, unknown: 0, drift: 0, refusalAlerts: 0 };
  if (!await isFeatureEnabled(HTPR_7692_ALLOWANCE_DRIFT_CHECK_FLAG, 0)) return counts;
  const redis = await getRedis();
  const now = new Date(Date.now());
  const deadline = now.getTime() + BUDGET_MS;
  const month = aiAllowancePeriod(now);
  const periods = [month];
  if (now.getUTCDate() <= 2) periods.unshift(aiAllowancePeriod(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 1)));
  const hourlyReports = new Map<string, ReturnType<typeof gatewayHourlySpend>>();
  const token = randomUUID();
  const lockKey = "ai-allowance-drift:lock";
  if (!await redis.set(lockKey, token, "EX", 300, "NX")) return counts;
  try {
    for (const period of periods) {
      const historical = period.key !== month.key;
      const root = `ai-allowance-drift:${period.key}`;
      const ttl = allowanceDriftTtl(now, period.key);
      const limit = historical ? MAX_TEAMS / 2 : MAX_TEAMS;
      const cursorKey = `${root}:${historical ? "refusal-cursor" : "cursor"}`;
      const saved = await redis.get(cursorKey);
      const position: { cursor: string; pending: string[] } = saved ? JSON.parse(saved) : { cursor: "0", pending: [] };
      const visited = new Set<string>();
      const checkTeam = async (teamId: string) => {
        counts.checked++;
        try {
          if (!/^[A-Za-z0-9_-]{1,80}$/.test(teamId)) throw new Error("Invalid indexed team");
          const prefix = `${root}:${teamId}`;
          const incidentTeamId = teamId.match(/.{1,16}/g)!.join(".");
          const displayedTeamId = teamId.match(/.{1,16}/g)!.join(" ");
          const contextJson = await redis.get(`${prefix}:context`);
          if (!contextJson) throw new Error("Missing allowance observation context");
          const context = JSON.parse(contextJson) as AllowanceDriftContext;
          if (!["legacy", "plan"].includes(context.mode) || !Number.isFinite(context.monthlyUsd) || context.monthlyUsd <= 0 || !validAmount(Math.round(context.monthlyUsd * 1_000_000))) {
            throw new Error("Invalid allowance observation context");
          }
          const counterPrefix = `ai-allowance:${period.key}:${teamId}`;
          const snapshot = async () => {
            const result = await redis.eval(SNAPSHOT_SCRIPT, 3, `${counterPrefix}:committed`, `${counterPrefix}:system:committed`, `${counterPrefix}:legacy-pending`);
            if (!Array.isArray(result) || result.length !== 3) throw new Error("Unavailable allowance snapshot");
            const values = result.map(Number);
            if (!values.every(validAmount) || !validAmount(values.reduce((sum, value) => sum + value, 0))) throw new Error("Invalid allowance snapshot");
            return values;
          };
          const buckets = (await redis.hvals(`${prefix}:refusal-buckets`)).map((entry) => JSON.parse(entry) as AllowanceRefusalBucket);
          const refusals = buckets.map((bucket) => bucket.event);
          if (!buckets.every((bucket) => validAmount(bucket.count) && bucket.count > 0 && validAmount(bucket.committed) && validAmount(bucket.time)) ||
            !refusals.every((event) => event.teamId === teamId && ["month", "day", "demo"].includes(event.reason) &&
            [event.time, event.cap, event.committed, event.liveHolds, event.requestedHold].every(validAmount) &&
            ["legacy", "plan"].includes(event.policyMode) && ["visible", "system"].includes(event.lane) && typeof event.id === "string")) {
            throw new Error("Invalid allowance refusal evidence");
          }
          const previous = await redis.get(`${prefix}:observation`);
          const before = historical ? [] : await snapshot();
          const signature = JSON.stringify([contextJson, before]);
          const state: Observation = previous ? JSON.parse(previous) : { snapshot: signature, changedAt: Date.now(), sequence: 0, refusalSeen: [] };
          if (!historical) {
            if (state.snapshot !== signature) {
              state.snapshot = signature;
              state.changedAt = Date.now();
            }
          }
          const save = () => redis.set(`${prefix}:observation`, JSON.stringify(state), "EX", ttl);
          await save();
          const funding = await getTeamGatewayFunding({ trustedTeamId: teamId });
          if (!funding || funding.source === "customer") throw new Error("Unknown platform funding source");
          if (context.fundingChanged || context.fundingSource !== funding.source) {
            counts.inconclusive++;
            return;
          }
          const gateway = await gatewaySpendBreakdownMicroUsd(funding.apiKey, teamId, period.startDate, period.endDate, AbortSignal.timeout(10_000));
          if (![gateway.totalMicroUsd, gateway.visibleMicroUsd, gateway.systemMicroUsd].every(validAmount)) throw new Error("Invalid Gateway snapshot");
          const after = historical ? [] : await snapshot();
          if (JSON.stringify(before) !== JSON.stringify(after) || contextJson !== await redis.get(`${prefix}:context`)) {
            state.snapshot = "changed-during-report";
            state.changedAt = Date.now();
            await save();
            counts.inconclusive++;
            return;
          }
          const reasons = { month: 0, day: 0, demo: 0 };
          buckets.forEach((bucket) => reasons[bucket.event.reason] += bucket.count);
          const maturedAt = now.getTime() - QUIET_MS;
          const matured = refusals.filter((event) => event.reason === "month" && event.time <= maturedAt && event.fundingSource === context.fundingSource);
          const hourlyBounds = new Map<number, { lower: number; upper: number }>();
          let hourlyReportFailed = false;
          if (matured.length) {
            if (!hourlyReports.has(teamId)) {
              hourlyReports.set(teamId, gatewayHourlySpend(funding.apiKey, teamId, periods[0].startDate, month.endDate, AbortSignal.timeout(10_000)));
            }
            const report = await hourlyReports.get(teamId)!.catch(() => {
              hourlyReportFailed = true;
              return null;
            });
            if (hourlyReportFailed) counts.unknown++;
            if (report) {
              const costs = new Map(report.map((row) => [row.hour, Math.round(row.totalUsd * 1_000_000)]));
              let billedMicroUsd = 0;
              const end = Date.parse(`${period.endDate}T00:00:00Z`) + 86_400_000;
              for (let hour = Date.parse(`${period.startDate}T00:00:00Z`); hour < end; hour += 3_600_000) {
                const lower = billedMicroUsd;
                billedMicroUsd += costs.get(hour) ?? 0;
                hourlyBounds.set(hour, { lower, upper: billedMicroUsd });
              }
              if (Math.abs(billedMicroUsd - gateway.totalMicroUsd) > report.length) hourlyBounds.clear();
            }
          }
          const judgments = new Map<AllowanceRefusal, "under" | "over" | "inconclusive">();
          for (const event of matured) {
            const hour = Math.floor(event.time / 3_600_000) * 3_600_000;
            const bounds = hourlyBounds.get(hour);
            if (!bounds) {
              if (!hourlyReportFailed) counts.inconclusive++;
              judgments.set(event, "inconclusive");
              continue;
            }
            const laneTotal = event.policyMode === "plan" ? gateway.totalMicroUsd : event.lane === "system" ? gateway.systemMicroUsd : gateway.visibleMicroUsd;
            const lower = Math.max(0, bounds.lower - (gateway.totalMicroUsd - laneTotal));
            const upper = Math.min(bounds.upper, laneTotal);
            const held = event.liveHolds + event.requestedHold;
            const judgment = upper + held <= event.cap ? "under" : lower + held > event.cap ? "over" : "inconclusive";
            judgments.set(event, judgment);
            if (judgment === "inconclusive") counts.inconclusive++;
          }
          const underAllowanceEvents = matured.filter((event) => judgments.get(event) === "under" && !state.refusalSeen.includes(event.id));
          const underAllowanceEvent = underAllowanceEvents[0];
          const underAllowance = underAllowanceEvents.length > 0;
          const counter = historical ? (underAllowanceEvent?.committed ?? 0) : before[0] + before[1] + before[2];
          const latestRefusalAt = buckets.reduce((latest, bucket) => Math.max(latest, bucket.time), 0);
          const newRefusals = buckets.filter((bucket) => bucket.time > (state.refusalLastAt ?? 0));
          const quietGap = state.refusalLastAt !== undefined && newRefusals.length > 0 &&
            newRefusals.reduce((earliest, bucket) => Math.min(earliest, bucket.event.time), Infinity) - state.refusalLastAt >= REFUSAL_RECOVERY_MS;
          const recoveryWindow = refusals.filter((event) => event.time > maturedAt - REFUSAL_RECOVERY_MS && event.time <= maturedAt);
          const recovered = now.getTime() - latestRefusalAt >= REFUSAL_RECOVERY_MS || quietGap ||
            (recoveryWindow.length > 0 && recoveryWindow.every((event) => judgments.get(event) === "over"));
          if (recovered) delete state.refusal;
          state.refusalLastAt = latestRefusalAt;
          const allowance = Math.round(context.monthlyUsd * 1_000_000);
          const margin = Math.max(10_000, allowance * 0.01);
          const drift = !historical && (context.mode === "plan"
            ? Math.abs(counter - gateway.totalMicroUsd) > margin
            : Math.abs(before[0] + before[2] - gateway.visibleMicroUsd) > margin ||
              Math.abs(before[1] - gateway.systemMicroUsd) > Math.max(10_000, allowance * SYSTEM_AI_ALLOWANCE_MULTIPLIER * 0.01));
          const quiet = !historical && Date.now() - state.changedAt >= QUIET_MS;
          if (!historical && !quiet) counts.inconclusive++;
          if (quiet && drift) counts.drift++;
          let team: { title: string | null } | null | undefined;
          const notify = async (kind: "drift" | "refusal", active: boolean) => {
            if (!active) {
              if (kind === "drift") delete state[kind];
              return false;
            }
            if (!state[kind]) {
              state.sequence++;
              state[kind] = { id: `${incidentTeamId}:${kind}:${period.key}:${Math.floor(Date.now() / 3_600_000)}:${state.sequence}`, notified: false };
              await save();
            }
            const incident = state[kind]!;
            if (incident.notified) return false;
            team ??= await prisma.team.findUnique({ where: { id: teamId }, select: { title: true } });
            if (Date.now() >= deadline || await redis.get(lockKey) !== token) throw new Error("Allowance observation lease expired");
            const refusalCapacity = kind === "refusal" && underAllowanceEvent
              ? `; refused cap ${dollars(underAllowanceEvent.cap)} holds ${dollars(underAllowanceEvent.liveHolds)} request ${dollars(underAllowanceEvent.requestedHold)}` : "";
            const laneDetails = historical ? "historical refusal evidence"
              : `visible counter ${dollars(before[0] + before[2])} gateway ${dollars(gateway.visibleMicroUsd)}; system counter ${dollars(before[1])} gateway ${dollars(gateway.systemMicroUsd)}`;
            const message = `AI allowance ${kind === "drift" ? "drift CONFIRMED" : "refused while under allowance"}; episode ${incident.id}; team ${safeTitle(team?.title ?? "Untitled")} (${teamId}; id parts ${displayedTeamId}); month ${period.key}; ${historical ? "stored refusal-scope counter" : "counter"} ${dollars(counter)}; gateway ${dollars(gateway.totalMicroUsd)}; allowance ${dollars(allowance)}; ${laneDetails}; refusals month ${reasons.month}/day ${reasons.day}/demo ${reasons.demo} (day/demo not judged)${refusalCapacity}`;
            await reportError({ source: "server", minimumOccurrences: 1, fingerprintKey: `ai-allowance:${incident.id}`, message: message.slice(0, 1000), extra: { route: "/api/cron/ai-allowance-drift", stage: kind } });
            incident.notified = true;
            await save();
            return true;
          };
          if (quiet) await notify("drift", drift);
          const refusalNotified = await notify("refusal", underAllowance);
          if (refusalNotified) counts.refusalAlerts++;
          const notifiedRefusals = state.refusal?.notified ? underAllowanceEvents : [];
          const retainedIds = new Set(refusals.map((event) => event.id));
          state.refusalSeen = [...new Set([...state.refusalSeen, ...notifiedRefusals.map((event) => event.id)])].filter((id) => retainedIds.has(id));
          await save();
        } catch {
          counts.unknown++;
        }
      };
      while (counts.checked < limit && Date.now() < deadline - 15_000) {
        if (position.pending.length === 0) {
          const [cursor, teams] = await redis.sscan(`${root}:${historical ? "refusal-active" : "active"}`, position.cursor, "COUNT", 100);
          position.cursor = cursor;
          position.pending = teams;
        }
        const batch: string[] = [];
        while (position.pending.length && batch.length < Math.min(CONCURRENCY, limit - counts.checked)) {
          const team = position.pending.shift()!;
          if (!visited.has(team)) {
            visited.add(team);
            batch.push(team);
          }
        }
        await Promise.all(batch.map(checkTeam));
        const owned = await redis.eval(`
if redis.call("GET", KEYS[1]) ~= ARGV[1] then return 0 end
redis.call("EXPIRE", KEYS[1], 300)
redis.call("SET", KEYS[2], ARGV[2], "EX", ARGV[3])
return 1
`, 2, lockKey, cursorKey, token, JSON.stringify(position), String(ttl));
        if (Number(owned) !== 1) return counts;
        if (position.cursor === "0" && position.pending.length === 0) break;
      }
    }
  } finally {
    await redis.eval(`
if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end
return 0
`, 1, lockKey, token);
  }
  return counts;
}
