import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7324_PLAN_AI_CAPS_FLAG } from "@/lib/flags/definitions/htpr-7324-plan-ai-caps";
import { isInternalCompTeam } from "@/lib/internalCompTeams";
import { storePlanIdForProject } from "@/app/api/ai/_lib/planGate";
import { isTeamComped } from "@/lib/teamComp";
import { pickEntitlingSubscriptionRow, subscriptionStatusGrantsAccess } from "@/lib/subscriptionAccess";
import {
  aiAllowancePeriod,
  BYOK_MEMBER_AI_ALLOWANCE_USD,
  FREE_TEAM_AI_ALLOWANCE_USD,
  FREE_TEAM_DAILY_AI_ALLOWANCE_USD,
  PAID_TEAM_AI_ALLOWANCE_USD,
  PLAN_PAID_SEAT_AI_ALLOWANCE_USD,
  type TeamAllowancePolicy,
} from "@/lib/aiAllowancePolicy";

type FundingSource = "shared" | "managed" | "customer";
const POLICY_CACHE_TTL_MS = 5 * 60 * 1000;
const owners = new Map<string, { userId: number; uid?: string; expiresAt: number }>();
const seatSnapshots = new Map<string, { seats: number; month: string; expiresAt: number }>();
const seatHighWaters = new Map<string, { month: string; observedSeats: number; highWater: number; expiresAt: number }>();

async function teamOwner(teamId: string): Promise<{ userId: number; uid?: string; expiresAt: number }> {
  const cached = owners.get(teamId);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { googleAccount: { select: { userId: true } } },
  });
  if (!team?.googleAccount?.userId) throw new Error("AI allowance team owner is unavailable");
  const userId = team.googleAccount.userId;
  const owner = { userId, expiresAt: Date.now() + POLICY_CACHE_TTL_MS };
  owners.set(teamId, owner);
  return owner;
}

async function planMode(teamId: string): Promise<"legacy" | "plan" | "strict"> {
  try {
    return await isFeatureEnabled(HTPR_7324_PLAN_AI_CAPS_FLAG, (await teamOwner(teamId)).userId)
      ? "plan" : "legacy";
  } catch {
    return "strict";
  }
}

export async function teamPlanAllowanceEnabled(teamId: string): Promise<boolean> {
  return await planMode(teamId) !== "legacy";
}

const SEATS_HIGH_WATER_SCRIPT = `
local previous = tonumber(redis.call("GET", KEYS[1]) or "0")
local seats = math.max(previous, tonumber(ARGV[1]))
if seats > previous then redis.call("SET", KEYS[1], seats, "EX", ARGV[2]) end
return seats
`;

async function cachedPaidSeats(teamId: string, month: string, byok: boolean): Promise<number> {
  const cached = seatSnapshots.get(`${teamId}:${byok ? "members" : "seats"}`);
  if (cached && cached.month === month && cached.expiresAt > Date.now()) return cached.seats;
  const seats = byok ? await teamMembers(teamId) : await paidSeats(teamId);
  seatSnapshots.set(`${teamId}:${byok ? "members" : "seats"}`, { seats, month, expiresAt: Date.now() + POLICY_CACHE_TTL_MS });
  return seats;
}

async function teamMembers(teamId: string): Promise<number> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      googleAccount: { select: { userId: true } },
      members: { where: { status: "Accepted" }, select: { userId: true } },
    },
  });
  if (!team) throw new Error("AI allowance team is unavailable");
  return Math.max(1, new Set([
    team.googleAccount.userId,
    ...team.members.map((member) => member.userId),
  ]).size);
}

async function paidSeats(teamId: string): Promise<number> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: {
      id: true,
      activeSubscriptionPlanId: true,
      activeSubscriptionPlanItemId: true,
      compedUntil: true,
      googleAccount: { select: { userId: true } },
      members: { where: { status: "Accepted" }, select: { userId: true } },
      subscriptionPlan: {
        select: {
          subscriptionId: true,
          subscriptionStatus: true,
          subscriptionItemId: true,
          subscriptionObject: true,
        },
      },
    },
  });
  if (!team) throw new Error("AI allowance team is unavailable");
  const row = pickEntitlingSubscriptionRow(team.subscriptionPlan, team.activeSubscriptionPlanId);
  const subscription = row?.subscriptionObject as { items?: { data?: Array<{ id?: string; quantity?: number }> } } | null;
  const itemId = row?.subscriptionId === team.activeSubscriptionPlanId
    ? team.activeSubscriptionPlanItemId || row?.subscriptionItemId
    : row?.subscriptionItemId;
  const items = subscription?.items?.data;
  const item = Array.isArray(items) ? items.find((value) => value?.id === itemId) : undefined;
  if (row && subscriptionStatusGrantsAccess(row.subscriptionStatus) && item && Number.isSafeInteger(item.quantity) && item.quantity! > 0) return item.quantity!;
  if (isInternalCompTeam(team.id) || isTeamComped(team) ||
    (row?.subscriptionStatus.toLowerCase() === "trialing" &&
      subscriptionStatusGrantsAccess(row.subscriptionStatus) && !itemId &&
      (row.subscriptionObject == null || (Array.isArray(items) && items.length === 0)))) {
    return Math.max(1, new Set([
      team.googleAccount.userId,
      ...team.members.map((member) => member.userId),
    ]).size);
  }
  console.warn("[ai-allowance] Missing or invalid saved entitling Stripe seat item; using one seat", { teamId });
  return 1;
}

