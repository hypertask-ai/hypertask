import {
  aiAllowancePeriod,
  FREE_TEAM_AI_ALLOWANCE_USD,
  PAID_TEAM_AI_ALLOWANCE_USD,
} from "@/lib/aiAllowancePolicy";
import { getTeamGatewayFunding } from "@/app/api/ai/_lib/byokKeys";
import { resolveTeamAllowancePolicy } from "@/app/api/ai/_lib/planAllowancePolicy";
import { SharedAiAllowanceExceededError, teamAllowanceSnapshot } from "@/app/api/ai/_lib/sharedAllowance";

export async function assertBatchWithinTeamCap(args: {
  teamId: string;
  userId: number;
  gatewayKey: string;
}) {
  const funding = await getTeamGatewayFunding(
    { trustedTeamId: args.teamId },
    { includeProvenance: true },
  );
  if (!funding || funding.source === "customer" || funding.apiKey !== args.gatewayKey) {
    throw new Error("Batch dispatch requires a capped team gateway key");
  }
  const policy = await resolveTeamAllowancePolicy(args.teamId, funding.source);
  const allowanceUsd = policy.mode === "plan"
    ? policy.monthlyUsd
    : funding.source === "shared"
      ? FREE_TEAM_AI_ALLOWANCE_USD
      : PAID_TEAM_AI_ALLOWANCE_USD;
  const snapshot = await teamAllowanceSnapshot(args.teamId, allowanceUsd, policy, {
    userId: args.userId,
    gatewayApiKey: funding.apiKey,
    fundingSource: funding.source,
  });
  if (!snapshot || snapshot.usedUsd >= snapshot.allowanceUsd) {
    throw new SharedAiAllowanceExceededError(aiAllowancePeriod().key);
  }
}
