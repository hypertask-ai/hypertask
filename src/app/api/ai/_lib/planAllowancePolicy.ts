import prisma from "@/lib/prisma";
import { getRedis } from "@/lib/redis";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7324_PLAN_AI_CAPS_FLAG } from "@/lib/flags/definitions/htpr-7324-plan-ai-caps";
import { isInternalCompTeam } from "@/lib/internalCompTeams";
import { isTeamComped } from "@/lib/teamComp";
import { pickEntitlingSubscriptionRow, subscriptionStatusGrantsAccess } from "@/lib/subscriptionAccess";
import {
  aiAllowancePeriod,
  FREE_TEAM_AI_ALLOWANCE_USD,
  FREE_TEAM_DAILY_AI_ALLOWANCE_USD,
  PAID_TEAM_AI_ALLOWANCE_USD,
  PLAN_PAID_SEAT_AI_ALLOWANCE_USD,
  type TeamAllowancePolicy,
} from "@/lib/aiAllowancePolicy";

type FundingSource = "shared" | "managed" | "customer";
const owners = new Map<string, { userId: number; expiresAt: number }>();

async function teamOwnerUserId(teamId: string) {
  const cached = owners.get(teamId);
  if (cached && cached.expiresAt > Date.now()) return cached.userId;
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { googleAccount: { select: { userId: true } } },
  });
  if (!team?.googleAccount?.userId) throw new Error("AI allowance team owner is unavailable");
  const userId = team.googleAccount.userId;
  owners.set(teamId, { userId, expiresAt: Date.now() + 5 * 60 * 1000 });
  return userId;
}

async function planMode(teamId: string): Promise<"legacy" | "plan" | "strict"> {
  try {
    return await isFeatureEnabled(HTPR_7324_PLAN_AI_CAPS_FLAG, await teamOwnerUserId(teamId))
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
redis.call("SET", KEYS[1], seats, "EX", ARGV[2])
return seats
`;

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
  let demoGlobal = true;
  try {
    const owner = await prisma.user.findUnique({
      where: { id: await teamOwnerUserId(teamId) }, select: { uid: true },
    });
    if (!owner) throw new Error("AI allowance owner identity is unavailable");
    demoGlobal = owner.uid.startsWith("guest_");
    if (fundingSource === "managed" && !demoGlobal) {
      const seats = await paidSeats(teamId);
      const month = aiAllowancePeriod();
      const redis = await getRedis();
      const highWater = Number(await redis.eval(SEATS_HIGH_WATER_SCRIPT, 1,
        `ai-allowance:${month.key}:${teamId}:seats-high`, String(seats), String(month.ttlSeconds)));
      if (!Number.isSafeInteger(highWater) || highWater < seats) throw new Error("Invalid AI allowance seat high-water");
      monthlyUsd = PLAN_PAID_SEAT_AI_ALLOWANCE_USD * highWater;
    }
  } catch (error) {
    console.warn("[ai-allowance] Policy lookup failed; using strict allowance", { teamId, error });
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
    dailyUsd: fundingSource === "managed" && !demoGlobal ? null : FREE_TEAM_DAILY_AI_ALLOWANCE_USD,
    demoGlobal,
  };
}
