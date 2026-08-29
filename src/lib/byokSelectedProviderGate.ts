import type { CurrentBoardBilling } from "@/store";

type ByokBillingPick = Pick<
  CurrentBoardBilling,
  "storePlanId" | "byokProviderFlags"
>;

/**
 * BYOK-plan teams retain Hypertask's included base-model allowance even when
 * they have not added a key. Premium rows are locked by the model selector and
 * enforced again by the server plan gate.
 */
export function shouldBlockAiDueToByokProvider(
  _billing: ByokBillingPick | null | undefined,
  _selectedSource: string | undefined | null
): boolean {
  return false;
}

/** Whether the team's BYOK row for this provider exists and is enabled. */
export function isByokProviderEnabledForSource(
  byokProviderFlags: ByokBillingPick["byokProviderFlags"] | undefined,
  source: string | undefined | null
): boolean {
  if (!source) return false;
  if (
    byokProviderFlags?.some(
      (row) => row.provider === "gateway" && row.enabled
    )
  ) {
    return true;
  }
  if (source === "gateway") return false;
  return !!byokProviderFlags?.find((r) => r.provider === source)?.enabled;
}
