import { wrapLanguageModel, type LanguageModel } from "ai";
import {
  createSharedAllowanceMiddleware,
  estimateReservationMicroUsd,
  modelCostUsd,
  modelPricing,
  reservePlanAllowance,
  settlePlanAllowance,
} from "@/app/api/ai/_lib/sharedAllowance";
import {
  FREE_TEAM_AI_ALLOWANCE_USD,
  FREE_TEAM_DAILY_AI_ALLOWANCE_USD,
  type TeamAllowancePolicy,
} from "@/lib/aiAllowancePolicy";
import { isFeatureEnabled } from "@/lib/flags";
import { HTPR_7324_PLAN_AI_CAPS_FLAG } from "@/lib/flags/definitions/htpr-7324-plan-ai-caps";

export const demoCapsEnabled = () => isFeatureEnabled(HTPR_7324_PLAN_AI_CAPS_FLAG, 0);

const GUEST_POLICY: TeamAllowancePolicy = {
  mode: "plan",
  monthlyUsd: FREE_TEAM_AI_ALLOWANCE_USD,
  dailyUsd: FREE_TEAM_DAILY_AI_ALLOWANCE_USD,
  demoGlobal: true,
};

export function cappedDemoModel(model: Exclude<LanguageModel, string>, modelSlug: string, gatewayApiKey: string, teamId?: string) {
  return wrapLanguageModel({
    model,
    middleware: teamId ? createSharedAllowanceMiddleware({
      allowanceUsd: GUEST_POLICY.monthlyUsd,
      gatewayApiKey,
      fundingSource: "demo",
      modelSlug,
      resolvePolicy: async () => GUEST_POLICY,
    }) : {
      specificationVersion: "v4",
      wrapGenerate: async ({ doGenerate, params }) => {
        const pricing = await modelPricing(modelSlug);
        const amountUsd = estimateReservationMicroUsd({ ...params, pricing }) / 1_000_000;
        const reservation = await reservePlanAllowance({ policy: GUEST_POLICY, gatewayApiKey, fundingSource: "demo", amountUsd });
        let actualUsd = amountUsd;
        try {
          const result = await doGenerate();
          const input = result.usage.inputTokens.total;
          const output = result.usage.outputTokens.total;
          if (Number.isFinite(input) && Number.isFinite(output)) {
            actualUsd = modelCostUsd(pricing, input!, output!, result.usage.inputTokens.cacheRead, result.usage.inputTokens.cacheWrite);
          }
          return result;
        } finally {
          await settlePlanAllowance(reservation, actualUsd);
        }
      },
    },
  });
}
