import type { StorePlanKind } from "@/lib/planFromStripePriceId";

export const SHARED_AI_ALLOWANCE_EXCEEDED_MESSAGE =
  "This team has used its included AI allowance for this month. Upgrade or add your own AI key to continue.";

export const FREE_TEAM_AI_ALLOWANCE_USD = 1;

export const PAID_TEAM_AI_ALLOWANCE_USD = 40;

export function aiAllowancePeriod(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const nextMonth = new Date(Date.UTC(year, now.getUTCMonth() + 1, 1));
  return {
    endDate: now.toISOString().slice(0, 10),
    key: `${year}-${month}`,
    startDate: `${year}-${month}-01`,
    ttlSeconds: Math.max(
      60,
      Math.ceil((nextMonth.getTime() - now.getTime()) / 1000) + 86_400,
    ),
  };
}

export function teamAiAllowanceUsd(plan: StorePlanKind): number {
  return plan === "Free" || plan === "BYOK"
    ? FREE_TEAM_AI_ALLOWANCE_USD
    : PAID_TEAM_AI_ALLOWANCE_USD;
}

export const allowanceTeamStamp = (teamId: string) =>
  `<!--ht-allowance-team:${teamId}-->`;

export function parseAllowanceTeamStamp(
  content: string | null | undefined,
): string | null {
  const match = content?.match(/<!--ht-allowance-team:([A-Za-z0-9_-]+)-->/);
  return match?.[1] ?? null;
}

export const PLAN_PAID_SEAT_AI_ALLOWANCE_USD = 5;
export const BYOK_MEMBER_AI_ALLOWANCE_USD = 2.5;
export const FREE_TEAM_DAILY_AI_ALLOWANCE_USD = 0.25;
export const DEMO_GLOBAL_AI_ALLOWANCE_USD = 15;
export const DAILY_AI_ALLOWANCE_EXCEEDED_MESSAGE =
  "This team has used today's included AI allowance. Try again tomorrow, upgrade or add your own AI key.";

export type TeamAllowancePolicy = {
  mode: "legacy" | "plan";
  monthlyUsd: number;
  dailyUsd: number | null;
  demoGlobal: boolean;
};
