import type { StorePlanKind } from "@/lib/planFromStripePriceId";

/**
 * Lives here, not beside the error that throws it, so a pure reader of a
 * streamed response can recognise this stop without importing the allowance
 * engine (and its Redis client) to compare one sentence.
 */
export const SHARED_AI_ALLOWANCE_EXCEEDED_MESSAGE =
  "This team has used its included AI allowance for this month. Upgrade or add your own AI key to continue.";

/** Included platform-funded allowance for each Free or BYOK-plan team. */
export const FREE_TEAM_AI_ALLOWANCE_USD = 1;

/** Paid and comped teams receive this allowance on their dedicated key. */
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

/**
 * Marks which team's allowance actually rejected, as an invisible HTML
 * comment appended to the "agent paused" notice. The notice id is keyed by
 * agent and period only, so the team rides on the content: a reader can then
 * attribute the stop to exactly one team instead of guessing from the agent's
 * board memberships (an agent can sit on several teams).
 */
export const allowanceTeamStamp = (teamId: string) =>
  `<!--ht-allowance-team:${teamId}-->`;

export function parseAllowanceTeamStamp(
  content: string | null | undefined,
): string | null {
  const match = content?.match(/<!--ht-allowance-team:([A-Za-z0-9_-]+)-->/);
  return match?.[1] ?? null;
}