export async function resolveTeamAllowancePolicy(
  teamId: string,
  fundingSource: FundingSource,
): Promise<TeamAllowancePolicy> {
  const mode = await planMode(teamId);
  const legacyMonthly = fundingSource === "managed" ? PAID_TEAM_AI_ALLOWANCE_USD : FREE_TEAM_AI_ALLOWANCE_USD;
  if (mode === "legacy") return { mode, monthlyUsd: legacyMonthly, dailyUsd: null, demoGlobal: false };
  let monthlyUsd = FREE_TEAM_AI_ALLOWANCE_USD;
  let dailyUsd: number | null = fundingSource === "managed" ? null : FREE_TEAM_DAILY_AI_ALLOWANCE_USD;
  let demoGlobal = false;
  let ownerIdentityConfirmed = false;
  try {
    const owner = await teamOwner(teamId);
    if (owner.uid === undefined) {
      const user = await prisma.user.findUnique({ where: { id: owner.userId }, select: { uid: true } });
      if (!user) throw new Error("AI allowance owner identity is unavailable");
      owner.uid = user.uid;
    }
    demoGlobal = owner.uid.startsWith("guest_");
    ownerIdentityConfirmed = true;
    const byok = fundingSource === "shared" && !demoGlobal &&
      await storePlanIdForProject(null, teamId) === "BYOK";
    if ((fundingSource === "managed" || byok) && !demoGlobal) {
      const month = aiAllowancePeriod();
      const seats = await cachedPaidSeats(teamId, month.key, byok);
      const highWaterKey = `ai-allowance:${month.key}:${teamId}:${byok ? "members-high" : "seats-high"}`;
      let cached = seatHighWaters.get(highWaterKey);
      if (!cached || cached.month !== month.key || seats > cached.observedSeats) {
        const redis = await getRedis();
        const highWater = Number(await redis.eval(SEATS_HIGH_WATER_SCRIPT, 1,
          highWaterKey, String(seats), String(month.ttlSeconds)));
        if (!Number.isSafeInteger(highWater) || highWater < seats) throw new Error("Invalid AI allowance seat high-water");
        cached = { month: month.key, observedSeats: seats, highWater, expiresAt: Date.now() + POLICY_CACHE_TTL_MS };
        seatHighWaters.set(highWaterKey, cached);
      } else if (cached.expiresAt <= Date.now()) {
        const redis = await getRedis();
        const highWater = Number(await redis.get(highWaterKey));
        if (!Number.isSafeInteger(highWater) || highWater < seats) throw new Error("Invalid AI allowance seat high-water");
        cached.highWater = Math.max(cached.highWater, highWater);
        cached.expiresAt = Date.now() + POLICY_CACHE_TTL_MS;
      }
      const highWater = cached.highWater;
      monthlyUsd = (byok ? BYOK_MEMBER_AI_ALLOWANCE_USD : PLAN_PAID_SEAT_AI_ALLOWANCE_USD) * highWater;
      dailyUsd = null;
    }
  } catch {
    console.warn("[ai-allowance] Policy lookup failed; using strict allowance", { teamId });
    if (!ownerIdentityConfirmed) {
      return { mode: "plan", monthlyUsd: FREE_TEAM_AI_ALLOWANCE_USD, dailyUsd: FREE_TEAM_DAILY_AI_ALLOWANCE_USD, demoGlobal: false };
    }
    return {
      mode: "plan",
      monthlyUsd: Math.min(fundingSource === "managed" && !demoGlobal ? PLAN_PAID_SEAT_AI_ALLOWANCE_USD : FREE_TEAM_AI_ALLOWANCE_USD, legacyMonthly),
      dailyUsd: fundingSource === "managed" && !demoGlobal ? null : FREE_TEAM_DAILY_AI_ALLOWANCE_USD,
      demoGlobal,
    };
  }
  return {
    mode: "plan",
    monthlyUsd: mode === "strict" ? Math.min(monthlyUsd, legacyMonthly) : monthlyUsd,
    dailyUsd: demoGlobal ? FREE_TEAM_DAILY_AI_ALLOWANCE_USD : dailyUsd,
    demoGlobal,
  };
}
